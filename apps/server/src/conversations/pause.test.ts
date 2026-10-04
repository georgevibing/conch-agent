/**
 * A turn that pauses to check in (ADR 0077), through the conversation: the
 * budget each turn gets, the pause on the transcript, no reply chips beside
 * its Carry on, and an engine that runs its own loop watched from outside.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { hostToolText, type Engine, type EngineEvent, type TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

/** An engine scripted per test; `own` says it keeps the budget itself. */
class Scripted implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  readonly turnBudget?: 'own';

  constructor(
    private readonly script: (input: TurnInput) => AsyncIterable<EngineEvent>,
    own = false,
  ) {
    if (own) this.turnBudget = 'own';
  }

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

  runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    return this.script(input);
  }
}

async function setup(engine: Scripted, overBudget = false) {
  const home = await mkdtemp(join(tmpdir(), 'conch-pause-'));
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'openrouter', autoTitle: false } });
  const memory = new MemoryStore(join(home, 'memory'));
  await memory.add({ content: 'Likes oolong', kind: 'preference', source: 'user' });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory,
    engine: () => engine,
    context: async () => '## Routines\nWhat the person has set up.',
    overBudget: async () => overBudget,
  });
  return manager;
}

async function finished(manager: ConversationManager, id: string): Promise<ConversationEvent[]> {
  for (let i = 0; i < 400; i++) {
    const { events } = await manager.detail(id);
    if (events.some((e) => e.type === 'turn.completed')) return events;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

describe('pausing to check in (ADR 0077)', () => {
  it('gives each turn its budget, and puts the memories after what stays the same', async () => {
    const engine = new Scripted(async function* () {
      yield { type: 'done', outcome: 'success' };
    }, true);
    const manager = await setup(engine, true);
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Hello' });
    await finished(manager, convo.id);
    const input = engine.turns[0];
    expect(input?.budget).toMatchObject({ steps: 100, ms: 30 * 60_000 });
    // Over the monthly budget: fewer fresh tokens before it checks in.
    expect(input?.budget?.tokens).toBe(1_000_000);
    const system = input?.systemAppend ?? '';
    expect(system.indexOf('# Who you are')).toBeLessThan(system.indexOf('## Routines'));
    expect(system.indexOf('## Routines')).toBeLessThan(system.indexOf('# Memory'));
  });

  it('carries a pause to the transcript, with no chips beside its Carry on', async () => {
    const engine = new Scripted(async function* () {
      yield { type: 'text', messageId: 'm1', delta: 'Done half of it.' };
      yield {
        type: 'done',
        outcome: 'success',
        paused: {
          reason: 'steps',
          message: 'Paused after 100 steps, so this doesn’t run on without you.',
        },
      };
    }, true);
    const manager = await setup(engine);
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Book the trip' });
    const events = await finished(manager, convo.id);
    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({
      outcome: 'success',
      paused: { reason: 'steps' },
    });
    await new Promise((r) => setTimeout(r, 50));
    const after = (await manager.detail(convo.id)).events;
    expect(after.some((e) => e.type === 'replies')).toBe(false);
  });

  it('watches an engine that runs its own loop, and pauses it when it repeats itself', async () => {
    const heard: string[] = [];
    const engine = new Scripted(async function* (input) {
      const recall = input.tools.find((t) => t.name === 'recall');
      for (let i = 0; i < 20 && !input.signal.aborted; i++) {
        const id = `t${i}`;
        yield {
          type: 'tool-start',
          toolUseId: id,
          name: 'mcp__conch__recall',
          input: { query: 'tea' },
        };
        const output = recall ? hostToolText(await recall.run({ query: 'tea' } as never)) : '';
        heard.push(output);
        yield { type: 'tool-end', toolUseId: id, status: 'success', output };
      }
      yield { type: 'done', outcome: input.signal.aborted ? 'interrupted' : 'success' };
    });
    const manager = await setup(engine);
    const convo = await manager.send({ clientMessageId: 'u1', text: 'What tea do I like?' });
    const events = await finished(manager, convo.id);
    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({
      outcome: 'success',
      paused: { reason: 'loop' },
    });
    // The engine heard about the loop in the answer it read, before it was paused.
    expect(heard[2]).toContain('From Conch');
    expect(heard.length).toBeLessThan(8);
  });
});
