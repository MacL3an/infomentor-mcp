# infomentor-mcp

MCP server for [InfoMentor](https://infomentor.se) — the school communication platform used across Sweden, UK, and other countries.

Access school news, calendar events, notifications, and document attachments through any MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.).

## Setup

### 1. Install

```bash
npm install infomentor-mcp
```

### 2. Authenticate (one-time)

```bash
npx infomentor-login
```

This opens a browser. Select your municipality, log in via BankID (or your school's SSO), and the script saves OAuth2 tokens to `~/.infomentor/config.json`. You only need to do this once — the tokens refresh automatically.

> **Note:** The login script requires `puppeteer` as a peer dependency:
> ```bash
> npm install puppeteer
> ```

### 3. Configure your MCP client

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "infomentor": {
      "command": "npx",
      "args": ["infomentor-mcp"]
    }
  }
}
```

#### Claude Code

```bash
claude mcp add infomentor -- npx infomentor-mcp
```

## Tools

| Tool | Description |
|------|-------------|
| `infomentor_get_children` | List children associated with your account |
| `infomentor_get_news` | Get school news and announcements |
| `infomentor_get_notifications` | Get unread notifications |
| `infomentor_get_calendar` | Get calendar events (default: next 30 days) |
| `infomentor_get_attachments` | Get attachments for a calendar event |
| `infomentor_download_attachment` | Download and extract text from .docx/.pdf attachments |

All tools accept an optional `child` parameter to select which child's data to view (for parents with multiple children).

## How it works

The server uses OAuth2 refresh tokens obtained during the one-time BankID login. On each request:

1. Refreshes the OAuth2 access token (10-minute lifetime)
2. Uses the access token to get a one-time SSO login URL
3. Follows the SSO redirect chain to establish a web session (3-hour lifetime)
4. Calls the InfoMentor Hub API with the web session cookies
5. Caches the session for 2.5 hours to minimize auth overhead

The refresh token rotates on each use and is automatically saved back to the config file. No re-authentication needed unless the token is revoked.

## Supported municipalities

Any municipality using InfoMentor's SAML SSO should work, including those using:
- BankID (Swedish municipalities like Stockholm, Göteborg, etc.)
- Username/password
- Other SSO providers via Skolfederation

## Privacy

- Tokens are stored locally in `~/.infomentor/config.json`
- No data is sent to any third party
- The server communicates only with InfoMentor's servers (`*.infomentor.se`)

## License

MIT
