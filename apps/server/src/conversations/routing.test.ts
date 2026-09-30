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
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager, type TurnRoute } from './manager';
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
  for (let i = 0; i < 200; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

async function log(manager: ConversationManager, id: string): Promise<ConversationEvent[]> {
  return (await manager.detail(id)).events;
}

describe('offline and at a limit (ADR 0018)', () => {
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
    const events = await log(manager, convo.id);
    expect(events.find((e) => e.type === 'turn.routed')).toMatchObject({
      from: 'claude-code',
      to: 'openrouter',
      reason: 'limit',
    });
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
    expect(events.at(-1)).toMatchObject({ type: 'turn.held' });

    claude.fails = undefined;
    world.online = true;
    expect(await manager.releaseHeld()).toBe(1);
    await idle(manager, convo.id);
    expect(claude.turns.at(-1)?.prompt).toContain('are you there');
  });
});
