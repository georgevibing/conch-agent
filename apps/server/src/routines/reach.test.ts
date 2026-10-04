/**
 * What a routine can reach: the same apps and tools as a chat (never the
 * routine tools), writing to you in your chat apps, and the provider of the
 * chat it was made in.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RoutineRun } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { channelTools } from '../channels/tools';
import { MockTelegram } from '../channels/mock/telegram';
import { loadConfig } from '../config';
import type { TurnInput } from '../engines/types';
import { Services } from '../services';

let services: Services | undefined;

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-reach-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  return services;
}

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function until<T>(fn: () => T | Promise<T>, what: string, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** The mock Telegram bot, connected and paired with its owner. */
async function withTelegram(s: Services) {
  const telegram = s.mockTelegram;
  if (!telegram) throw new Error('no mock Telegram');
  telegram.pollCapMs = 200;
  const channel = await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
  const code = new URL(channel.pairing?.link ?? '').searchParams.get('start');
  telegram.say(`/start ${code}`);
  await until(async () => (await s.channels.get(channel.id)).people.length === 1, 'pairing');
  await until(() => s.channels.reachable().length === 1, 'online');
  return telegram;
}

async function finished(s: Services, routineId: string): Promise<RoutineRun> {
  return until(async () => {
    const [run] = (await s.routines.detail(routineId)).runs;
    return run?.finishedAt && run.status !== 'running' ? run : undefined;
  }, 'the run');
}

const base = {
  title: 'Telegram greeting',
  summary: 'Says hi.',
  timezone: 'Europe/Berlin',
  schedule: { type: 'daily' as const, time: '08:00' },
};

describe('what a routine can reach', () => {
  it('writes to you in a chat app, with your apps’ tools but never the routine tools', async () => {
    const s = await setup();
    const telegram = await withTelegram(s);
    const engine = s.providers.engineFor(undefined);
    const turns = vi.spyOn(engine, 'runTurn');
    const r = await s.routines.create(
      { ...base, prompt: 'Send "hi from your routine" to my Telegram.' },
      { createdBy: 'user' },
    );
    const before = telegram.sent.length;
    await s.routines.runNow(r.id);
    const run = await finished(s, r.id);
    expect(run).toMatchObject({ status: 'succeeded', outcome: 'Sent to the user on Telegram.' });

    // The run had Conch's tools, the way a chat does…
    const tools = (turns.mock.calls.at(-1)?.[0] as TurnInput).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['message_user', 'report_outcome']));
    // …but nothing that could reschedule or rewrite routines.
    expect(tools).not.toEqual(expect.arrayContaining([expect.stringMatching(/routine$/)]));

    // "hi" arrived, and its result isn't said a second time.
    const sent = () =>
      telegram.sent
        .slice(before)
        .filter((m) => m.method === 'sendMessage')
        .map((m) => m.text);
    await until(() => sent().some((t) => t.includes('hi from your routine')), 'the message');
    await new Promise((r) => setTimeout(r, 200));
    expect(sent().filter((t) => t.includes('Telegram greeting'))).toEqual([]);
  });

  it('says plainly when the app asked for isn’t connected', async () => {
    const s = await setup();
    await withTelegram(s);
    await expect(s.channels.messageOwner('hi', { app: 'WhatsApp' })).rejects.toThrow(
      /WhatsApp isn’t connected\. The user can be reached on Telegram/,
    );
    // With no chat app at all, there's no tool to reach for.
    expect(
      channelTools(
        { reachable: () => [], messageOwner: () => Promise.reject() },
        {
          conversationId: 'c_x',
        },
      ),
    ).toEqual([]);
  });

  it('caps what one turn can send', async () => {
    const send = vi.fn().mockResolvedValue({ app: 'Telegram' });
    const [tool] = channelTools(
      {
        reachable: () => [{ id: 'ch_1', kind: 'telegram', name: 'Telegram' }],
        messageOwner: send,
      },
      { conversationId: 'c_x' },
    );
    if (!tool) throw new Error('no tool');
    for (let i = 0; i < 5; i++) expect(await tool.run({ text: `${i}` })).toMatch(/^Sent/);
    expect(await tool.run({ text: 'six' })).toMatch(/^Not sent/);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('runs a routine drafted in a chat on that chat’s provider and model', async () => {
    const s = await setup();
    const engine = s.providers.engineFor(undefined);
    const tools = s.routines.tools({
      conversationId: 'c_chat',
      append: () => undefined,
      engine,
      model: 'opus',
    });
    await tools
      .find((t) => t.name === 'create_routine')
      ?.run({ ...base, prompt: 'Say hi.' } as never);
    const [routine] = await s.routines.list();
    expect(routine?.options).toEqual({ engine: engine.id, model: 'opus' });
    // A routine's own run never gets them.
    expect(
      s.routines.tools({
        conversationId: 'c_run',
        append: () => undefined,
        origin: { kind: 'routine' },
      }),
    ).toEqual([]);
  });
});
