import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerEvent } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockMail } from '../channels/mock/email';
import { ChannelError } from '../channels/types';
import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import { IntegrationService } from '../integrations/service';
import { GoogleApps } from './apps';
import { DraftUncertain, GmailImap } from './imap';
import { GoogleService, passwordId } from './service';
import { GoogleStore } from './store';
import { draftMessageId, googleTools } from './tools';

/**
 * Gmail with an app password (ADR 0048), against the pretend mail service:
 * real IMAP on this machine, with Gmail's X-GM-* extensions and APPEND. No
 * Google, no network.
 */
let mail: MockMail;
let home: string;
let events: ServerEvent[];
let healed: string[];
let apps: GoogleApps;
let google: GoogleService;
const ADDRESS = MockMail.ADDRESS;
const PASSWORD = MockMail.PASSWORD;
const noPause = () => Promise.resolve();

beforeEach(async () => {
  mail = new MockMail();
  await mail.start();
  home = await mkdtemp(join(tmpdir(), 'conch-gmail-'));
  events = [];
  healed = [];
  google = new GoogleService(
    new GoogleStore(home),
    undefined,
    undefined,
    new GmailImap(() => ({ imap: mail.endpoints.imap, insecure: true }), noPause),
  );
  apps = new GoogleApps(google, {
    emit: (event) => events.push(event),
    onHeal: (message) => healed.push(message),
    manualChecks: true,
  });
  google.onConnected = (capabilities) => apps.showFor(capabilities);
});

afterEach(async () => {
  apps.stop();
  await mail.stop();
  await rm(home, { recursive: true, force: true });
});

function context(answer: 'allow' | 'deny' = 'allow') {
  const ask = vi.fn(async () => answer);
  const ctx = {
    conversationId: 'c1',
    append: () => undefined,
    engine: {} as ToolContext['engine'],
    permissionMode: 'default',
    ask,
    signal: new AbortController().signal,
  } as unknown as ToolContext;
  return { ctx, ask };
}

const tool = (tools: HostTool[], name: string) => {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

const textOf = (result: Awaited<ReturnType<HostTool['run']>>) =>
  typeof result === 'string' ? result : result.text;

describe('Gmail over IMAP', () => {
  it('reads Gmail’s own ids and search, newest first, and finds a saved draft by its Message-ID', async () => {
    const imap = new GmailImap(() => ({ imap: mail.endpoints.imap, insecure: true }), noPause);
    const login = { address: ADDRESS, password: PASSWORD };
    await imap.verify(login);
    mail.deliver({ from: 'sam@example.org', subject: 'Lunch on Friday', text: 'Pizza?' });
    mail.deliver({ from: 'sam@example.org', subject: 'Lunch moved', text: 'Pasta instead' });
    mail.deliver({ from: 'kim@example.org', subject: 'Invoice', text: 'Attached' });
    const found = await imap.search(login, 'from:sam lunch', 10);
    expect(found.resultSizeEstimate).toBe(2);
    expect(found.messages.map((m) => m.id)).toHaveLength(2);
    expect(found.messages.every((m) => /^[0-9a-f]+$/.test(m.id))).toBe(true);
    const newest = await imap.message(login, found.messages[0]?.id ?? '');
    expect(newest.source.toString()).toContain('Lunch moved');
    expect(newest.labelIds).toContain('INBOX');

    await imap.saveDraft(
      login,
      'To: sam@example.org\r\nSubject: Hi\r\nMessage-ID: <x@draft.conch.invalid>\r\n\r\nYes',
    );
    const drafts = await imap.drafts(login, '<x@draft.conch.invalid>');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.labelIds).toContain('DRAFT');
    // Nothing was sent: there's no SMTP on this path at all.
    expect(mail.sent).toHaveLength(0);
  });

  it('says a refused app password in words, without the password', async () => {
    const imap = new GmailImap(() => ({ imap: mail.endpoints.imap, insecure: true }), noPause);
    const error = await imap
      .verify({ address: ADDRESS, password: 'wrongwrongwrongw' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelError);
    expect((error as ChannelError).code).toBe('auth');
    expect((error as Error).message).not.toContain('wrongwrong');
  });

  it('tries a read again after a blip, but never a draft', async () => {
    let calls = 0;
    const pause = vi.fn(noPause);
    const flaky = new GmailImap(() => {
      calls++;
      // The first try finds nobody listening (Gmail restarting); the next works.
      return calls === 1
        ? { imap: { host: '127.0.0.1', port: 1 }, insecure: true }
        : { imap: mail.endpoints.imap, insecure: true };
    }, pause);
    await flaky.verify({ address: ADDRESS, password: PASSWORD });
    expect(pause).toHaveBeenCalledTimes(1);

    mail.dropNextAppend = true;
    const imap = new GmailImap(() => ({ imap: mail.endpoints.imap, insecure: true }), pause);
    await expect(
      imap.saveDraft({ address: ADDRESS, password: PASSWORD }, 'Subject: x\r\n\r\ny'),
    ).rejects.toBeInstanceOf(DraftUncertain);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});

describe('Gmail as an app', () => {
  it('checks the app password before keeping it, sealed, and never shows it back', async () => {
    await expect(
      google.connectPassword({ address: ADDRESS, password: 'zzzz zzzz zzzz zzzz' }),
    ).rejects.toThrow(/didn’t take that app password/);
    expect((await google.status()).accounts).toHaveLength(0);
    await expect(google.connectPassword({ address: ADDRESS, password: 'short' })).rejects.toThrow(
      /16 letters/,
    );

    const status = await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    expect(status.accounts).toEqual([
      expect.objectContaining({
        email: ADDRESS,
        via: 'app-password',
        capabilities: ['mail-read', 'mail-draft'],
        state: 'ready',
      }),
    ]);
    expect(JSON.stringify(status)).not.toContain('abcdefgh');
    // Kept in the sealed Google store, not anywhere else.
    expect(await readFile(join(home, 'google.secrets.json'), 'utf8')).toContain(ADDRESS);
  });

  it('stops someone guessing app passwords', async () => {
    for (let i = 0; i < 10; i++)
      await google
        .connectPassword({ address: ADDRESS, password: 'zzzzzzzzzzzzzzzz' })
        .catch(() => 0);
    await expect(google.connectPassword({ address: ADDRESS, password: PASSWORD })).rejects.toThrow(
      /a lot of tries/,
    );
  });

  it('is an ordinary integration: listed with its tools, Calendar and Drive only with Google sign-in', async () => {
    await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    await apps.refresh();
    const list = await apps.list();
    expect(list.map((i) => i.id)).toEqual(['gmail']);
    const gmail = list[0];
    expect(gmail).toMatchObject({
      catalogId: 'gmail',
      name: 'Gmail',
      enabled: true,
      policy: 'ask-writes',
      transport: { type: 'host' },
      health: { state: 'ok' },
      account: ADDRESS,
    });
    expect(gmail?.tools.map((t) => [t.name, t.access, t.alwaysAsks ?? false])).toEqual([
      ['google_mail_search', 'read', false],
      ['google_mail_read', 'read', false],
      ['google_mail_create_draft', 'write', true],
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'integration.changed',
        integration: expect.objectContaining({ id: 'gmail' }),
      }),
    );
    // A Calendar tool on an app-password account explains what it needs instead.
    await expect(google.verificationScope(passwordId(ADDRESS), 'calendar-read')).rejects.toThrow(
      /only reaches Gmail/,
    );
  });

  it('gives the model the same Gmail tools, and saves a verified draft only after asking', async () => {
    await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    await apps.refresh();
    mail.deliver({ from: 'sam@example.org', subject: 'Lunch', text: 'Friday at noon?' });
    const { ctx, ask } = context('allow');
    const tools = apps.tools(googleTools(google, ctx), ctx);
    expect(tools.map((t) => t.name)).toEqual([
      'google_accounts',
      'google_mail_search',
      'google_mail_read',
      'google_mail_create_draft',
    ]);
    const accounts = JSON.parse(textOf(await tool(tools, 'google_accounts').run({})));
    expect(accounts.accounts[0]).toMatchObject({ email: ADDRESS, via: 'app-password' });
    const accountId = accounts.accounts[0].id as string;
    const search = JSON.parse(
      textOf(await tool(tools, 'google_mail_search').run({ accountId, query: 'lunch', limit: 5 })),
    );
    const messageId = search.messages[0].id as string;
    const read = JSON.parse(
      textOf(await tool(tools, 'google_mail_read').run({ accountId, messageId })),
    );
    expect(read).toMatchObject({ subject: 'Lunch', from: ['sam@example.org'] });
    expect(read.text).toContain('Friday at noon?');
    expect(read.source).toContain(`#all/${messageId}`);
    // Reading asked nobody: Gmail's default is “Ask before changes”.
    expect(ask).not.toHaveBeenCalled();

    const draft = tool(tools, 'google_mail_create_draft');
    const args = {
      accountId,
      sourceMessageId: messageId,
      to: ['sam@example.org'],
      subject: 'Lunch',
      body: 'Noon works.\r\n.\r\nBcc: someone@evil.example',
    };
    const saved = JSON.parse(textOf(await draft.run(args, { operationId: 'op-1' })));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({
      state: 'confirmed',
      receipt: { label: 'Gmail draft verified — not sent' },
    });
    const [raw] = mail.folder('[Gmail]/Drafts')?.messages ?? [];
    const text = raw?.raw.toString('utf8') ?? '';
    expect(text).toContain(`Message-ID: <${draftMessageId('op-1')}>`);
    expect(text).toMatch(/^In-Reply-To: <[^>]+>$/m);
    // The body is base64: a line in it can't become a header.
    expect(text).not.toMatch(/^Bcc:/m);
    expect(raw?.flags.has('\\Draft')).toBe(true);
    expect(mail.sent).toHaveLength(0);
    // The same operation again finds the same draft rather than saving a second one.
    expect(JSON.parse(textOf(await draft.run(args, { operationId: 'op-1' })))).toMatchObject({
      state: 'confirmed',
    });
    expect(mail.folder('[Gmail]/Drafts')?.messages).toHaveLength(1);
  });

  it('refuses header injection in a draft before anything is asked or saved', async () => {
    await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    await apps.refresh();
    const { ctx, ask } = context('allow');
    const draft = tool(apps.tools(googleTools(google, ctx), ctx), 'google_mail_create_draft');
    const accountId = passwordId(ADDRESS);
    for (const bad of [
      { subject: 'Hi\r\nBcc: someone@evil.example', to: ['sam@example.org'] },
      { subject: 'Hi', to: ['sam@example.org\r\nBcc: someone@evil.example'] },
      { subject: 'Hi', to: ['sam@example.org>, <someone@evil.example'] },
    ])
      await expect(
        draft.run({ accountId, body: 'x', ...bad }, { operationId: 'op-bad' }),
      ).rejects.toThrow();
    expect(ask).not.toHaveBeenCalled();
    expect(mail.folder('[Gmail]/Drafts')?.messages).toHaveLength(0);
  });

  it('holds Off and Ask on every engine: off isn’t offered, ask asks first, a draft can’t be Allow', async () => {
    await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    await apps.refresh();
    await apps.update('gmail', { tools: { google_mail_read: 'off', google_mail_search: 'ask' } });
    await expect(
      apps.update('gmail', { tools: { google_mail_create_draft: 'allow' } }),
    ).rejects.toThrow(/always asks/);
    const { ctx, ask } = context('deny');
    const tools = apps.tools(googleTools(google, ctx), ctx);
    expect(tools.map((t) => t.name)).not.toContain('google_mail_read');
    expect(apps.decide('mcp__conch__google_mail_read')).toBe('off');
    const result = await tool(tools, 'google_mail_search').run({
      accountId: passwordId(ADDRESS),
      query: 'x',
      limit: 5,
    });
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'search your Gmail for “x”' }),
    );
    expect(result).toMatchObject({ effect: 'not-executed' });

    // Turned off as a whole: nothing of Gmail is offered, not even the account list.
    await apps.update('gmail', { enabled: false });
    expect(apps.tools(googleTools(google, ctx), ctx)).toEqual([]);
    expect((await apps.get('gmail')).health).toMatchObject({ state: 'off', action: 'turn-on' });
  });

  it('a revoked app password becomes one “sign in again” with a fix, then heals', async () => {
    await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    await apps.refresh();
    mail.revoke();
    const { ctx } = context();
    const tools = apps.tools(googleTools(google, ctx), ctx);
    await expect(
      tool(tools, 'google_mail_search').run({
        accountId: passwordId(ADDRESS),
        query: 'x',
        limit: 1,
      }),
    ).rejects.toThrow(/didn’t take that app password/);
    await apps.refresh();
    expect((await apps.get('gmail')).health).toMatchObject({
      state: 'needs-auth',
      action: 'reconnect',
    });
    // The person makes a new one (the pretend service takes the usual one again) and pastes it.
    mail.password = PASSWORD.replaceAll(' ', '');
    await google.connectPassword({
      address: ADDRESS,
      password: PASSWORD,
      accountId: passwordId(ADDRESS),
    });
    await apps.refresh();
    expect((await apps.get('gmail')).health.state).toBe('ok');
  });

  it('retries Gmail out of reach by itself, and says so quietly when it’s back', async () => {
    await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    let reachable = false;
    const offline = new GoogleService(
      google.store,
      undefined,
      undefined,
      new GmailImap(
        () =>
          reachable
            ? { imap: mail.endpoints.imap, insecure: true }
            : { imap: { host: '127.0.0.1', port: 1 }, insecure: true },
        noPause,
      ),
    );
    const notes: string[] = [];
    const retrying = new GoogleApps(offline, {
      emit: () => undefined,
      onHeal: (message) => notes.push(message),
      retryAfterMs: [20],
    });
    try {
      await retrying.check('gmail');
      const away = await retrying.get('gmail');
      expect(away.health).toMatchObject({ state: 'error', action: 'retry' });
      expect(away.health.retryAt).toBeGreaterThan(Date.now() - 1000);
      reachable = true;
      await vi.waitFor(async () => expect((await retrying.get('gmail')).health.state).toBe('ok'), {
        timeout: 5_000,
      });
      expect(notes).toEqual(['Gmail couldn’t reach Google for a while; it’s working again.']);
    } finally {
      retrying.stop();
    }
  });

  it('disconnecting Gmail forgets its app password and puts it back in the gallery', async () => {
    await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    await apps.refresh();
    await apps.remove('gmail');
    expect(await apps.list()).toEqual([]);
    expect((await google.status()).accounts).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'integration.deleted', integrationId: 'gmail' });
    expect(await readFile(join(home, 'google.secrets.json'), 'utf8')).not.toContain('abcdefgh');
  });

  it('joins the Integrations page, the prompt and the turn like any other app', async () => {
    await google.connectPassword({ address: ADDRESS, password: PASSWORD });
    await apps.refresh();
    const integrations = new IntegrationService({
      home,
      emit: () => undefined,
      engines: async () => [],
      cwd: async () => home,
      manualChecks: true,
      hosted: apps,
    });
    const list = await integrations.list();
    expect(list.integrations.map((i) => i.id)).toEqual(['gmail']);
    expect(await integrations.get('gmail')).toMatchObject({ name: 'Gmail' });
    const prompt = await integrations.promptSection();
    expect(prompt).toContain('- Gmail (Conch’s own tools `google_mail_search`');
    expect(prompt).toContain('saving a draft always asks, and nothing is ever sent');
    await integrations.update('gmail', { tools: { google_mail_search: 'off' } });
    expect(await integrations.decide('mcp__conch__google_mail_search')).toBe('off');
    // Allowed tools are held by the tools themselves: nothing here asks a second time.
    expect(await integrations.decide('mcp__conch__google_mail_read')).toBeUndefined();
    mail.revoke();
    await integrations.check('gmail');
    expect((await integrations.forTurn('check my gmail inbox please')).issues).toEqual([
      expect.objectContaining({ integrationId: 'gmail', state: 'needs-auth' }),
    ]);
    expect(await integrations.promptSection()).toMatch(/aren’t working right now[^]*- Gmail: /);
  });
});
