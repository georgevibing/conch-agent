/**
 * Work handed off keeps the person's authority (ADR 0149): a task's review reads
 * what the person said in the chat it came from, frozen when it was, and marked
 * as from there. A routine, a chat with someone else's words in it, and the
 * task's own prompt give none (ADR 0144).
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ALL_MODES,
  type Capabilities,
  type ConversationEvent,
  type EngineStatus,
  type TaintSource,
} from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { authorizeTool } from '../engines/host';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager, FROM_PARENT_CHAT, type TurnExtras } from './manager';
import { ConversationStore } from './store';

/** Runs `push` through Conch's authorization when its prompt says so; otherwise just answers. */
class Scripted implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  readonly outcomes: string[] = [];

  async detect(): Promise<EngineStatus> {
    return {
      engine: 'mock',
      label: 'Scripted',
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: 'mock',
      label: 'Scripted',
      models: [],
      commands: [],
      permissionModes: [...ALL_MODES],
    };
  }
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    if (/do the push/.test(input.prompt)) {
      const refused = await authorizeTool(
        input,
        'Bash',
        { command: 'git push origin main', dangerouslyDisableSandbox: true },
        't0',
      );
      this.outcomes.push(refused ? 'declined' : 'ran');
    }
    yield { type: 'done', outcome: 'success' };
  }
}

const allow = async () => ({
  text: JSON.stringify({
    decision: 'allow',
    risk: 'moderate',
    reason: 'authorized',
    evidence: [0],
  }),
});
const web: TaintSource = { kind: 'web', label: 'evil.example' };

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-handed-off-'));
  const engine = new Scripted();
  const settings = new SettingsStore(home);
  await settings.update({
    preferences: { engine: 'mock', autoTitle: false, permissionMode: 'auto' },
  });
  const review = vi.fn(allow);
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    autoReview: async () => ({ complete: review }),
  });
  return { manager, engine, review };
}

async function settled(manager: ConversationManager, id: string): Promise<ConversationEvent[]> {
  const asked = new Set<string>();
  for (let i = 0; i < 4000; i++) {
    const { events, conversation } = await manager.detail(id);
    // Nobody is there to answer a task: every question is a no, and counted.
    for (const e of events)
      if (e.type === 'permission.requested' && !asked.has(e.permissionId)) {
        asked.add(e.permissionId);
        await manager.respond(id, e.permissionId, 'deny');
      }
    if (events.some((e) => e.type === 'turn.completed') && conversation.status === 'idle')
      return events;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never settled');
}

async function chat(manager: ConversationManager, text: string, untrusted?: TaintSource) {
  const convo = await manager.send({
    clientMessageId: 'u1',
    text,
    ...(untrusted && { untrusted }),
  });
  await settled(manager, convo.id);
  return convo.id;
}

/** A task's turn, as `TaskService` starts one: its own prompt, the chat's taint, these extras. */
async function task(manager: ConversationManager, extras: TurnExtras, routine = false) {
  const { conversationId } = await manager.start({
    title: 'Maintenance',
    text: 'Resume the existing goal: do the push',
    options: { permissionMode: 'auto' },
    origin: routine
      ? { kind: 'routine', routineId: 'r1', runId: 'run1' }
      : { kind: 'task', taskId: 'task_1' },
    extras: { taint: [web], ...extras },
  });
  const events = await settled(manager, conversationId);
  return events.filter((e) => e.type === 'permission.requested');
}

describe('handed-off work keeps the person’s authority (ADR 0149)', () => {
  it('a task’s review reads what the person said in its chat, marked as from there', async () => {
    const { manager, engine, review } = await setup();
    const parent = await chat(manager, 'Complete the repository maintenance');
    const ownerWords = await manager.ownerWordsOf(parent);
    expect(ownerWords).toEqual(['Complete the repository maintenance']);
    const asked = await task(manager, { attended: true, ...(ownerWords && { ownerWords }) });
    expect(asked).toHaveLength(0);
    expect(engine.outcomes).toEqual(['ran']);
    expect(review).toHaveBeenCalledTimes(1);
    // The review is told where the words came from; the task's own prompt isn't among them.
    const prompt = JSON.stringify(review.mock.calls[0]);
    expect(prompt).toContain('maintenance');
    expect(prompt).not.toContain('Resume');
    expect(FROM_PARENT_CHAT).toMatch(/chat this task came from/);
  });

  it('is frozen when handed off: a later message in the chat doesn’t reach the task', async () => {
    const { manager } = await setup();
    const parent = await chat(manager, 'Complete the repository maintenance');
    const frozen = await manager.ownerWordsOf(parent);
    await manager.send({ conversationId: parent, clientMessageId: 'u2', text: 'Don’t push' });
    await settled(manager, parent);
    expect(frozen).toEqual(['Complete the repository maintenance']);
    expect(await manager.ownerWordsOf(parent)).toHaveLength(2);
  });

  it('a task’s own prompt grants nothing: without the chat’s words, the question stands', async () => {
    const { manager, engine, review } = await setup();
    const asked = await task(manager, { attended: true });
    expect(review).not.toHaveBeenCalled();
    expect(asked).toHaveLength(1);
    expect(engine.outcomes).toEqual(['declined']);
  });

  it('a chat with someone else’s words in it hands none on', async () => {
    const { manager, review } = await setup();
    const parent = await chat(manager, 'Complete the repository maintenance', {
      kind: 'person',
      label: 'Ana on Telegram',
    });
    expect(await manager.ownerWordsOf(parent)).toBeUndefined();
    // Even words a task carried don't count once someone else's are in it.
    const asked = await task(manager, {
      ownerWords: ['Complete the repository maintenance'],
      taint: [{ kind: 'person', label: 'Ana on Telegram' }],
    });
    expect(asked).toHaveLength(1);
    expect(review).not.toHaveBeenCalled();
  });

  it('a routine has no owner words, and its run hands none on', async () => {
    const { manager, review } = await setup();
    const asked = await task(manager, {}, true);
    expect(asked).toHaveLength(1);
    expect(review).not.toHaveBeenCalled();
    const run = (await manager.list()).find((c) => c.origin?.kind === 'routine');
    expect(run).toBeDefined();
    expect(await manager.ownerWordsOf(run?.id ?? '')).toBeUndefined();
  });

  it('more than a review could read whole hands nothing on', async () => {
    const { manager } = await setup();
    const parent = await chat(manager, `Complete the maintenance ${'x'.repeat(41_000)}`);
    expect(await manager.ownerWordsOf(parent)).toBeUndefined();
  });
});
