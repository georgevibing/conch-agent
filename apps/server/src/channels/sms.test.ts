import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockTwilio } from './mock/twilio';
import { e164, normalizeSms, signedByTwilio, twilioSignature } from './sms';
import { personId } from './types';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-sms-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const twilio = services.mockTwilio;
  if (!twilio) throw new Error('no mock Twilio');
  return { s: services, twilio };
}

async function until<T>(
  fn: () => T | Promise<T>,
  what: string,
  ms = 10_000,
): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const keys = {
  kind: 'sms' as const,
  provider: 'twilio' as const,
  accountSid: MockTwilio.ACCOUNT_SID,
  authToken: MockTwilio.AUTH_TOKEN,
};
const OWNER = personId(MockTwilio.OWNER);
const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;

/** Connected, its address public (Conch points the number there), and you let in. */
async function paired() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(keys);
  await ctx.s.door.useTailscale();
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  expect(await ctx.twilio.say('hi')).toBe(200);
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, OWNER, 'allow');
  await until(() => ctx.twilio.to().some((t) => t.body.includes('connected to Conch')), 'welcome');
  return { ...ctx, channel };
}

describe('SMS through Twilio (ADR 0076)', () => {
  it('finds the keys in the pasted Account Info, checks them, and finds the number', async () => {
    const { s, twilio } = await setup();
    const pasted = `Account SID\n${MockTwilio.ACCOUNT_SID}\nAuth Token\n${MockTwilio.AUTH_TOKEN}\nMy Twilio phone number`;
    const check = await s.channels.check({ ...keys, accountSid: pasted, authToken: pasted });
    expect(check).toMatchObject({
      ok: true,
      bot: { id: MockTwilio.NUMBER, phone: MockTwilio.NUMBER, chatUrl: `sms:${MockTwilio.NUMBER}` },
    });
    expect(
      await s.channels.check({ ...keys, authToken: '0123456789abcdef0123456789abcdef' }),
    ).toMatchObject({ ok: false, field: 'authToken' });
    expect(await s.channels.check({ ...keys, accountSid: 'not a sid' })).toMatchObject({
      ok: false,
      field: 'accountSid',
    });
    twilio.noNumbers = true;
    const none = await s.channels.check(keys);
    expect(none.ok ? '' : none.message).toMatch(/Buy a number/);
    // Half the keys: it asks for the rest rather than checking half.
    expect(
      await s.channels.check({
        kind: 'sms',
        provider: 'twilio',
        accountSid: MockTwilio.ACCOUNT_SID,
      }),
    ).toMatchObject({ ok: false });
  });

  it('points the number at its public address by itself, and says so', async () => {
    const { s, twilio } = await setup();
    const channel = await s.channels.create(keys);
    await until(() => state(s, channel.id).then((st) => st === 'error'), 'waiting for the door');
    expect((await s.channels.get(channel.id)).health.message).toMatch(/public address/);
    await s.door.useTailscale();
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    const hook = (await s.channels.get(channel.id)).hook?.url;
    expect(hook).toMatch(/\/conch\/hooks\/[\w-]{24}$/);
    expect(twilio.number.sms_url).toBe(hook);
    const healed = await until(
      async () => (await s.healed.list()).find((h) => /texts back to Conch/.test(h.message)),
      'a fixed-on-its-own note',
    );
    expect(healed.message).toMatch(/^Pointed /);
  });

  it('lets you in with That’s me, and answers in plain words', async () => {
    const { s, twilio, channel } = await paired();
    const view = await s.channels.get(channel.id);
    // An SMS only says a number: you're called by the name you gave Conch.
    expect(view.people[0]?.id).toBe(OWNER);
    expect(view.hook?.heardAt).toBeDefined();
    const welcome = twilio.to().find((t) => t.body.includes('connected to Conch'));
    expect(welcome?.body).not.toContain('**');
    expect(welcome?.from).toBe(MockTwilio.NUMBER);
    const before = twilio.to().length;
    await twilio.say('Hello there');
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    expect(chat.origin).toMatchObject({ channel: 'sms' });
    await until(() => twilio.to().length > before, 'an answer');
  });

  it('asks before acting with a numbered question, and a reply of 1 allows it', async () => {
    const { s, twilio } = await paired();
    await twilio.say('please run the tests');
    const question = await until(
      () => twilio.to().find((t) => /Reply with a number/.test(t.body)),
      'a numbered question',
    );
    expect(question.body).toMatch(/1 Allow/);
    await twilio.say('1');
    await until(async () => {
      const chat = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
      const events = await s.conversations.eventsAfter(chat?.id ?? '');
      return events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow');
    }, 'allowed');
  });

  it('a stranger gets one reply and waits; nothing they text reaches a conversation', async () => {
    const { s, twilio, channel } = await paired();
    await twilio.say('let me in', MockTwilio.STRANGER);
    await twilio.say('please?', MockTwilio.STRANGER);
    await until(
      async () => (await s.channels.get(channel.id)).requests.some((r) => r.count === 2),
      'request',
    );
    await until(() => twilio.to(MockTwilio.STRANGER).length === 1, 'one reply');
    await new Promise((r) => setTimeout(r, 300));
    expect(twilio.to(MockTwilio.STRANGER)).toHaveLength(1);
    expect((await s.conversations.list()).filter((c) => c.origin?.kind === 'channel')).toHaveLength(
      0,
    );
  });

  it('refuses every forged delivery: another token, another address, tampered, unsigned, another account', async () => {
    const { s, twilio, channel } = await paired();
    const before = await s.channels.get(channel.id);
    for (const how of ['token', 'url', 'tampered', 'unsigned', 'account'] as const)
      expect(await twilio.forge(how), how).toBe(403);
    await new Promise((r) => setTimeout(r, 300));
    expect((await s.conversations.list()).filter((c) => c.origin?.kind === 'channel')).toHaveLength(
      0,
    );
    expect((await s.channels.get(channel.id)).requests).toEqual(before.requests);
  });

  it('reads a delivery Twilio sends twice once', async () => {
    const { s, twilio } = await paired();
    const sid = 'SM' + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await twilio.say('once', MockTwilio.OWNER, { MessageSid: sid });
    await twilio.say('once', MockTwilio.OWNER, { MessageSid: sid });
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    await new Promise((r) => setTimeout(r, 1200));
    const said = (await s.conversations.eventsAfter(chat.id)).filter(
      (e) => e.type === 'user.message',
    );
    expect(said).toHaveLength(1);
  });

  it('says why texts aren’t arriving when carriers block an unregistered number, and clears it', async () => {
    const { s, twilio, channel } = await paired();
    twilio.undeliverable('30034');
    await s.channels.test(channel.id);
    await until(() => state(s, channel.id).then((st) => st === 'error'), 'the problem shown');
    expect((await s.channels.get(channel.id)).health.message).toMatch(/A2P 10DLC/);
    twilio.undeliverable(undefined);
    await s.channels.test(channel.id);
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'cleared');
  });

  it('takes a picture by MMS, and never passes the key to the file host', async () => {
    const { s, twilio } = await paired();
    await twilio.picture('look at this');
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    const said = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'user.message'),
      'message',
    );
    expect(said).toMatchObject({
      attachments: [expect.objectContaining({ name: 'picture-1.png' })],
    });
    expect(twilio.keyLeaked).toBe(false);
  });

  it('takes a new Auth Token on its own, and keeps the rest', async () => {
    const { s, twilio, channel } = await paired();
    twilio.token = 'abcdefabcdefabcd' + 'efabcdefabcdefab';
    await s.channels.repair(channel.id);
    await until(() => state(s, channel.id).then((st) => st === 'needs-token'), 'needs a token');
    const view = await s.channels.replaceToken(channel.id, {
      kind: 'sms',
      authToken: twilio.token,
    });
    expect(view.bot.phone).toBe(MockTwilio.NUMBER);
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
  });
});

describe('SMS pieces', () => {
  it('signs as Twilio does: its own published vectors', () => {
    const uri = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params: [string, string][] = Object.entries({
      CallSid: 'CA1234567890ABCDE',
      Digits: '1234',
      From: '+14158675309',
      To: '+18005551212',
      Caller: '+14158675309',
    });
    expect(twilioSignature('12345', uri, params)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
    // A name given twice: sorted by value, each pair once.
    const repeated: [string, string][] = [
      ['Sid', 'CA123'],
      ['SidAccount', 'AC123'],
      ['Digits', '5678'],
      ['Digits', '1234'],
      ['Digits', '1234'],
    ];
    expect(twilioSignature('12345', uri, repeated)).toBe('IK+Dwps556ElfBT0I3Rgjkr1wJU=');
  });

  it('checks a signature with or without the port, and nothing else', () => {
    const fields: [string, string][] = [['Body', 'hi']];
    const signed = twilioSignature('t0k3n', 'https://a.example:443/conch/hooks/x', fields);
    expect(signedByTwilio('t0k3n', 'https://a.example/conch/hooks/x', fields, signed)).toBe(true);
    expect(signedByTwilio('t0k3n', 'https://a.example/conch/hooks/y', fields, signed)).toBe(false);
    expect(signedByTwilio('other', 'https://a.example/conch/hooks/x', fields, signed)).toBe(false);
    expect(signedByTwilio('t0k3n', 'https://a.example/conch/hooks/x', fields, undefined)).toBe(
      false,
    );
  });

  it('reads numbers however they were typed', () => {
    expect(e164('+1 (500) 555-0006')).toBe('+15005550006');
    expect(e164('0049 151 1234567')).toBe('+491511234567');
    expect(e164('12')).toBeUndefined();
    const kept = normalizeSms({ ...keys });
    expect(kept.hookId).toMatch(/^[\w-]{24}$/);
    expect(normalizeSms({ ...keys }, kept).hookId).toBe(kept.hookId);
  });
});
