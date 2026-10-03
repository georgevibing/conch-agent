import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, EngineStatus, PlanStep } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { ConversationManager } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';

const steps = (done: number): PlanStep[] =>
  ['Look at the folder', 'Sort the files', 'Tidy the names'].map((title, i) => ({
    title,
    status: i < done ? 'done' : i === done ? 'active' : 'pending',
  }));

/** Works through three steps: with its own plan (`native`), or with Conch's tool. */
class PlanningEngine implements Engine {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter';
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  /** Stop after this many steps, as Stop does. */
  stopAfter?: number;

  constructor(
    readonly plans?: 'native',
    readonly hostTools?: boolean,
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
    const tool = input.tools.find((t) => t.name === 'update_plan');
    for (let done = 0; done <= 3; done++) {
      if (this.stopAfter === done) {
        yield { type: 'done', outcome: 'interrupted' };
        return;
      }
      if (this.plans === 'native') {
        yield { type: 'plan', steps: steps(done) };
        // Engines repeat themselves; the chat doesn't.
        yield { type: 'plan', steps: steps(done) };
      } else if (tool) await tool.run({ steps: steps(done) });
      yield { type: 'tool-start', toolUseId: `t${done}`, name: 'Bash', input: { command: 'ls' } };
      yield { type: 'tool-end', toolUseId: `t${done}`, status: 'success', output: 'ok' };
    }
    yield { type: 'text', messageId: 'm1', delta: 'All tidy.' };
    yield { type: 'message-done', messageId: 'm1' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function run(engine: PlanningEngine) {
  const home = await mkdtemp(join(tmpdir(), 'conch-plans-'));
  const settings = new SettingsStore(home);
  await settings.update({
    preferences: { engine: 'openrouter', autoTitle: false, permissionMode: 'bypassPermissions' },
  });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
  });
  const convo = await manager.send({ clientMessageId: 'u1', text: 'Tidy up this folder' });
  for (let i = 0; i < 2000; i++) {
    if ((await manager.detail(convo.id)).conversation.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return (await manager.detail(convo.id)).events;
}

describe('the plan, in a chat', () => {
  it('logs an engine’s own plan as it ticks, once per change', async () => {
    const engine = new PlanningEngine('native');
    const events = await run(engine);
    const plans = events.filter((e) => e.type === 'plan');
    expect(plans.map((e) => e.type === 'plan' && e.steps)).toEqual([
      steps(0),
      steps(1),
      steps(2),
      steps(3),
    ]);
    // Its own plan: Conch's tool would be a second one.
    expect(engine.turns[0]?.tools.some((t) => t.name === 'update_plan')).toBe(false);
    // The work happens between the ticks, in order.
    const order = events.flatMap((e) =>
      e.type === 'plan' || e.type === 'tool.started' ? [e.type] : [],
    );
    expect(order.slice(0, 4)).toEqual(['plan', 'tool.started', 'plan', 'tool.started']);
  });

  it('gives update_plan to an engine without one, and logs what it’s given', async () => {
    const engine = new PlanningEngine();
    const events = await run(engine);
    expect(engine.turns[0]?.tools.some((t) => t.name === 'update_plan')).toBe(true);
    expect(events.filter((e) => e.type === 'plan')).toHaveLength(4);
    // Conch's own tool: drawn as the plan, never as a tool row.
    expect(events.some((e) => e.type === 'tool.started' && /update_plan/.test(e.name))).toBe(false);
  });

  it('gives no plan to a model that can only chat', async () => {
    const engine = new PlanningEngine(undefined, false);
    const events = await run(engine);
    expect(engine.turns[0]?.tools.some((t) => t.name === 'update_plan')).toBe(false);
    expect(events.some((e) => e.type === 'plan')).toBe(false);
  });

  it('leaves the plan as it stood when the turn is stopped', async () => {
    const engine = new PlanningEngine('native');
    engine.stopAfter = 2;
    const events = await run(engine);
    const last = events.findLast((e) => e.type === 'plan');
    expect(last?.type === 'plan' && last.steps).toEqual(steps(1));
    expect(events.some((e) => e.type === 'turn.completed' && e.outcome === 'interrupted')).toBe(
      true,
    );
  });
});
