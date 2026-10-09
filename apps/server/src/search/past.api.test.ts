/**
 * Looking through earlier chats, end to end (ADR 0059): the real gateway with
 * the mock engine, which calls Conch's tools the bridged way (`mcp__conch__…`),
 * as Claude Code and Codex do.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ConversationEvent, type ServerEvent, type TaintSource } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { onThisComputer } from '../test/here';
import { loadConfig } from '../config';
import type { TurnInput } from '../engines/types';
import { Services } from '../services';

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const services = new Services(
    loadConfig({
      CONCH_HOME: await mkdtemp(join(tmpdir(), 'conch-past-')),
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  // Background tasks wait for room on this computer: don't depend on the host's load.
  vi.spyOn(services.processes, 'readResources').mockResolvedValue({
    at: Date.now(),
    totalBytes: 8 * 1024 ** 3,
    availableBytes: 6 * 1024 ** 3,
    cpuCount: 4,
    loadPerCpu: 0,
    memoryPressure: 0,
    level: 'healthy',
    concurrency: 3,
    reason: 'The test computer has room to work.',
  });
  const app = onThisComputer(await buildApp(services), services);
  open.push(app);
  await app.ready();
  await services.recovery.start(async () => (await app.inject('/api/health')).statusCode === 200);
  // What each turn was given: its tools and its prompt.
  const engine = services.engines.get('mock');
  if (!engine) throw new Error('no mock engine');
  const turns: TurnInput[] = [];
  const runTurn = engine.runTurn.bind(engine);
  vi.spyOn(engine, 'runTurn').mockImplementation((input) => {
    turns.push(input);
    return runTurn(input);
  });
  return { services, turns };
}

function send(
  services: Services,
  text: string,
  extra: { conversationId?: string; untrusted?: TaintSource } = {},
) {
  return new Promise<string>((resolve) => {
    const off = services.broadcast.on((event: ServerEvent) => {
      if (event.type === 'conversation.event' && event.event.type === 'turn.completed') {
        off();
        resolve(event.event.conversationId);
      }
    });
    void services.conversations.send({ clientMessageId: `m${Math.random()}`, text, ...extra });
  });
}

const events = async (services: Services, id: string): Promise<ConversationEvent[]> =>
  (await services.conversations.detail(id)).events;

const reply = (log: ConversationEvent[]) =>
  log.flatMap((e) => (e.type === 'assistant.delta' && e.kind === 'text' ? [e.delta] : [])).join('');

describe('the assistant looks through earlier chats', () => {
  it('finds the line in another chat, reads around it, and says where', async () => {
    const { services, turns } = await setup();
    const voyager = await send(services, 'Tell me about the Voyager golden record');
    await services.search.settled();

    const asking = await send(services, 'Look through my chats for golden record');
    const log = await events(services, asking);
    // Conch's own tools aren't tool rows: the chat says what it looked for, with links.
    const looked = log.flatMap((e) => (e.type === 'chats.looked' ? [e] : []));
    expect(looked.map((e) => e.action)).toEqual(['search', 'read']);
    // Only the other chat: the one asking says “golden record” too.
    expect(looked[0]).toMatchObject({ query: 'golden record' });
    expect(looked[0]?.chats.map((c) => c.id)).toEqual([voyager]);
    expect(looked[0]?.chats[0]?.lines[0]).toMatchObject({
      who: 'you',
      text: 'Tell me about the Voyager golden record',
    });
    expect(looked[1]?.chats[0]?.id).toBe(voyager);
    expect(reply(log)).toMatch(/you said: “Tell me about the Voyager golden record”/);

    const turn = turns.at(-1);
    expect(turn?.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['search_chats', 'read_chat']),
    );
    expect(turn?.systemAppend).toContain('## Earlier chats');

    // Activity says it looked, and opens the chat at that row.
    const page = await services.activity.page();
    expect(page.entries.map((e) => e.title)).toEqual(
      expect.arrayContaining([
        'Looked through your chats for “golden record”',
        expect.stringMatching(/^Read your chat “/),
      ]),
    );
  });

  it('brings what an untrusted chat read along with it', async () => {
    const { services } = await setup();
    const research = await send(services, 'Find reviews of the Lisbon venue');
    await services.conversations.addTaint(research, [{ kind: 'web', label: 'reviews.example' }]);
    await services.search.settled();

    const asking = await send(services, 'Look through my chats for Lisbon venue');
    const taint = (await events(services, asking)).flatMap((e) =>
      e.type === 'taint' ? [e.source] : [],
    );
    expect(taint).toEqual([{ kind: 'app', label: expect.stringMatching(/^your chat “/) }]);
    // The guard now sees this chat as having read something from outside.
    expect(await services.conversations.taintOf(asking)).toHaveLength(1);
  });

  it('isn’t there for someone else on a chat app', async () => {
    const { services, turns } = await setup();
    await send(services, 'My bank PIN reminder: the golden record');
    await services.search.settled();

    const stranger = await send(services, 'Look through my chats for golden record', {
      untrusted: { kind: 'person', label: 'Mallory on Telegram' },
    });
    const log = await events(services, stranger);
    expect(log.some((e) => e.type === 'chats.looked')).toBe(false);
    expect(reply(log)).toMatch(/can’t look through your earlier chats/);
    const turn = turns.at(-1);
    expect(turn?.tools.map((t) => t.name)).not.toContain('search_chats');
    expect(turn?.systemAppend).not.toContain('## Earlier chats');
  });

  const noLookingBack = (turns: TurnInput[]) => {
    for (const turn of turns) {
      expect(turn.tools.map((t) => t.name)).not.toContain('search_chats');
      expect(turn.tools.map((t) => t.name)).not.toContain('read_chat');
      expect(turn.systemAppend).not.toContain('## Earlier chats');
    }
  };

  it('isn’t given to a routine’s run', async () => {
    const { services, turns } = await setup();
    const routine = await services.routines.create(
      {
        title: 'Morning briefing',
        prompt: 'Summarise my day.',
        schedule: { type: 'daily', time: '08:00' },
        timezone: 'Europe/Berlin',
      },
      { createdBy: 'user' },
    );
    await services.routines.runNow(routine.id);
    for (let i = 0; i < 200 && !turns.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(turns).toHaveLength(1);
    noLookingBack(turns);
  });

  it('isn’t given to a background task, scoped or not', async () => {
    const { services, turns } = await setup();
    for (const scope of [undefined, { names: ['artifact_create'] }]) {
      const task = await services.tasks.create({
        kind: 'background',
        text: 'Look through my chats for anything',
        ...(scope && { toolScope: scope }),
      });
      // A task waits for a free slot: wait for it to finish.
      await vi.waitFor(
        async () => {
          const now = (await services.tasks.list()).tasks.find((t) => t.id === task.id);
          expect(now && !['queued', 'running'].includes(now.status)).toBe(true);
        },
        { timeout: 30_000, interval: 20 },
      );
    }
    expect(turns).toHaveLength(2);
    noLookingBack(turns);
  }, 60_000);
});
