import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CALLS_DEFAULT, type ChannelCalls } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../config';
import { Services } from '../../services';
import { askFirst } from '../../test/modes';
import { MockTwilio } from '../mock/twilio';
import { personId } from '../types';
import { STRANGER_WORDS } from './phone';
import { xml } from './twiml';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

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

/** An SMS number with you let in, its address public, and calls as given. */
async function paired(calls: Partial<ChannelCalls> = { answer: true }) {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-calls-'));
  const s = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  services = s;
  delete process.env.CONCH_MOCK_STATE;
  await askFirst(s);
  await s.start();
  const twilio = s.mockTwilio;
  if (!twilio) throw new Error('no mock Twilio');
  const channel = await s.channels.create(keys);
  await s.door.useTailscale();
  await until(async () => (await s.channels.get(channel.id)).health.state === 'online', 'online');
  await twilio.say('hi');
  await until(async () => (await s.channels.get(channel.id)).requests.length === 1, 'request');
  await s.channels.answer(channel.id, OWNER, 'allow');
  await until(() => twilio.to().some((t) => t.body.includes('connected to Conch')), 'welcome');
  await s.channels.update(channel.id, { settings: { calls: { ...CALLS_DEFAULT, ...calls } } });
  const hook = (await s.channels.get(channel.id)).hook?.url ?? '';
  if (calls.answer) await until(() => twilio.number.voice_url === hook, 'calls pointed at Conch');
  return { s, twilio, channel, hook };
}

const channelChats = async (s: Services) =>
  (await s.conversations.list()).filter((c) => c.origin?.kind === 'channel');

describe('phone calls on the SMS number (ADR 0138)', () => {
  it('points the number’s calls at Conch only once you turn them on', async () => {
    const { s, twilio, channel, hook } = await paired({});
    expect(twilio.number.voice_url).toBe('https://demo.twilio.com/welcome/voice/');
    await s.channels.update(channel.id, {
      settings: { calls: { ...CALLS_DEFAULT, answer: true } },
    });
    await until(() => twilio.number.voice_url === hook, 'calls pointed at Conch');
  });

  it('refuses every forged call: another token, tampered, unsigned, another account', async () => {
    const { s, twilio } = await paired();
    for (const how of ['token', 'tampered', 'unsigned', 'account'] as const)
      expect((await twilio.forgeCall(how)).status, how).toBe(403);
    expect(await channelChats(s)).toHaveLength(0);
  });

  it('a stranger hears one sentence: no turn, no request', async () => {
    const { s, twilio, channel } = await paired();
    const before = (await s.channels.get(channel.id)).requests;
    const answer = await twilio.call(MockTwilio.STRANGER);
    expect(answer.status).toBe(200);
    expect(answer.body).toContain(`<Say>${xml(STRANGER_WORDS)}</Say><Hangup/>`);
    await new Promise((r) => setTimeout(r, 300));
    expect(await channelChats(s)).toHaveLength(0);
    expect((await s.channels.get(channel.id)).requests).toEqual(before);
  });

  it('you talk to your assistant: your words go to your chat, and its answer is said, not texted', async () => {
    const { s, twilio } = await paired();
    const hello = await twilio.call();
    // No whisper.cpp here: Twilio's own hearing and voice.
    expect(hello.body).toContain('<Gather');
    expect(hello.next).toMatch(/\?call=heard$/);
    const texts = twilio.to().length;
    const heard = await twilio.step(hello.next ?? '', hello.sid, { SpeechResult: 'Hello there' });
    expect(heard.next).toMatch(/\?call=wait$/);
    const chat = await until(async () => (await channelChats(s))[0], 'the chat');
    expect(chat.origin).toMatchObject({ channel: 'sms' });
    const said = await until(async () => {
      const turn = await twilio.step(heard.next ?? '', hello.sid);
      return turn.body.includes('<Say>') && !turn.body.includes('Still working') ? turn : undefined;
    }, 'the answer, spoken');
    expect(said.body).toMatch(/<Gather[^>]*><Say>[^<]+<\/Say>/);
    const events = await s.conversations.eventsAfter(chat.id);
    expect(events.some((e) => e.type === 'user.message' && e.text.includes('Hello there'))).toBe(
      true,
    );
    // Said on the call, so not texted as well.
    expect(twilio.to().length).toBe(texts);
    // Twilio says the call is over: counted for today.
    await twilio.ended(twilio.number.voice_url + '?call=status', hello.sid, 42);
    await until(
      async () => (await s.channels.get((await s.channels.list()).channels[0]?.id ?? '')).calls,
      'today’s count',
    );
  });

  it('rings you about an OK that waited, and 1 allows a step a lock-screen tap may allow', async () => {
    const { s, twilio } = await paired({ approvals: true });
    await twilio.say('please run the tests');
    await until(() => twilio.to().find((t) => /Reply with a number/.test(t.body)), 'the question');
    const chat = await until(async () => (await channelChats(s))[0], 'the chat');
    const asked = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'permission.requested'),
      'a question',
    );
    if (asked.type !== 'permission.requested') throw new Error('not a question');
    expect(s.push.approval(chat.id, asked.permissionId)).toMatchObject({ waiting: true });
    await s.approvalCalls.ring(asked.permissionId);
    const call = await until(() => twilio.calls[0], 'a call');
    expect(call).toMatchObject({ to: MockTwilio.OWNER, from: MockTwilio.NUMBER });
    const question = await twilio.pickUp(call);
    expect(question.body).toContain('It needs your OK to');
    const answer = await twilio.step(
      question.next ?? '',
      call.sid,
      { Digits: '1' },
      call.from,
      call.to,
    );
    expect(answer.body).toContain('Allowed. Goodbye.');
    await until(async () => {
      const events = await s.conversations.eventsAfter(chat.id);
      return events.some(
        (e) =>
          e.type === 'permission.resolved' &&
          e.permissionId === asked.permissionId &&
          e.decision === 'allow',
      );
    }, 'allowed');
  });

  it('places no more calls a day than you allowed', async () => {
    const { s, twilio, channel } = await paired({ approvals: true, perDay: 1 });
    const ask = {
      conversationId: 'c1',
      permissionId: 'p1',
      summary: 'Run the tests',
      still: () => ({ waiting: true, quick: true }),
      respond: async () => undefined,
    };
    expect(await s.channels.callOwner(channel.id, ask)).toBe('placed');
    const first = await until(() => twilio.calls[0], 'a call');
    await twilio.ended(first.statusCallback ?? '', first.sid, 20, first.from, first.to);
    expect(await s.channels.callOwner(channel.id, { ...ask, permissionId: 'p2' })).toBe('limit');
    expect(twilio.calls).toHaveLength(1);
    expect((await s.channels.get(channel.id)).calls).toMatchObject({ placed: 1 });
  });

  it('with calls for approvals off, it never rings', async () => {
    const { s, twilio, channel } = await paired({ answer: true, approvals: false });
    const ask = {
      conversationId: 'c1',
      permissionId: 'p1',
      summary: 'Run the tests',
      still: () => ({ waiting: true, quick: true }),
      respond: async () => undefined,
    };
    expect(await s.channels.callOwner(channel.id, ask)).toBe('unavailable');
    expect(await s.channels.phoneLines()).toEqual([]);
    expect(twilio.calls).toHaveLength(0);
  });
});
