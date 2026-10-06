/**
 * Many Google accounts, each with its own access per product (read, or read
 * and write), and the changes Conch can make once a person allows them:
 * sending, calendar events, Drive files. Fake Google endpoints and the
 * pretend mail service; no real account.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockMail } from '../channels/mock/email';
import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import { GoogleApps } from './apps';
import { pickAccount } from './accounts';
import { GmailImap } from './imap';
import { GoogleService, passwordId, SCOPES } from './service';
import { GOOGLE_STORE_VERSION, GoogleStore } from './store';
import { googleTools } from './tools';
import { driveTagFor, eventIdFor } from './writes';

const ORIGIN = 'https://conch.example';
const config = {
  clientId: 'test-client.apps.googleusercontent.com',
  clientSecret: 'not-a-real-client-secret',
  redirectUrl: `${ORIGIN}/oauth/google/callback`,
};
const scopesOf = (...caps: (keyof typeof SCOPES)[]) => [...new Set(caps.flatMap((c) => SCOPES[c]))];

let home: string;
let store: GoogleStore;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let granted: string[];
let who: { sub: string; email: string };
let service: GoogleService;
let mail: MockMail;

const client = () => ({
  generateCodeVerifierAsync: async () => ({ codeVerifier: 'verifier', codeChallenge: 'challenge' }),
  generateAuthUrl: (params: Record<string, unknown>) =>
    `https://accounts.google.com/o/oauth2/v2/auth?state=${String(params.state)}`,
  getToken: async () => ({
    tokens: {
      access_token: 'access-only-on-server',
      refresh_token: 'refresh-only-on-server',
      id_token: 'signed',
      expiry_date: Date.now() + 3_600_000,
    },
  }),
  verifyIdToken: async () => ({
    getPayload: () => ({ sub: who.sub, email: who.email, email_verified: true, name: 'Ada' }),
  }),
  getTokenInfo: async () => ({
    aud: config.clientId,
    sub: who.sub,
    scopes: granted,
    expiry_date: Date.now() + 3_600_000,
  }),
  setCredentials: () => undefined,
  refreshAccessToken: async () => ({
    credentials: { access_token: 'renewed', expiry_date: Date.now() + 3_600_000 },
  }),
});

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-google-access-'));
  store = new GoogleStore(home);
  granted = scopesOf('mail-read');
  who = { sub: 'work1', email: 'ada@work.example' };
  fetcher = vi.fn<typeof fetch>(async () => new Response('{}'));
  mail = new MockMail();
  await mail.start();
  service = new GoogleService(
    store,
    () => client() as unknown as OAuth2Client,
    fetcher,
    new GmailImap(
      () => ({ imap: mail.endpoints.imap, smtp: mail.endpoints.smtp, insecure: true }),
      () => Promise.resolve(),
    ),
  );
  await service.configure(config, ORIGIN);
});
afterEach(async () => {
  await mail.stop();
  await rm(home, { recursive: true, force: true });
});

/** Sign in with Google for these capabilities; Google says yes to `granted`. */
async function signIn(capabilities: (keyof typeof SCOPES)[], accountId?: string) {
  const flow = await service.start({ capabilities, ...(accountId && { accountId }) }, ORIGIN);
  await service.finish(flow.flowId, 'code', flow.nonce, ORIGIN);
}

function context(answer: 'allow' | 'deny' = 'allow') {
  const ask = vi.fn(async () => answer);
  return {
    ask,
    ctx: { ask, signal: new AbortController().signal } as unknown as ToolContext,
  };
}
const tool = (tools: HostTool[], name: string) => {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};
const text = (result: Awaited<ReturnType<HostTool['run']>>) =>
  typeof result === 'string' ? result : result.text;
const calls = (method: string) =>
  fetcher.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);

describe('accounts, each with its own access', () => {
  it('keeps what the person chose, under what Google allows', async () => {
    // Google already allowed more to this app (an earlier consent): it stays unused until chosen.
    granted = scopesOf('mail-send', 'calendar-read');
    await signIn(['mail-read']);
    const [account] = (await service.status()).accounts;
    expect(account).toMatchObject({
      email: 'ada@work.example',
      access: { gmail: 'read' },
      granted: { gmail: 'write', calendar: 'read' },
      capabilities: ['mail-read'],
    });
    // Raising within what Google allows is the person's choice alone.
    await service.setAccess('work1', { product: 'gmail', level: 'write' });
    await service.setAccess('work1', { product: 'calendar', level: 'read' });
    expect((await service.status()).accounts[0]?.capabilities).toEqual([
      'mail-read',
      'mail-draft',
      'mail-send',
      'calendar-read',
    ]);
    // Past it, Google must be asked: nothing is saved.
    await expect(
      service.setAccess('work1', { product: 'calendar', level: 'write' }),
    ).rejects.toMatchObject({ kind: 'consent' });
    expect((await service.status()).accounts[0]?.access).toEqual({
      gmail: 'write',
      calendar: 'read',
    });
    // Lower is always possible, and the API is held to it at once.
    await service.setAccess('work1', { product: 'gmail', level: 'off' });
    await expect(service.api('work1', 'mail-read', '/gmail/v1/users/me/messages')).rejects.toThrow(
      /is set so Conch can’t read Gmail/,
    );
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('/gmail/'), expect.anything());
  });

  it('only a raise needs the person to confirm it’s them', async () => {
    granted = scopesOf('mail-send');
    await signIn(['mail-read']);
    expect(await service.raises('work1', { product: 'gmail', level: 'write' })).toBe(true);
    expect(await service.raises('work1', { product: 'gmail', level: 'read' })).toBe(false);
    expect(await service.raises('work1', { product: 'gmail', level: 'off' })).toBe(false);
    expect(await service.raises('work1', { product: 'nope', level: 'write' })).toBe(true);
  });

  it('asking Google for more raises only what was asked for', async () => {
    granted = scopesOf('mail-read');
    await signIn(['mail-read']);
    granted = scopesOf('mail-read', 'calendar-write');
    await signIn(['calendar-write'], 'work1');
    expect((await service.status()).accounts[0]?.access).toEqual({
      gmail: 'read',
      calendar: 'write',
    });
  });

  it('an app password reaches Gmail only, and says what to do for the rest', async () => {
    await service.connectPassword({
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
      access: 'write',
    });
    const id = passwordId(MockMail.ADDRESS);
    await expect(service.setAccess(id, { product: 'calendar', level: 'read' })).rejects.toThrow(
      /only reaches Gmail/,
    );
    // A new password for the same address keeps what the person chose.
    await service.connectPassword({
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
      accountId: id,
    });
    expect((await service.status()).accounts[0]?.access).toEqual({ gmail: 'write' });
  });

  it('Google sign-in for the same address replaces its app password: one entry per address', async () => {
    await service.connectPassword({ address: MockMail.ADDRESS, password: MockMail.PASSWORD });
    who = { sub: 'personal1', email: MockMail.ADDRESS };
    granted = scopesOf('mail-read', 'calendar-read');
    await signIn(['mail-read', 'calendar-read']);
    const accounts = (await service.status()).accounts;
    expect(accounts.map((a) => [a.email, a.via, a.access])).toEqual([
      [MockMail.ADDRESS, 'google', { gmail: 'read', calendar: 'read' }],
    ]);
    expect(JSON.stringify(await store.read())).not.toContain('abcdefgh');
  });

  it('brings an older file up to date without giving anything new', async () => {
    const legacy = new GoogleStore(home);
    await legacy.update((data) => {
      delete data.version;
      data.limits = {};
      data.accounts.old1 = {
        profile: {
          id: 'old1',
          email: 'old@example.com',
          name: 'Old',
          capabilities: ['mail-read', 'mail-draft', 'calendar-read'],
          state: 'ready',
          via: 'google',
        },
        credential: {
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Date.now() + 3_600_000,
          scopes: scopesOf('mail-draft', 'calendar-read'),
          generation: 'g',
        },
      };
    });
    // Saved without a version or limits, as Conch wrote it before; reading brings it up to date.
    const raw = await legacy.read();
    expect(raw.version).toBe(GOOGLE_STORE_VERSION);
    expect(raw.limits.old1).toEqual({ gmail: 'write', calendar: 'read' });
    // Sending didn't exist before: it starts off, so nothing newly reaches out unasked.
    expect(raw.apps.gmail?.tools.google_mail_send).toBe('off');
    expect((await service.status()).accounts[0]?.capabilities).toEqual([
      'mail-read',
      'mail-draft',
      'mail-send',
      'calendar-read',
    ]);
  });
});

describe('which account a call means', () => {
  it('uses the one that can, asks among several, and refuses one that may not', async () => {
    granted = scopesOf('mail-read');
    await signIn(['mail-read']);
    expect((await pickAccount(service, undefined, 'mail-read')).id).toBe('work1');
    expect((await pickAccount(service, 'ADA@work.example', 'mail-read')).id).toBe('work1');
    await expect(pickAccount(service, undefined, 'mail-send')).rejects.toThrow(
      /None of the connected Google accounts may send email/,
    );
    await expect(pickAccount(service, 'ada@work.example', 'mail-send')).rejects.toThrow(
      /hasn’t allowed Conch to send email/,
    );
    await expect(pickAccount(service, 'nobody@example.com', 'mail-read')).rejects.toThrow(
      /No Google account “nobody@example.com”/,
    );
    await service.connectPassword({ address: MockMail.ADDRESS, password: MockMail.PASSWORD });
    await expect(pickAccount(service, undefined, 'mail-read')).rejects.toThrow(
      /Several Google accounts can read Gmail: ada@work.example, /,
    );
  });
});

describe('changes Conch makes, each asked first', () => {
  const event = {
    calendarId: 'primary',
    title: 'Dentist',
    start: '2026-10-08T15:00:00+02:00',
    end: '2026-10-08T16:00:00+02:00',
  };

  it('adds a calendar event with its own id, after one question, without emailing anyone', async () => {
    granted = scopesOf('calendar-write');
    await signIn(['calendar-write']);
    fetcher.mockImplementation(async (url, init) =>
      init?.method === 'POST'
        ? new Response(
            JSON.stringify({
              id: JSON.parse(String(init.body)).id,
              summary: 'Dentist',
              start: { dateTime: event.start },
              end: { dateTime: event.end },
              htmlLink: 'https://www.google.com/calendar/event?eid=x',
            }),
          )
        : new Response('{}'),
    );
    const { ctx, ask } = context();
    const create = tool(googleTools(service, ctx), 'google_calendar_create_event');
    const result = await create.run(event, { operationId: 'op-1' });
    const out = JSON.parse(text(result));
    // What it did, as the person would rather see it (ADR 0060).
    expect(typeof result === 'string' ? undefined : result.view).toMatchObject({
      kind: 'agenda',
      items: [{ title: 'Dentist', start: event.start }],
    });
    expect(out).toMatchObject({
      state: 'confirmed',
      receipt: { label: 'Added to Google Calendar', url: expect.stringContaining('google.com') },
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        once: true,
        summary: expect.stringContaining('add “Dentist” to ada@work.example’s calendar'),
      }),
    );
    const [url, init] = calls('POST')[0] ?? [];
    expect(String(url)).toContain('/calendar/v3/calendars/primary/events?sendUpdates=none');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      id: eventIdFor('op-1'),
      summary: 'Dentist',
      start: { dateTime: event.start },
    });
    expect(eventIdFor('op-1')).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it('never writes when the person says no, or their access changed while the card waited', async () => {
    granted = scopesOf('calendar-write');
    await signIn(['calendar-write']);
    const { ctx } = context('deny');
    const create = tool(googleTools(service, ctx), 'google_calendar_create_event');
    expect(await create.run(event)).toMatchObject({ effect: 'not-executed' });
    const waiting = context();
    waiting.ask.mockImplementation(async () => {
      await service.setAccess('work1', { product: 'calendar', level: 'read' });
      return 'allow';
    });
    const held = tool(googleTools(service, waiting.ctx), 'google_calendar_create_event');
    expect(await held.run(event)).toMatchObject({ effect: 'not-executed' });
    expect(calls('POST')).toHaveLength(0);
  });

  it('a read-only account is never asked, and the model is told how to get more', async () => {
    granted = scopesOf('calendar-read');
    await signIn(['calendar-read']);
    const { ctx, ask } = context();
    const create = tool(googleTools(service, ctx), 'google_calendar_create_event');
    await expect(create.run(event)).rejects.toThrow(/may change Google Calendar/);
    expect(ask).not.toHaveBeenCalled();
  });

  it('finds an event made by an earlier try instead of making a second one', async () => {
    granted = scopesOf('calendar-write');
    await signIn(['calendar-write']);
    fetcher.mockImplementation(async (url) =>
      String(url).includes(`/events/${eventIdFor('op-2')}`)
        ? new Response(JSON.stringify({ id: eventIdFor('op-2'), summary: 'Dentist' }))
        : new Response('{}'),
    );
    const { ctx, ask } = context();
    const create = tool(googleTools(service, ctx), 'google_calendar_create_event');
    expect(JSON.parse(text(await create.run(event, { operationId: 'op-2' })))).toMatchObject({
      state: 'confirmed',
    });
    expect(ask).not.toHaveBeenCalled();
    expect(calls('POST')).toHaveLength(0);
    // Not there at all: the same id can only be added once, so trying again is safe.
    fetcher.mockImplementation(async () => new Response('', { status: 404 }));
    expect(await create.verification?.reconcile(event, 'op-3')).toEqual({ state: 'absent' });
  });

  it('deletes an event it names on the card first, and a gone event is already done', async () => {
    granted = scopesOf('calendar-write');
    await signIn(['calendar-write']);
    fetcher.mockImplementation(async (_url, init) =>
      init?.method === 'DELETE'
        ? new Response('', { status: 410 })
        : new Response(
            JSON.stringify({ id: 'abc123', summary: 'Standup', start: { dateTime: event.start } }),
          ),
    );
    const { ctx, ask } = context();
    const remove = tool(googleTools(service, ctx), 'google_calendar_delete_event');
    const out = JSON.parse(text(await remove.run({ eventId: 'abc123' })));
    expect(out).toMatchObject({
      state: 'confirmed',
      receipt: { label: 'Deleted from Google Calendar' },
    });
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining('delete “Standup”') }),
    );
  });

  it('sends an email through Gmail with exactly its headers, never one hidden in the body', async () => {
    granted = scopesOf('mail-send');
    await signIn(['mail-send']);
    fetcher.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? new Response('{"id":"sent1","threadId":"t1"}') : new Response('{}'),
    );
    const { ctx, ask } = context();
    const send = tool(googleTools(service, ctx), 'google_mail_send');
    const out = JSON.parse(
      text(
        await send.run({
          to: ['sam@example.org'],
          subject: 'Lunch',
          body: 'Noon works.\r\nBcc: thief@evil.example',
        }),
      ),
    );
    expect(out).toMatchObject({
      state: 'confirmed',
      receipt: { id: 'sent1', label: 'Sent from Gmail' },
    });
    expect(ask).toHaveBeenCalledTimes(1);
    const [url, init] = calls('POST')[0] ?? [];
    expect(String(url)).toBe('https://www.googleapis.com/gmail/v1/users/me/messages/send');
    const raw = Buffer.from(JSON.parse(String(init?.body)).raw, 'base64url').toString('utf8');
    expect(raw).toMatch(/^From: ada@work.example$/m);
    expect(raw).toMatch(/^To: sam@example.org$/m);
    expect(raw).not.toMatch(/^Bcc:/m);
    await expect(
      send.run({ to: ['sam@example.org'], subject: 'Hi\r\nBcc: x@evil.example', body: 'x' }),
    ).rejects.toThrow();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('sends with an app password over SMTP only when Gmail may write', async () => {
    await service.connectPassword({ address: MockMail.ADDRESS, password: MockMail.PASSWORD });
    const { ctx, ask } = context();
    const send = tool(googleTools(service, ctx), 'google_mail_send');
    const args = { to: ['sam@example.org'], subject: 'Lunch', body: 'Noon works.' };
    await expect(send.run(args)).rejects.toThrow(/send email/);
    expect(ask).not.toHaveBeenCalled();
    await service.setAccess(passwordId(MockMail.ADDRESS), { product: 'gmail', level: 'write' });
    const out = JSON.parse(text(await send.run(args, { operationId: 'op-mail' })));
    expect(out).toMatchObject({ state: 'confirmed', receipt: { label: 'Sent from Gmail' } });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: ['sam@example.org'], subject: 'Lunch' });
    // The same operation again finds it in Gmail rather than sending it twice.
    expect(JSON.parse(text(await send.run(args, { operationId: 'op-mail' })))).toMatchObject({
      state: 'confirmed',
    });
    expect(mail.sent).toHaveLength(1);
  });

  it('makes a Drive file with a mark that finds it again, and only with Drive write', async () => {
    granted = scopesOf('drive-write');
    await signIn(['drive-write']);
    fetcher.mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? new Response(
            JSON.stringify({
              id: 'file1',
              name: 'Notes',
              webViewLink: 'https://docs.google.com/document/d/file1/edit',
            }),
          )
        : new Response('{}'),
    );
    const { ctx } = context();
    const create = tool(googleTools(service, ctx), 'google_drive_create_file');
    const out = JSON.parse(
      text(await create.run({ name: 'Notes', content: 'Hello' }, { operationId: 'op-d' })),
    );
    expect(out).toMatchObject({
      state: 'confirmed',
      receipt: { id: 'file1', url: 'https://docs.google.com/document/d/file1/edit' },
    });
    const [url, init] = calls('POST')[0] ?? [];
    expect(String(url)).toContain(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    );
    expect(String(init?.body)).toContain(driveTagFor('op-d'));
    expect(String(init?.body)).toContain('application/vnd.google-apps.document');
    expect(new Headers(init?.headers).get('content-type')).toMatch(
      /^multipart\/related; boundary=/,
    );
  });
});

describe('Google apps show what each account may do', () => {
  it('offers write tools only where an account may write, and they always ask', async () => {
    granted = scopesOf('mail-send', 'calendar-read');
    await signIn(['mail-send', 'calendar-read']);
    const apps = new GoogleApps(service, { emit: () => undefined, manualChecks: true });
    await apps.refresh();
    const { ctx } = context();
    const names = apps.tools(googleTools(service, ctx), ctx).map((t) => t.name);
    expect(names).toContain('google_mail_send');
    expect(names).toContain('google_calendar_briefing');
    expect(names).not.toContain('google_calendar_create_event');
    expect(apps.decide('mcp__conch__google_mail_send')).toBe('allow');
    await expect(apps.update('gmail', { tools: { google_mail_send: 'allow' } })).rejects.toThrow(
      /always asks/,
    );
    expect((await apps.get('gmail')).transport).toMatchObject({
      how: 'One account, read & write, with Google sign-in',
    });
    await service.setAccess('work1', { product: 'gmail', level: 'read' });
    await apps.refresh();
    expect(apps.tools(googleTools(service, ctx), ctx).map((t) => t.name)).not.toContain(
      'google_mail_send',
    );
    apps.stop();
  });
});
