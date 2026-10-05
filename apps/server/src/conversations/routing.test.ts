import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Capabilities,
  ConversationEvent,
  EngineId,
  EngineStatus,
  TurnProblem,
} from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager, type TurnRoute, windDown } from './manager';
import { ConversationStore } from './store';

/** Answers "<label> heard: <prompt>", or fails with `fails` when set. */
class FakeEngine implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  fails?: TurnProblem;

  constructor(
    readonly id: EngineId,
    readonly label: string,
    readonly local = false,
  ) {}

  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }

  async capabilities(): Promise<Capabilities> {
    return {
      engine: this.id,
      label: this.label,
      models: [],
      commands: [],
      permissionModes: ['default'],
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'session', resumeId: `${this.id}-s`, model: `${this.id}-model` };
    if (this.fails) {
      yield { type: 'done', outcome: 'error', error: 'nope', problem: this.fails };
      return;
    }
    yield {
      type: 'text',
      messageId: `m${Math.random()}`,
      delta: `${this.label} heard: ${input.prompt}`,
    };
    yield { type: 'done', outcome: 'success' };
  }
}

/** A manager whose routing is decided by the test: online or not, and a fallback at the limit. */
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-routing-'));
  const claude = new FakeEngine('claude-code', 'Claude Code');
  const router = new FakeEngine('openrouter', 'OpenRouter');
  const ollama = new FakeEngine('mock', 'Ollama', true);
  const engines = new Map<EngineId, FakeEngine>([
    ['claude-code', claude],
    ['openrouter', router],
    ['mock', ollama],
  ]);
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'claude-code', autoTitle: false } });
  const world = { online: true, localAnswers: true, atLimit: undefined as EngineId | undefined };
  const route = async (engine: Engine, context: { failed?: TurnProblem }): Promise<TurnRoute> => {
    if (!engine.local && !world.online)
      return world.localAnswers
        ? {
            kind: 'use',
            engine: ollama,
            routed: { reason: 'offline', message: 'offline, local answered' },
          }
        : { kind: 'hold' };
    if (world.atLimit && world.atLimit !== engine.id && context.failed === 'limit') {
      const other = engines.get(world.atLimit);
      if (other)
        return {
          kind: 'use',
          engine: other,
          routed: { reason: 'limit', message: 'limit, switched' },
        };
    }
    return { kind: 'use', engine };
  };
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: (id) => engines.get(id ?? 'claude-code') ?? claude,
    route,
  });
  return { manager, claude, router, ollama, world };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 2000; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

async function log(manager: ConversationManager, id: string): Promise<ConversationEvent[]> {
  return (await manager.detail(id)).events;
}

describe('offline and at a limit (ADR 0023)', () => {
  it('offline with nothing local, a message waits — and goes when the internet is back', async () => {
    const { manager, claude, world } = await setup();
    world.online = false;
    world.localAnswers = false;

    const convo = await manager.send({ clientMessageId: 'u1', text: 'hello there' });
    const waiting = await log(manager, convo.id);
    expect(waiting.map((e) => e.type)).toContain('turn.held');
    expect(claude.turns).toHaveLength(0);

    // Still offline: nothing goes.
    expect(await manager.releaseHeld()).toBe(0);

    world.online = true;
    expect(await manager.releaseHeld()).toBe(1);
    await idle(manager, convo.id);
    expect(claude.turns.map((t) => t.prompt)).toEqual(['hello there']);
    const after = await log(manager, convo.id);
    // It answered with the chat's own provider; nothing was routed elsewhere.
    expect(after.some((e) => e.type === 'turn.routed')).toBe(false);
    expect(after.at(-2)).toMatchObject({ type: 'turn.completed', outcome: 'success' });
  });

  it('two messages sent while offline wait together, and go as one', async () => {
    const { manager, claude, world } = await setup();
    world.online = false;
    world.localAnswers = false;
    const convo = await manager.send({ clientMessageId: 'u1', text: 'first thought' });
    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'second thought' });

    world.online = true;
    expect(await manager.releaseHeld()).toBe(1);
    await idle(manager, convo.id);
    expect(claude.turns).toHaveLength(1);
    expect(claude.turns[0]?.prompt).toBe(
      'first thought' + String.fromCharCode(10, 10) + 'second thought',
    );
  });

  it('offline, the model on this computer answers — and says so', async () => {
    const { manager, claude, ollama, world } = await setup();
    world.online = false;

    const convo = await manager.send({ clientMessageId: 'u1', text: 'what time is it' });
    await idle(manager, convo.id);
    expect(claude.turns).toHaveLength(0);
    expect(ollama.turns).toHaveLength(1);
    const events = await log(manager, convo.id);
    expect(events.find((e) => e.type === 'turn.routed')).toMatchObject({
      from: 'claude-code',
      to: 'mock',
      reason: 'offline',
    });
    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({ engine: 'mock' });
  });

  it('a waiting message can go now with the model on this computer', async () => {
    const { manager, claude, ollama, world } = await setup();
    world.online = false;
    world.localAnswers = false;
    const convo = await manager.send({ clientMessageId: 'u1', text: 'summarise my day' });

    expect(await manager.release(convo.id, 'mock')).toBe(true);
    await idle(manager, convo.id);
    expect(ollama.turns.map((t) => t.prompt)).toEqual(['summarise my day']);
    expect(claude.turns).toHaveLength(0);
    // Once sent, it isn't waiting anymore.
    world.online = true;
    expect(await manager.releaseHeld()).toBe(0);
    expect(await manager.release(convo.id)).toBe(false);
  });

  it('at a limit, your pick answers the same message', async () => {
    const { manager, claude, router, world } = await setup();
    claude.fails = 'limit';
    world.atLimit = 'openrouter';

    const convo = await manager.send({ clientMessageId: 'u1', text: 'keep going' });
    await idle(manager, convo.id);
    expect(claude.turns).toHaveLength(1);
    expect(router.turns).toHaveLength(1);
    // OpenRouter is told what happened before (the hand-over) and gets the message.
    expect(router.turns[0]?.prompt.endsWith('keep going')).toBe(true);
    // …once: the message it answers isn't also handed over as history.
    expect(router.turns[0]?.prompt).not.toContain('User: keep going');
    const events = await log(manager, convo.id);
    expect(events.find((e) => e.type === 'turn.routed')).toMatchObject({
      from: 'claude-code',
      to: 'openrouter',
      reason: 'limit',
    });
    // The chat never showed a failure it was about to fix.
    expect(events.some((e) => e.type === 'status' && e.status === 'error')).toBe(false);
    expect(events.at(-2)).toMatchObject({
      type: 'turn.completed',
      outcome: 'success',
      engine: 'openrouter',
    });
  });

  it('at a limit with no pick, the failure stands (no silent switching)', async () => {
    const { manager, claude, router } = await setup();
    claude.fails = 'limit';
    const convo = await manager.send({ clientMessageId: 'u1', text: 'keep going' });
    await idle(manager, convo.id);
    expect(router.turns).toHaveLength(0);
    const events = await log(manager, convo.id);
    expect(events.some((e) => e.type === 'turn.routed')).toBe(false);
    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({ problem: 'limit' });
  });

  it('a provider that stops answering because the internet went, waits for it', async () => {
    const { manager, claude, world } = await setup();
    world.localAnswers = false;
    claude.fails = 'unavailable';
    const convo = await manager.send({ clientMessageId: 'u1', text: 'are you there' });
    world.online = false; // it went while the turn was running
    await idle(manager, convo.id);
    // (The route is asked again after the failure: offline, nothing local → it waits.)
    const events = await log(manager, convo.id);
    // Decided before the turn's end went out: waiting, never "failed" in between.
    expect(events.slice(-3).map((e) => e.type)).toEqual(['turn.completed', 'turn.held', 'status']);
    expect(events.at(-1)).toMatchObject({ type: 'status', status: 'idle' });
    expect(events.some((e) => e.type === 'status' && e.status === 'error')).toBe(false);

    claude.fails = undefined;
    world.online = true;
    expect(await manager.releaseHeld()).toBe(1);
    await idle(manager, convo.id);
    expect(claude.turns.at(-1)?.prompt).toContain('are you there');
  });

  it('two releases at once send a waiting message once', async () => {
    const { manager, claude, world } = await setup();
    world.online = false;
    world.localAnswers = false;
    const convo = await manager.send({ clientMessageId: 'u1', text: 'only once' });
    world.online = true;
    const sent = await Promise.all([manager.release(convo.id), manager.release(convo.id)]);
    expect(sent.filter(Boolean)).toHaveLength(1);
    await idle(manager, convo.id);
    expect(claude.turns.map((t) => t.prompt)).toEqual(['only once']);
  });
});

describe('Stop, pressed a moment early', () => {
  it('stops the turn that was about to start, without running it', async () => {
    const { manager, claude } = await setup();
    const convo = await manager.send({ clientMessageId: 'u1', text: 'first' });
    await idle(manager, convo.id);
    // Stop lands before the next turn has begun (right after pressing Enter).
    await manager.interrupt(convo.id);
    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'second' });
    await idle(manager, convo.id);
    expect(claude.turns.map((t) => t.prompt)).toEqual(['first']);
    const events = await log(manager, convo.id);
    expect(events.findLast((e) => e.type === 'turn.completed')).toMatchObject({
      outcome: 'interrupted',
    });
  });

  it('a Stop from long ago doesn’t stop the next message', async () => {
    const { manager, claude } = await setup();
    const convo = await manager.send({ clientMessageId: 'u1', text: 'first' });
    await idle(manager, convo.id);
    await manager.interrupt(convo.id);
    const later = Date.now() + 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'second' });
    } finally {
      clock.mockRestore();
    }
    await idle(manager, convo.id);
    expect(claude.turns.map((t) => t.prompt).at(-1)).toContain('second');
  });

  it('a Stop that came a few seconds before the next message was for the turn before', async () => {
    const { manager, claude } = await setup();
    const convo = await manager.send({ clientMessageId: 'u1', text: 'first' });
    await idle(manager, convo.id);
    await manager.interrupt(convo.id);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_000);
    try {
      await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'second' });
    } finally {
      clock.mockRestore();
    }
    await idle(manager, convo.id);
    expect(claude.turns.map((t) => t.prompt).at(-1)).toContain('second');
  });
});

/** Talks until it's stopped, then takes `windDownMs` to notice (as a real program does). */
class TalkativeEngine extends FakeEngine {
  windDownMs = 50;
  /** Never finishes once stopped: a program that hung. */
  hangs = false;

  override async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'session', resumeId: 's', model: 'm' };
    for (let i = 0; ; i++) {
      if (input.signal.aborted) {
        if (this.hangs) await new Promise(() => undefined);
        await new Promise((r) => setTimeout(r, this.windDownMs));
        // Words still in the pipe when it was stopped.
        yield { type: 'text', messageId: 'm1', delta: ' late' };
        yield { type: 'done', outcome: 'interrupted' };
        return;
      }
      yield { type: 'text', messageId: 'm1', delta: ` word${i}` };
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

async function talkative() {
  const home = await mkdtemp(join(tmpdir(), 'conch-stop-'));
  const engine = new TalkativeEngine('claude-code', 'Claude Code');
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'claude-code', autoTitle: false } });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
  });
  return { manager, engine };
}

async function running(manager: ConversationManager, id: string) {
  for (let i = 0; i < 200; i++) {
    const events = await log(manager, id);
    if (events.some((e) => e.type === 'assistant.delta')) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never started');
}

describe('Stop, at once', () => {
  it('the reply ends where Stop was pressed, though the provider takes a moment', async () => {
    const { manager } = await talkative();
    const convo = await manager.send({ clientMessageId: 'u1', text: 'go on' });
    await running(manager, convo.id);
    await manager.interrupt(convo.id);
    const said = (await log(manager, convo.id)).filter((e) => e.type === 'assistant.delta').length;
    await idle(manager, convo.id);
    const events = await log(manager, convo.id);
    expect(events.filter((e) => e.type === 'assistant.delta')).toHaveLength(said);
    expect(events.findLast((e) => e.type === 'turn.completed')).toMatchObject({
      outcome: 'interrupted',
    });
  });

  it('a message sent while the stopped reply winds down waits for it, not “still replying”', async () => {
    const { manager, engine } = await talkative();
    engine.windDownMs = 150;
    const convo = await manager.send({ clientMessageId: 'u1', text: 'go on' });
    await running(manager, convo.id);
    await manager.interrupt(convo.id);
    await manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'instead, this' });
    for (let i = 0; i < 200 && engine.turns.length < 2; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(engine.turns.map((t) => t.prompt)).toEqual(['go on', 'instead, this']);
    await manager.interrupt(convo.id);
    await idle(manager, convo.id);
  });

  it('steers: a message that stops the running reply and goes next, in one step', async () => {
    const { manager, engine } = await talkative();
    engine.windDownMs = 150;
    const convo = await manager.send({ clientMessageId: 'u1', text: 'go on' });
    await running(manager, convo.id);
    // No separate Stop: the message itself says to steer, so it never finds the chat busy.
    await manager.send({
      conversationId: convo.id,
      clientMessageId: 'u2',
      text: 'actually, do this',
      steer: true,
    });
    for (let i = 0; i < 200 && engine.turns.length < 2; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(engine.turns.map((t) => t.prompt)).toEqual(['go on', 'actually, do this']);
    const ends = (await log(manager, convo.id)).filter((e) => e.type === 'turn.completed');
    expect(ends[0]).toMatchObject({ outcome: 'interrupted' });
    await manager.interrupt(convo.id);
    await idle(manager, convo.id);
  });

  it('without steer, a message sent while it works is still turned away', async () => {
    const { manager } = await talkative();
    const convo = await manager.send({ clientMessageId: 'u1', text: 'go on' });
    await running(manager, convo.id);
    await expect(
      manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'too soon' }),
    ).rejects.toMatchObject({ code: 'busy' });
    await manager.interrupt(convo.id);
    await idle(manager, convo.id);
  });

  it('Stop pressed again while the next message waits stops that one too', async () => {
    const { manager, engine } = await talkative();
    engine.windDownMs = 150;
    const convo = await manager.send({ clientMessageId: 'u1', text: 'go on' });
    await running(manager, convo.id);
    await manager.interrupt(convo.id);
    const sent = manager.send({ conversationId: convo.id, clientMessageId: 'u2', text: 'next' });
    await new Promise((r) => setTimeout(r, 20));
    await manager.interrupt(convo.id);
    await sent;
    await idle(manager, convo.id);
    expect(engine.turns).toHaveLength(1);
    const ends = (await log(manager, convo.id)).filter((e) => e.type === 'turn.completed');
    expect(ends.map((e) => e.type === 'turn.completed' && e.outcome)).toEqual([
      'interrupted',
      'interrupted',
    ]);
  });
});

describe('windDown', () => {
  it('stops waiting for a stopped provider that never finishes', async () => {
    const abort = new AbortController();
    async function* hung(): AsyncIterable<number> {
      yield 1;
      await new Promise(() => undefined);
    }
    const seen: number[] = [];
    const done = (async () => {
      for await (const n of windDown(hung(), abort.signal, 30)) seen.push(n);
    })();
    await new Promise((r) => setTimeout(r, 10));
    abort.abort();
    await done;
    expect(seen).toEqual([1]);
  });

  it('passes everything through while nobody stops it', async () => {
    async function* three(): AsyncIterable<number> {
      yield 1;
      yield 2;
      yield 3;
    }
    const seen: number[] = [];
    for await (const n of windDown(three(), new AbortController().signal, 30)) seen.push(n);
    expect(seen).toEqual([1, 2, 3]);
  });
});
