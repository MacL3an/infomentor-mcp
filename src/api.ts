/**
 * InfoMentor Hub API client.
 *
 * All endpoints require web session cookies obtained via the SSO bridge.
 * Important: some endpoints require POST (not GET) or they return error pages.
 */

const HUB = 'https://hub.infomentor.se';

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function hubFetch(
  cookies: string,
  path: string,
  method = 'GET',
  body?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Cookie: cookies,
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
  };
  const res = await fetch(HUB + path, {
    method,
    headers,
    body: body || undefined,
    redirect: 'manual',
  });
  if (res.status !== 200) return { __error: res.status };
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __error: text.slice(0, 100) };
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export interface NewsItem {
  id: number;
  title: string;
  content: string;
  publishedDateString: string;
  publishedBy: string;
}

export interface Notification {
  id: number;
  title: string;
  subTitle: string;
  dateSent: string;
  type: string;
  state: string;
}

export interface CalendarEntry {
  id: number;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  hasAttachments: boolean;
}

export interface Attachment {
  fileType: string;
  url: string;
  title: string;
}

export async function switchChild(cookies: string, switchId: number): Promise<void> {
  await fetch(`${HUB}/Account/PupilSwitcher/SwitchPupil/${switchId}`, {
    headers: { Cookie: cookies },
    redirect: 'follow',
  });
}

export async function getNews(cookies: string): Promise<NewsItem[]> {
  const resp = (await hubFetch(cookies, '/Communication/News/GetNewsList')) as {
    items?: NewsItem[];
  };
  return (resp?.items || []).map((item) => ({
    ...item,
    content: stripHtml(item.content || ''),
  }));
}

export async function getNotifications(cookies: string): Promise<Notification[]> {
  // Must be POST — GET returns an error page
  const resp = (await hubFetch(
    cookies,
    '/NotificationApp/NotificationApp/appData',
    'POST',
  )) as { notifications?: Notification[] };
  return resp?.notifications || [];
}

export async function getCalendarEntries(
  cookies: string,
  startDate: string,
  endDate: string,
): Promise<CalendarEntry[]> {
  const resp = await hubFetch(
    cookies,
    `/calendarv2/calendarv2/getentries?startDate=${startDate}&endDate=${endDate}`,
  );
  return Array.isArray(resp) ? resp : [];
}

export async function getAttachments(
  cookies: string,
  entryId: number,
): Promise<Attachment[]> {
  const resp = await hubFetch(
    cookies,
    '/calendarv2/calendarv2/getattachments',
    'POST',
    JSON.stringify({ id: String(entryId) }),
  );
  return Array.isArray(resp) ? resp : [];
}

export async function downloadAttachment(
  cookies: string,
  urlPath: string,
): Promise<Buffer> {
  const res = await fetch(HUB + urlPath, {
    headers: { Cookie: cookies },
    redirect: 'follow',
  });
  return Buffer.from(await res.arrayBuffer());
}
