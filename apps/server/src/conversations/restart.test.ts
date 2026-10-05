/**
 * Conch stopping under a running chat (an update, a crash, memory running out):
 * the chat says so, carries on by itself a couple of times, and a tab that had
 * seen more of the lost run is told to start over.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEvent, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';

class Scripted implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  constructor(private readonly script: (input: TurnInput) => AsyncIterable<EngineEvent>) {}
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

async function open(home: string, engine: Scripted) {
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'openrouter', autoTitle: false } });
  return new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    context: async () => '',
  });
}

const hangs = () =>
  new Scripted(async function* () {
    yield { type: 'text', messageId: 'm1', delta: 'Working…' };
    await new Promise(() => undefined);
  });

async function until(
  manager: ConversationManager,
  id: string,
  done: (e: ConversationEvent[]) => boolean,
) {
  for (let i = 0; i < 400; i++) {
    const { events } = await manager.detail(id);
    if (done(events)) return events;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never happened');
}

describe('Conch restarting under a running chat', () => {
  it('says so, then carries on by itself', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-restart-'));
    const before = await open(home, hangs());
    const convo = await before.send({ clientMessageId: 'u1', text: 'Pull the codebase' });
    await until(before, convo.id, (e) => e.some((x) => x.type === 'assistant.delta'));

    // Conch comes back up: the same folder, a new gateway.
    const engine = new Scripted(async function* () {
      yield { type: 'text', messageId: 'm2', delta: 'Done.' };
      yield { type: 'done', outcome: 'success' };
    });
    const after = await open(home, engine);
    expect(await after.recoverInterrupted()).toBe(1);
    const events = await until(after, convo.id, (e) =>
      e.some((x) => x.type === 'turn.completed' && x.outcome === 'success'),
    );

    expect(events.find((e) => e.type === 'turn.completed')).toMatchObject({
      outcome: 'interrupted',
      restarted: { resumed: true },
    });
    expect(engine.turns[0]?.prompt).toMatch(/Conch restarted/);
    expect((await after.list()).find((c) => c.id === convo.id)?.status).toBe('idle');
  });

  it('stops carrying on after two restarts in a row, and says why', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-restart-'));
    let manager = await open(home, hangs());
    const convo = await manager.send({ clientMessageId: 'u1', text: 'Do the thing' });
    await until(manager, convo.id, (e) => e.some((x) => x.type === 'assistant.delta'));
    for (let round = 0; round < 3; round++) {
      manager = await open(home, hangs());
      await manager.recoverInterrupted();
      await until(
        manager,
        convo.id,
        (e) => e.filter((x) => x.type === 'turn.completed').length === round + 1,
      );
      // Whatever it started again is mid-turn when Conch goes down again.
      await new Promise((r) => setTimeout(r, 30));
    }
    const { events } = await manager.detail(convo.id);
    const ends = events.flatMap((e) =>
      e.type === 'turn.completed' && e.restarted ? [e.restarted.resumed] : [],
    );
    expect(ends).toEqual([true, true, false]);
  });
});
