import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus, Offer } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

/** A provider whose replies wait until they're let go, so a turn can be caught running. */
class GatedEngine implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter';
  readonly integrations = { mode: 'bridge' as const };
  readonly prompts: string[] = [];
  #gates: (() => void)[] = [];
  hold = false;

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

  release() {
    for (const go of this.#gates.splice(0)) go();
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.prompts.push(input.prompt);
    if (this.hold) await new Promise<void>((resolve) => this.#gates.push(resolve));
    const messageId = `m${this.prompts.length}`;
    yield { type: 'text', messageId, delta: `Reply ${this.prompts.length}.` };
    yield { type: 'message-done', messageId };
    yield { type: 'done', outcome: 'success' };
  }
}

const offer = (offerId: string): Offer => ({
  offerId,
  kind: 'app',
  target: 'linear',
  name: 'Linear',
  description: 'Find issues.',
  by: 'assistant',
  resume: { request: 'what’s on my plate?' },
});

async function chat() {
  const home = await mkdtemp(join(tmpdir(), 'conch-carry-'));
  const engine = new GatedEngine();
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { autoTitle: false } });
  const store = new ConversationStore(join(home, 'conversations'));
  let pending: Offer | undefined;
  const make = () =>
    new ConversationManager({
      store,
      settings,
      memory: new MemoryStore(join(home, 'memory')),
      engine: () => engine,
      // The assistant's `offer`, as the tool would log it.
      tools: (ctx) => {
        const shown = pending;
        pending = undefined;
        if (shown) ctx.append({ type: 'offer', offer: shown });
        return [];
      },
    });
  const manager = make();
  const events = async (id: string) => (await manager.detail(id)).events;
  const idle = (id: string, m = manager) =>
    vi.waitFor(async () => expect((await m.detail(id)).conversation.status).toBe('idle'));
  let n = 0;
  const say = async (text: string, conversationId?: string, offering?: Offer) => {
    pending = offering;
    const summary = await manager.send({ conversationId, clientMessageId: `u${++n}`, text });
    await idle(summary.id);
    return summary.id;
  };
  /** Send without waiting for the reply. */
  const send = async (text: string, offering?: Offer) => {
    pending = offering;
    return (await manager.send({ clientMessageId: `u${++n}`, text })).id;
  };
  const resolved = async (id: string) =>
    (await events(id)).filter(
      (e): e is Extract<ConversationEvent, { type: 'offer.resolved' }> =>
        e.type === 'offer.resolved',
    );
  return { manager, make, engine, events, idle, say, send, resolved };
}

const carry = { prompt: 'Linear is connected now. Carry on with: what’s on my plate?' };

describe('carrying on after an offer is taken (ADR 0055)', () => {
  it('starts a turn with the request again, and no new message of yours', async () => {
    const { manager, engine, events, idle, say } = await chat();
    const id = await say('what’s on my plate?', undefined, offer('of_1'));
    expect(await manager.carryOn(id, 'of_1', carry)).toBe('started');
    await idle(id);
    expect(engine.prompts.at(-1)).toBe(carry.prompt);
    const log = await events(id);
    expect(log.filter((e) => e.type === 'user.message')).toHaveLength(1);
    const kinds = log.map((e) => e.type);
    // The quiet line comes first, then the answer.
    expect(kinds.indexOf('offer.resolved')).toBeLessThan(kinds.lastIndexOf('assistant.delta'));
    expect(log.filter((e) => e.type === 'turn.completed')).toHaveLength(2);
  });

  it('runs once however many devices or retries press it, and after a reload', async () => {
    const { manager, make, engine, idle, say, resolved } = await chat();
    const id = await say('what’s on my plate?', undefined, offer('of_1'));
    const states = await Promise.all([
      manager.carryOn(id, 'of_1', carry),
      manager.carryOn(id, 'of_1', carry),
      manager.carryOn(id, 'of_1', carry),
    ]);
    expect(states.sort()).toEqual(['done', 'done', 'started']);
    await idle(id);
    expect(await manager.carryOn(id, 'of_1', carry)).toBe('done');
    expect(await make().carryOn(id, 'of_1', carry)).toBe('done');
    expect(engine.prompts.filter((p) => p === carry.prompt)).toHaveLength(1);
    expect(await resolved(id)).toEqual([
      expect.objectContaining({ offerId: 'of_1', outcome: 'accepted' }),
    ]);
  });

  it('waits its turn while a reply is running, then goes by itself', async () => {
    const { manager, engine, events, idle, send, resolved } = await chat();
    engine.hold = true;
    const id = await send('what’s on my plate?', offer('of_1'));
    await vi.waitFor(() => expect(engine.prompts).toHaveLength(1));
    // Taken (on another device) before this reply is done: it doesn't throw, it waits.
    expect(await manager.carryOn(id, 'of_1', carry)).toBe('queued');
    expect(await manager.carryOn(id, 'of_1', carry)).toBe('done');
    expect(await resolved(id)).toEqual([]);
    engine.hold = false;
    engine.release();
    await vi.waitFor(async () =>
      expect((await events(id)).filter((e) => e.type === 'turn.completed')).toHaveLength(2),
    );
    await idle(id);
    expect(engine.prompts).toEqual(['what’s on my plate?', carry.prompt]);
    expect(await resolved(id)).toEqual([
      expect.objectContaining({ offerId: 'of_1', outcome: 'accepted' }),
    ]);
  });

  it('a new message expires offers nobody answered, and “Not now” puts one away once', async () => {
    const { manager, say, resolved } = await chat();
    const id = await say('what’s on my plate?', undefined, offer('of_1'));
    await manager.dismissOffer(id, 'of_1');
    await manager.dismissOffer(id, 'of_1');
    await say('and another thing', id, offer('of_2'));
    await say('one more', id);
    expect((await resolved(id)).map((e) => [e.offerId, e.outcome])).toEqual([
      ['of_1', 'dismissed'],
      ['of_2', 'expired'],
    ]);
    await expect(manager.dismissOffer(id, 'of_9')).rejects.toThrow(/wasn’t offered/);
    await expect(manager.carryOn(id, 'of_9', carry)).rejects.toThrow(/wasn’t offered/);
  });
});
