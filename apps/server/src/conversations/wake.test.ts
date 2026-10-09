import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, EngineStatus } from '@conch/protocol';
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

async function chat() {
  const home = await mkdtemp(join(tmpdir(), 'conch-wake-'));
  const engine = new GatedEngine();
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { autoTitle: false } });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    tools: () => [],
  });
  const idle = (id: string) =>
    vi.waitFor(async () => expect((await manager.detail(id)).conversation.status).toBe('idle'));
  return { manager, engine, idle };
}

const prompt = '[Conch] A wait you started has ended: CI for conch #482 is done.';

/** What a wait brings back (ADR 0125): the chat carries on by itself, never as your message. */
describe('waking a chat when its wait ends', () => {
  it('starts the next turn with what changed', async () => {
    const { manager, engine, idle } = await chat();
    const { id } = await manager.send({ clientMessageId: 'u1', text: 'watch CI and fix it' });
    await idle(id);
    expect(await manager.wake(id, prompt)).toBe('started');
    await idle(id);
    expect(engine.prompts.at(-1)?.endsWith(prompt)).toBe(true);
    const log = (await manager.detail(id)).events;
    expect(log.filter((e) => e.type === 'user.message')).toHaveLength(1);
    expect(log.filter((e) => e.type === 'turn.completed')).toHaveLength(2);
  });

  it('waits for a reply that is running, then goes', async () => {
    const { manager, engine, idle } = await chat();
    const { id } = await manager.send({ clientMessageId: 'u1', text: 'watch CI' });
    await idle(id);
    engine.hold = true;
    await manager.send({
      conversationId: id,
      clientMessageId: 'u2',
      text: 'meanwhile, what’s 2+2?',
    });
    expect(await manager.wake(id, prompt)).toBe('queued');
    expect(engine.prompts.at(-1)).not.toBe(prompt);
    engine.hold = false;
    engine.release();
    await vi.waitFor(() => expect(engine.prompts.at(-1)?.endsWith(prompt)).toBe(true));
    await idle(id);
  });
});
