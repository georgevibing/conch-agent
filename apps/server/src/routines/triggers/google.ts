/**
 * Gmail and Google Calendar for When-routines (ADR 0056), through the same
 * Google service the apps use (ADR 0037, ADR 0048): Google's sign-in or an
 * app password, its token refreshed by itself. Only reads; the apps' own
 * switches in Apps decide whether they're on.
 */
import type { GoogleAppId, Integration } from '@conch/protocol';

import { readMail, viaImap } from '../../google/mail';
import { GoogleError, type GoogleService } from '../../google/service';
import type { CalendarAccess, CalendarAccount, CalendarEvent } from './calendar';
import type { MailAccess, MailAccount } from './mail';
import { SourceError } from './types';

interface Apps {
  list(): Promise<Integration[]>;
}

/** Google's errors in a source's words: a person fixes sign-ins, Conch retries the rest. */
function sourceError(error: unknown, app: GoogleAppId): SourceError {
  const fix = { label: 'Open Apps', place: 'integrations', focus: app };
  if (error instanceof SourceError) return error;
  if (error instanceof GoogleError && (error.kind === 'expired' || error.kind === 'scope'))
    return new SourceError('needs-you', error.message, fix);
  if (error instanceof GoogleError && error.kind === 'setup')
    return new SourceError('needs-you', error.message, fix);
  const message = error instanceof Error && error.message ? error.message : '';
  return new SourceError(
    'retry',
    message && message.length < 200 ? message : 'Google didn’t answer. Conch will look again.',
  );
}

async function guarded<T>(app: GoogleAppId, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw sourceError(error, app);
  }
}

/** The accounts an app may read with, or why it's off. */
async function accountsFor(
  google: GoogleService,
  apps: Apps,
  app: GoogleAppId,
  capability: 'mail-read' | 'calendar-read',
): Promise<MailAccount[]> {
  const integration = (await apps.list().catch(() => [] as Integration[])).find(
    (i) => i.id === app,
  );
  if (integration && !integration.enabled)
    throw new SourceError(
      'needs-you',
      `${integration.name} is turned off in Apps, so Conch can’t look.`,
      { label: 'Open Apps', place: 'integrations', focus: app },
    );
  const status = await google.status();
  return status.accounts
    .filter((a) => a.capabilities.includes(capability))
    .map((a) => ({
      id: a.id,
      email: a.email,
      // Unavailable is a blip (offline): try. Signed out is the person's to fix.
      ready: a.state !== 'needs-auth',
      ...(a.message && { problem: a.message }),
    }));
}

export function gmailAccess(google: GoogleService, apps: Apps): MailAccess {
  return {
    accounts: () => accountsFor(google, apps, 'gmail', 'mail-read'),
    search: (accountId, query, limit) =>
      guarded('gmail', async () => {
        if (await google.viaPassword(accountId)) {
          const found = await viaImap(google, accountId, (login) =>
            google.imap.search(login, query, limit),
          );
          return found.messages.map((m) => m.id);
        }
        const result = (await google.api(accountId, 'mail-read', '/gmail/v1/users/me/messages', {
          query: { q: query, maxResults: String(limit) },
        })) as { messages?: { id?: unknown }[] };
        return (result.messages ?? [])
          .map((m) => m.id)
          .filter(
            (id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id),
          );
      }),
    read: (accountId, messageId) =>
      guarded('gmail', async () => {
        const { message, email, view } = await readMail(google, accountId, messageId);
        const date = email.date ? Date.parse(email.date) : NaN;
        return {
          id: message.id,
          ...(view.from[0] && { fromAddress: view.from[0] }),
          ...(email.from?.name && { fromName: email.from.name }),
          subject: view.subject,
          text: view.text,
          ...(Number.isFinite(date) && { date }),
          labels: message.labelIds ?? [],
          link: view.source,
        };
      }),
  };
}

/** People you've written to lately, most often first: for picking whose mail starts a routine. */
export async function mailPeople(
  google: GoogleService,
  apps: Apps,
): Promise<{ address: string; name?: string }[]> {
  const accounts = (await accountsFor(google, apps, 'gmail', 'mail-read')).filter((a) => a.ready);
  const counts = new Map<string, { address: string; name?: string; count: number }>();
  const own = new Set(accounts.map((a) => a.email.toLowerCase()));
  const add = (address: string, name?: string) => {
    const key = address.trim().toLowerCase();
    if (!key || own.has(key) || /no-?reply|do-?not-?reply|notifications?@|mailer-daemon/i.test(key))
      return;
    const known = counts.get(key);
    counts.set(key, {
      address: key,
      ...((name || known?.name) && { name: name || known?.name }),
      count: (known?.count ?? 0) + 1,
    });
  };
  for (const account of accounts.slice(0, 2)) {
    if (await google.viaPassword(account.id)) {
      const found = await viaImap(google, account.id, (login) =>
        google.imap.recipients(login, 'in:sent newer_than:180d', 60),
      ).catch(() => []);
      for (const p of found) add(p.address, p.name);
      continue;
    }
    const list = (await google
      .api(account.id, 'mail-read', '/gmail/v1/users/me/messages', {
        query: { q: 'in:sent newer_than:180d', maxResults: '25' },
      })
      .catch(() => ({}))) as { messages?: { id?: unknown }[] };
    for (const m of list.messages ?? []) {
      if (typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(m.id)) continue;
      const meta = (await google
        .api(account.id, 'mail-read', `/gmail/v1/users/me/messages/${m.id}`, {
          query: { format: 'metadata', metadataHeaders: 'To' },
        })
        .catch(() => undefined)) as { payload?: { headers?: { name?: string; value?: string }[] } };
      const to = meta?.payload?.headers?.find((h) => h.name?.toLowerCase() === 'to')?.value ?? '';
      for (const part of to.split(',')) {
        const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(part);
        if (match) add(match[2] ?? '', match[1]?.trim() || undefined);
        else if (/@/.test(part)) add(part.trim());
      }
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.address.localeCompare(b.address))
    .slice(0, 30)
    .map(({ count: _count, ...p }) => p);
}

interface RawEvent {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  htmlLink?: unknown;
  start?: { dateTime?: unknown };
  end?: { dateTime?: unknown };
  attendees?: {
    email?: unknown;
    displayName?: unknown;
    self?: unknown;
    responseStatus?: unknown;
  }[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function calendarAccess(google: GoogleService, apps: Apps): CalendarAccess {
  return {
    accounts: async (): Promise<CalendarAccount[]> =>
      accountsFor(google, apps, 'google-calendar', 'calendar-read'),
    events: (accountId, from, to) =>
      guarded('google-calendar', async () => {
        const result = (await google.api(
          accountId,
          'calendar-read',
          '/calendar/v3/calendars/primary/events',
          {
            query: {
              timeMin: new Date(from).toISOString(),
              timeMax: new Date(to).toISOString(),
              singleEvents: 'true',
              orderBy: 'startTime',
              maxResults: '50',
            },
          },
        )) as { items?: RawEvent[] };
        return (result.items ?? []).flatMap((e): CalendarEvent[] => {
          const id = str(e.id);
          if (!id) return [];
          const start = Date.parse(str(e.start?.dateTime) ?? '');
          const end = Date.parse(str(e.end?.dateTime) ?? '');
          const link = str(e.htmlLink);
          return [
            {
              id,
              ...(str(e.status) && { status: str(e.status) }),
              summary: str(e.summary) ?? '',
              ...(str(e.description) && { description: str(e.description) }),
              ...(str(e.location) && { location: str(e.location) }),
              ...(Number.isFinite(start) && { start }),
              ...(Number.isFinite(end) && { end }),
              ...(link && /^https:\/\//.test(link) && { link }),
              attendees: (e.attendees ?? []).map((a) => ({
                ...(str(a.email) && { email: str(a.email) }),
                ...(str(a.displayName) && { name: str(a.displayName) }),
                ...(a.self === true && { self: true }),
                ...(str(a.responseStatus) && { response: str(a.responseStatus) }),
              })),
            },
          ];
        });
      }),
  };
}
