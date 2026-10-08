/**
 * Many Google accounts, each with its own access per product (read, or read
 * and write), and the changes Conch can make once a person allows them:
 * sending, calendar events, Drive files. Fake Google endpoints and the
 * pretend mail service; no real account.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Attachment, TaintSource } from '@conch/protocol';

import { filesOf } from '../channels/outbound';
import { MockMail } from '../channels/mock/email';
import type { AskRequest, ToolContext } from '../conversations/manager';
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
    // Sending follows the account's level and asks first, like every new setup (ADR 0104).
    expect(raw.apps.gmail?.tools.google_mail_send).toBeUndefined();
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
    // The one account says why, in words the model can pass on, with the way to change it.
    await expect(pickAccount(service, undefined, 'mail-send')).rejects.toThrow(
      /ada@work\.example yet: this sign-in is read only\. .*Apps → Gmail → Google accounts/,
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
    await expect(create.run(event)).rejects.toThrow(
      /Google hasn’t allowed Conch to change Google Calendar.*Apps → Google Calendar → Google accounts/,
    );
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
    const result = await send.run(args, { operationId: 'op-mail' });
    const out = JSON.parse(text(result));
    expect(out).toMatchObject({ state: 'confirmed', receipt: { label: 'Sent from Gmail' } });
    // No message id from SMTP: Gmail's own search for the one Conch gave it finds it.
    expect(typeof result === 'string' ? undefined : result.view).toMatchObject({
      kind: 'mail-sent',
      state: 'sent',
      url: expect.stringContaining('#search/rfc822msgid%3Aconch.'),
    });
    // In a task the call is the ledger's: the card shows it as it is.
    expect((ask.mock.calls as unknown as [AskRequest][])[0]?.[0]).not.toHaveProperty('edit');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: ['sam@example.org'], subject: 'Lunch' });
    // The same operation again finds it in Gmail rather than sending it twice.
    expect(JSON.parse(text(await send.run(args, { operationId: 'op-mail' })))).toMatchObject({
      state: 'confirmed',
    });
    expect(mail.sent).toHaveLength(1);
  });

  describe('an email changed on its card', () => {
    const asked = { to: ['sam@example.org'], subject: 'Lunch', body: 'Noon works.' };
    const change = {
      to: ['kim@example.org'],
      cc: ['sam@example.org'],
      subject: 'Lunch on Friday',
      body: 'Friday, noon. ☀️',
    };
    /** Answers the card as the manager does: the change first, a no if it can't be used. */
    const answering = (proposed?: unknown) => {
      const ask = vi.fn(async (request: AskRequest) => {
        if (proposed === undefined) return 'allow' as const;
        try {
          request.edit?.(proposed as typeof change);
        } catch {
          return 'deny' as const;
        }
        return 'allow' as const;
      });
      return { ask, ctx: { ask, signal: new AbortController().signal } as unknown as ToolContext };
    };
    /** The one email Gmail was handed, read back. */
    const sentRaw = () => {
      const [, init] = calls('POST')[0] ?? [];
      return Buffer.from(JSON.parse(String(init?.body)).raw, 'base64url').toString('utf8');
    };
    const header = (raw: string, key: string) =>
      new RegExp(`^${key}: (.*(?:\\r\\n .*)*)`, 'm')
        .exec(raw)?.[1]
        ?.replace(/\r\n /g, '')
        .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, v: string) =>
          Buffer.from(v, 'base64').toString('utf8'),
        );
    const bodyOf = (raw: string) =>
      Buffer.from(raw.slice(raw.indexOf('\r\n\r\n') + 4), 'base64').toString('utf8');

    beforeEach(async () => {
      granted = scopesOf('mail-send');
      await signIn(['mail-send']);
      fetcher.mockImplementation(async (_url, init) =>
        init?.method === 'POST'
          ? new Response('{"id":"sent1","threadId":"t1"}')
          : new Response('{}'),
      );
    });

    it('sends exactly what the person approved, and tells the model what they changed', async () => {
      const { ctx, ask } = answering(change);
      const result = await tool(googleTools(service, ctx), 'google_mail_send').run(asked);
      expect(ask).toHaveBeenCalledTimes(1);
      const raw = sentRaw();
      expect(header(raw, 'To')).toBe('kim@example.org');
      expect(header(raw, 'Cc')).toBe('sam@example.org');
      expect(header(raw, 'Subject')).toBe('Lunch on Friday');
      expect(header(raw, 'From')).toBe('ada@work.example');
      expect(bodyOf(raw)).toBe('Friday, noon. ☀️');
      expect(JSON.parse(text(result))).toMatchObject({
        state: 'confirmed',
        changedByPerson: ['to', 'cc', 'subject', 'body'],
        sent: change,
      });
      expect(typeof result === 'string' ? undefined : result.view).toMatchObject({
        kind: 'mail-sent',
        state: 'sent',
        from: 'ada@work.example',
        to: [{ address: 'kim@example.org' }],
        cc: [{ address: 'sam@example.org' }],
        subject: 'Lunch on Friday',
        body: 'Friday, noon. ☀️',
        edited: true,
        url: expect.stringContaining('#sent/sent1'),
      });
    });

    it('sends nothing when the change isn’t an email Gmail could send', async () => {
      for (const bad of [
        { ...change, to: ['not an address'] },
        { ...change, to: [] },
        { ...change, subject: 'Hi\r\nBcc: thief@evil.example' },
        { ...change, accountId: 'other@work.example' },
      ]) {
        const { ctx } = answering(bad);
        const result = await tool(googleTools(service, ctx), 'google_mail_send').run(asked);
        expect(result).toMatchObject({ effect: 'not-executed' });
        expect(text(result)).toMatch(/couldn’t be used.*Nothing was sent\.$/);
      }
      expect(calls('POST')).toHaveLength(0);
    });

    it('offers the card for changing in a chat, and says so to nobody when nothing changed', async () => {
      const { ctx, ask } = answering();
      const result = await tool(googleTools(service, ctx), 'google_mail_send').run(asked);
      expect(ask.mock.calls[0]?.[0]).toMatchObject({ once: true, edit: expect.any(Function) });
      expect(JSON.parse(text(result))).not.toHaveProperty('changedByPerson');
      expect(typeof result === 'string' ? undefined : result.view).not.toHaveProperty('edited');
      expect(header(sentRaw(), 'To')).toBe('sam@example.org');
    });
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
  it('offers write tools only where an account may write, and they ask first', async () => {
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
    expect(apps.chosen('google_mail_send')).toBeUndefined();
    // A calendar change still always asks: Allow isn't one of its choices.
    await expect(
      apps.update('google-calendar', { tools: { google_calendar_create_event: 'allow' } }),
    ).rejects.toThrow();
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

describe('sending email, end to end (ADR 0104)', () => {
  const PDF = Buffer.from('%PDF-1.4 the invoice');
  /** The chat's own files, as `filesOf` gives them to message_user: by id, never a path. */
  const chatFiles = async () => {
    const path = join(home, 'invoice.pdf');
    await writeFile(path, PDF);
    const store = {
      inConversation: async (id: string, conversationId: string) =>
        id === 'att_invoice1' && conversationId === 'c1'
          ? {
              path,
              attachment: {
                id,
                name: 'invoice.pdf',
                mimeType: 'application/pdf',
                kind: 'file',
              } as unknown as Attachment,
            }
          : undefined,
    };
    return (ids: readonly string[]) => filesOf(store, ids, 'c1');
  };
  /** A chat that has, or hasn't, read something from outside. */
  function chat(read: TaintSource[] = [], answer: 'allow' | 'deny' = 'allow') {
    const ask = vi.fn(async () => answer);
    const ctx = {
      conversationId: 'c1',
      ask,
      signal: new AbortController().signal,
      taints: () => read,
      untrusted: () => (read.length ? 'This chat read an email.' : undefined),
    } as unknown as ToolContext;
    return { ask, ctx };
  }

  it('an app-password account set to Read & write is offered sending, and it goes over SMTP with its files', async () => {
    await service.connectPassword({
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
      access: 'write',
    });
    const apps = new GoogleApps(service, { emit: () => undefined, manualChecks: true });
    await apps.refresh();
    const { ctx, ask } = chat();
    const options = { chosen: (n: string) => apps.chosen(n), files: await chatFiles() };
    const tools = apps.tools(googleTools(service, ctx, undefined, options), ctx);
    expect(tools.map((t) => t.name)).toContain('google_mail_send');
    const send = tool(tools, 'google_mail_send');
    expect(send.description).not.toMatch(/no attachments/i);
    const out = JSON.parse(
      text(
        await send.run(
          {
            to: ['sam@example.org'],
            subject: 'Invoice for March',
            body: 'Here is the invoice.',
            attachments: ['att_invoice1'],
          },
          { operationId: 'op-smtp' },
        ),
      ),
    );
    expect(out).toMatchObject({ state: 'confirmed', receipt: { label: 'Sent from Gmail' } });
    // One question, showing From, To, the files and the words.
    expect(ask).toHaveBeenCalledOnce();
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'google_mail_send',
        once: true,
        input: expect.objectContaining({
          accountEmail: MockMail.ADDRESS,
          to: ['sam@example.org'],
          files: ['invoice.pdf'],
        }),
        summary: expect.stringContaining(`from ${MockMail.ADDRESS}`),
      }),
    );
    expect(mail.sent).toHaveLength(1);
    const sent = mail.sent[0];
    expect(sent).toMatchObject({
      from: MockMail.ADDRESS,
      to: ['sam@example.org'],
      subject: 'Invoice for March',
      text: 'Here is the invoice.',
    });
    expect(sent?.raw).toMatch(new RegExp(`^From: ${MockMail.ADDRESS}$`, 'm'));
    expect(sent?.files).toEqual([
      { name: 'invoice.pdf', type: 'application/pdf', size: PDF.length, inline: false },
    ]);
    apps.stop();
  });

  it('refuses a file that isn’t this chat’s, before asking or sending', async () => {
    await service.connectPassword({
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
      access: 'write',
    });
    const { ctx, ask } = chat();
    const send = tool(
      googleTools(service, ctx, undefined, { files: await chatFiles() }),
      'google_mail_send',
    );
    await expect(
      send.run({ to: ['sam@example.org'], subject: 'x', body: 'x', attachments: ['att_other99'] }),
    ).rejects.toThrow(/no file .* in this chat/i);
    expect(ask).not.toHaveBeenCalled();
    expect(mail.sent).toHaveLength(0);
  });

  it('a file may be taken off on the card, never put on, and the sent card shows what went', async () => {
    granted = scopesOf('mail-send');
    await signIn(['mail-send']);
    fetcher.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? new Response('{"id":"sent3","threadId":"t3"}') : new Response('{}'),
    );
    const known: Record<string, string> = { att_a1: 'plan.pdf', att_b2: 'budget.xlsx' };
    const files = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({
        name: known[id] ?? 'x',
        mimeType: 'application/octet-stream',
        bytes: Buffer.from(id),
      })),
    );
    const args = {
      to: ['sam@example.org'],
      subject: 'Plan',
      body: 'Both files.',
      attachments: ['att_a1', 'att_b2'],
    };
    const answering = (attachments: string[]) => {
      const ask = vi.fn(async (request: AskRequest) => {
        try {
          request.edit?.({ to: args.to, subject: args.subject, body: args.body, attachments });
        } catch {
          return 'deny' as const;
        }
        return 'allow' as const;
      });
      const ctx = { ask, signal: new AbortController().signal } as unknown as ToolContext;
      return {
        ask,
        send: tool(googleTools(service, ctx, undefined, { files }), 'google_mail_send'),
      };
    };
    // Put on: refused, nothing sent.
    const adding = answering(['att_a1', 'att_b2', 'att_c3']);
    expect(await adding.send.run(args)).toMatchObject({ effect: 'not-executed' });
    expect(calls('POST')).toHaveLength(0);
    // Taken off: the rest goes, weighed and read again.
    const removing = answering(['att_a1']);
    const result = await removing.send.run(args);
    expect(removing.ask.mock.calls[0]?.[0].input).toMatchObject({
      files: ['plan.pdf', 'budget.xlsx'],
    });
    expect(files).toHaveBeenLastCalledWith(['att_a1']);
    const raw = Buffer.from(
      JSON.parse(String(calls('POST')[0]?.[1]?.body)).raw,
      'base64url',
    ).toString('utf8');
    expect(raw).toContain('filename="plan.pdf"');
    expect(raw).not.toContain('budget.xlsx');
    expect(JSON.parse(text(result))).toMatchObject({ changedByPerson: ['attachments'] });
    expect(typeof result === 'string' ? undefined : result.view).toMatchObject({
      kind: 'mail-sent',
      edited: true,
      files: [{ name: 'plan.pdf', size: 6 }],
    });
  });

  it('a Google sign-in sends through Gmail’s API, and a big email is uploaded whole', async () => {
    granted = scopesOf('mail-send');
    await signIn(['mail-send']);
    fetcher.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? new Response('{"id":"sent2","threadId":"t2"}') : new Response('{}'),
    );
    const big = Buffer.alloc(4_000_000, 7);
    const { ctx } = chat();
    const send = tool(
      googleTools(service, ctx, undefined, {
        files: async () => [{ name: 'photos.zip', mimeType: 'application/zip', bytes: big }],
      }),
      'google_mail_send',
    );
    const out = JSON.parse(
      text(
        await send.run({
          to: ['sam@example.org'],
          subject: 'Photos',
          body: 'All of them.',
          attachments: ['att_photos1'],
        }),
      ),
    );
    expect(out).toMatchObject({ state: 'confirmed', receipt: { id: 'sent2' } });
    const [url, init] = calls('POST')[0] ?? [];
    expect(String(url)).toBe(
      'https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart',
    );
    expect(new Headers(init?.headers).get('content-type')).toMatch(
      /^multipart\/related; boundary=/,
    );
    const body = String(init?.body);
    expect(body).toContain('Content-Type: message/rfc822');
    expect(body).toMatch(/^From: ada@work.example$/m);
    expect(body).toContain('filename="photos.zip"');
  });

  it('sends from the account the person names, and shows a guessed one first even when allowed', async () => {
    granted = scopesOf('mail-send');
    await signIn(['mail-send']);
    await service.connectPassword({
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
      access: 'write',
    });
    const apps = new GoogleApps(service, { emit: () => undefined, manualChecks: true });
    await apps.refresh();
    await apps.update('gmail', { tools: { google_mail_send: 'allow' } });
    const { ctx, ask } = chat();
    const send = tool(
      googleTools(service, ctx, undefined, { chosen: (n) => apps.chosen(n) }),
      'google_mail_send',
    );
    // Named: that account, and (allowed, nothing read) no question.
    await send.run({
      accountId: MockMail.ADDRESS,
      to: ['sam@example.org'],
      subject: 'From the pro account',
      body: 'Hi',
    });
    expect(ask).not.toHaveBeenCalled();
    expect(mail.sent.at(-1)).toMatchObject({ from: MockMail.ADDRESS });
    // Not named, two can send: the first is used, and the person sees which before it goes.
    fetcher.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? new Response('{"id":"sent3"}') : new Response('{}'),
    );
    await send.run({ to: ['sam@example.org'], subject: 'Which one?', body: 'Hi' });
    expect(ask).toHaveBeenCalledOnce();
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ accountEmail: 'ada@work.example' }),
      }),
    );
    apps.stop();
  });

  it('Allow still asks once the chat read something from outside; the person’s own Ask stays explicit', async () => {
    await service.connectPassword({
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
      access: 'write',
    });
    const apps = new GoogleApps(service, { emit: () => undefined, manualChecks: true });
    await apps.refresh();
    await apps.update('gmail', { tools: { google_mail_send: 'allow' } });
    const read = chat([{ kind: 'app', label: 'Gmail' }], 'deny');
    const send = tool(
      googleTools(service, read.ctx, undefined, { chosen: (n) => apps.chosen(n) }),
      'google_mail_send',
    );
    const args = { to: ['thief@evil.example'], subject: 'Secrets', body: 'All of them' };
    expect(await send.run(args)).toMatchObject({ effect: 'not-executed' });
    expect(read.ask).toHaveBeenCalledWith(
      expect.objectContaining({ taint: 'This chat read an email.', once: true }),
    );
    expect(mail.sent).toHaveLength(0);

    await apps.update('gmail', { tools: { google_mail_send: 'ask' } });
    const { ctx, ask } = chat();
    await tool(
      googleTools(service, ctx, undefined, { chosen: (n) => apps.chosen(n) }),
      'google_mail_send',
    ).run({ to: ['sam@example.org'], subject: 'Hi', body: 'Hi' });
    // Set to Ask by the person: Auto keeps asking (explicit), Full trust still decides.
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ explicit: true, once: true }));
    apps.stop();
  });

  it('a read-only setup refuses in plain words, with what to do', async () => {
    await service.connectPassword({ address: MockMail.ADDRESS, password: MockMail.PASSWORD });
    const apps = new GoogleApps(service, { emit: () => undefined, manualChecks: true });
    await apps.refresh();
    const { ctx, ask } = chat();
    expect(apps.tools(googleTools(service, ctx), ctx).map((t) => t.name)).not.toContain(
      'google_mail_send',
    );
    const send = tool(googleTools(service, ctx), 'google_mail_send');
    await expect(send.run({ to: ['sam@example.org'], subject: 'x', body: 'x' })).rejects.toThrow(
      /can’t send email\. The person can change that in Apps → Gmail → Google accounts \(Read & write\)\. Offer that, or a draft instead\./,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(mail.sent).toHaveLength(0);
    apps.stop();
  });

  it('takes back version 2’s own “send off”, so Read & write can send again', async () => {
    await service.connectPassword({
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
      access: 'write',
    });
    // As ADR 0099's migration left it: version 2, sending switched off by Conch itself.
    await store.update((data) => {
      data.version = 2;
      data.apps.gmail = {
        enabled: true,
        policy: 'ask-writes',
        tools: { google_mail_send: 'off' },
        hidden: false,
      };
    });
    const data = await store.read();
    expect(data.version).toBe(GOOGLE_STORE_VERSION);
    expect(data.apps.gmail?.tools.google_mail_send).toBeUndefined();
    const apps = new GoogleApps(service, { emit: () => undefined, manualChecks: true });
    await apps.refresh();
    expect(apps.decide('google_mail_send')).toBe('allow');
    // A choice made since is the person's, and stays.
    await apps.update('gmail', { tools: { google_mail_send: 'off' } });
    expect((await store.read()).apps.gmail?.tools.google_mail_send).toBe('off');
    expect(apps.decide('google_mail_send')).toBe('off');
    apps.stop();
  });

  it('“Use an app password instead” moves Gmail to it, and the sign-in keeps Calendar', async () => {
    who = { sub: 'pro1', email: MockMail.ADDRESS };
    granted = scopesOf('mail-read', 'calendar-read');
    await signIn(['mail-read', 'calendar-read']);
    await service.connectPassword({
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
      access: 'write',
    });
    const accounts = (await service.status()).accounts;
    expect(accounts.find((a) => a.via === 'google')?.access).toEqual({ calendar: 'read' });
    expect(accounts.find((a) => a.via === 'app-password')?.access).toEqual({ gmail: 'write' });
    // Gmail has one account for the address: the one that can send.
    expect((await pickAccount(service, MockMail.ADDRESS, 'mail-send')).via).toBe('app-password');
  });
});
