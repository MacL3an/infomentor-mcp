#!/usr/bin/env node
/**
 * InfoMentor MCP Server
 *
 * Provides tools to access InfoMentor school platform data:
 * - News/announcements
 * - Calendar events with attachments
 * - Notifications
 * - Child switching (for parents with multiple children)
 *
 * Setup: run `infomentor-login` once to authenticate via BankID.
 * The server uses OAuth2 refresh tokens — no re-login needed.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { authenticate, type AuthResult } from './auth.js';
import * as api from './api.js';
import { loadConfig, updateRefreshToken, configExists, getConfigPath } from './config.js';

// ─── Session cache ───────────────────────────────────────────────────

let cachedAuth: AuthResult | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours (session expires at 3h)

async function getSession(): Promise<AuthResult> {
  if (cachedAuth && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedAuth;
  }

  if (!configExists()) {
    throw new Error(
      `Not authenticated. Run \`infomentor-login\` first.\nConfig path: ${getConfigPath()}`,
    );
  }

  const config = loadConfig();
  const result = await authenticate(config.refresh_token);
  if (!result) {
    throw new Error(
      'Authentication failed. Your refresh token may have expired. Run `infomentor-login` again.',
    );
  }

  // Save rotated refresh token
  updateRefreshToken(result.tokens.refresh_token);

  cachedAuth = result;
  cacheTime = Date.now();
  return result;
}

function ok(data: unknown) {
  return {
    content: [
      { type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
    ],
  };
}

function err(msg: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

// ─── Tools ───────────────────────────────────────────────────────────

const tools = [
  {
    name: 'infomentor_get_children',
    description: 'List the children (pupils) associated with this account.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'infomentor_get_news',
    description:
      'Get news and announcements from the school. Returns articles with title, author, date, and content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        child: {
          type: 'string',
          description: 'Child name to check news for. If omitted, uses the first child.',
        },
      },
    },
  },
  {
    name: 'infomentor_get_notifications',
    description:
      'Get unread notifications (calendar events, news alerts, messages). Returns notification title, type, and date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        child: {
          type: 'string',
          description: 'Child name. If omitted, uses the first child.',
        },
      },
    },
  },
  {
    name: 'infomentor_get_calendar',
    description:
      'Get calendar events for a date range. Includes event title, dates, description, and whether attachments exist.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        child: {
          type: 'string',
          description: 'Child name. If omitted, uses the first child.',
        },
        days: {
          type: 'number',
          description: 'Number of days ahead to check (default: 30).',
        },
      },
    },
  },
  {
    name: 'infomentor_get_attachments',
    description:
      'Get attachments for a specific calendar event. Returns file names, types, and download URLs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        eventId: {
          type: 'number',
          description: 'Calendar event ID (from infomentor_get_calendar results).',
        },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'infomentor_download_attachment',
    description:
      'Download and extract text from an attachment (supports .docx and .pdf). Returns the extracted text content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'Attachment URL path (from infomentor_get_attachments results).',
        },
      },
      required: ['url'],
    },
  },
];

// ─── Tool handlers ───────────────────────────────────────────────────

async function resolveChild(session: AuthResult, childName?: string): Promise<number | null> {
  const config = loadConfig();
  if (config.children.length === 0) return null;

  if (childName) {
    const match = config.children.find(
      (c) => c.name.toLowerCase().includes(childName.toLowerCase()),
    );
    if (match) {
      await api.switchChild(session.cookies, match.switchId);
      return match.switchId;
    }
    return null;
  }

  // Default to first child
  await api.switchChild(session.cookies, config.children[0].switchId);
  return config.children[0].switchId;
}

async function handleTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ReturnType<typeof ok>> {
  try {
    const session = await getSession();

    switch (name) {
      case 'infomentor_get_children': {
        const config = loadConfig();
        return ok(config.children);
      }

      case 'infomentor_get_news': {
        await resolveChild(session, args.child as string | undefined);
        const news = await api.getNews(session.cookies);
        return ok(news);
      }

      case 'infomentor_get_notifications': {
        await resolveChild(session, args.child as string | undefined);
        const notifs = await api.getNotifications(session.cookies);
        return ok(notifs.filter((n) => n.state !== 'Read'));
      }

      case 'infomentor_get_calendar': {
        await resolveChild(session, args.child as string | undefined);
        const days = (args.days as number) || 30;
        const today = new Date();
        const future = new Date(today.getTime() + days * 86400000);
        const entries = await api.getCalendarEntries(
          session.cookies,
          today.toISOString().slice(0, 10),
          future.toISOString().slice(0, 10),
        );
        return ok(entries);
      }

      case 'infomentor_get_attachments': {
        const eventId = args.eventId as number;
        const attachments = await api.getAttachments(session.cookies, eventId);
        return ok(attachments);
      }

      case 'infomentor_download_attachment': {
        const url = args.url as string;
        const buf = await api.downloadAttachment(session.cookies, url);

        if (buf.length > 10 * 1024 * 1024) {
          return ok(`File too large (${(buf.length / 1048576).toFixed(1)}MB). Skipped.`);
        }

        // Extract text based on file extension
        const ext = url.match(/\.(\w+)(?:\?|$)/)?.[1]?.toLowerCase();
        if (ext === 'pdf') {
          // Try pdftotext if available
          try {
            const { execSync } = await import('child_process');
            const { writeFileSync, unlinkSync } = await import('fs');
            const tmp = '/tmp/infomentor-att.pdf';
            writeFileSync(tmp, buf);
            const text = execSync(`pdftotext "${tmp}" - 2>/dev/null`, {
              encoding: 'utf-8',
              timeout: 10000,
            }).trim();
            try { unlinkSync(tmp); } catch {}
            return ok(text || '(no text extracted from PDF)');
          } catch {
            return ok(`PDF file (${buf.length} bytes). pdftotext not available for extraction.`);
          }
        }

        // Try docx (ZIP with word/document.xml)
        try {
          const { execSync } = await import('child_process');
          const { writeFileSync, unlinkSync } = await import('fs');
          const tmp = '/tmp/infomentor-att.docx';
          writeFileSync(tmp, buf);
          const xml = execSync(`unzip -p "${tmp}" word/document.xml 2>/dev/null`, {
            encoding: 'utf-8',
            timeout: 10000,
          });
          try { unlinkSync(tmp); } catch {}
          const texts = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map(
            (m: string) => m.replace(/<[^>]+>/g, ''),
          );
          return ok(texts.join(' ').trim() || '(no text extracted from document)');
        } catch {
          return ok(`Binary file (${buf.length} bytes). Could not extract text.`);
        }
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// ─── Server ──────────────────────────────────────────────────────────

const server = new Server(
  { name: 'infomentor-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, args ?? {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
