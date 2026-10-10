import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assessTask, taskWorth, type Capabilities, type EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ConversationManager } from '../conversations/manager';
import { ConversationStore } from '../conversations/store';
import type { Engine, EngineEvent, GuardDecision, HostTool, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { merged, TaskService } from './service';
import { TaskStore } from './store';

/** A provider whose one turn is the script a test gives it, in Claude Code's order. */
class Scripted implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  readonly smallModel = 'small-model';
  constructor(readonly script: (input: TurnInput) => AsyncGenerator<EngineEvent>) {}
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
    return this.script(input);
  }
}

async function setup(engine: Scripted, recovery: () => boolean, tools: HostTool[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'conch-refused-'));
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'mock', autoTitle: false } });
  const conversations = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    tools: () => tools,
    engine: () => engine,
    recovery: { allowed: recovery, holding: () => 'background work is held' },
  });
  const store = new TaskStore(home);
  const tasks = new TaskService({
    store,
    conversations,
    engine: () => engine,
    settings,
    emit: () => undefined,
    home,
    overBudget: async () => false,
    ready: async () => [engine],
  });
  conversations.events.on((event) => tasks.onEvent(event));
  await tasks.start();
  return { tasks, store };
}

async function until<T>(get: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 2000; i++) {
    const value = await get();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never happened');
}

const finished = (status: string) => ['done', 'unverified', 'failed'].includes(status);

/** One provider step: its start, Conch's guard, and its end, as Claude Code reports them. */
async function* step(
  input: TurnInput,
  id: string,
  name: string,
  args: Record<string, unknown>,
  seen: (GuardDecision | undefined)[],
): AsyncGenerator<EngineEvent> {
  yield { type: 'tool-start', toolUseId: id, name, input: args };
  const verdict = await input.guard?.({ toolName: name, toolUseId: id, input: args });
  seen.push(verdict);
  yield verdict?.decision === 'deny'
    ? { type: 'tool-end', toolUseId: id, status: 'error', output: verdict.message }
    : { type: 'tool-end', toolUseId: id, status: 'success', output: 'ok' };
}

describe('a helper whose command Conch held before it ran', () => {
  it('is not locked out of every later write, and its words say what really happened', async () => {
    let room = false;
    const seen: (GuardDecision | undefined)[] = [];
    let started: unknown;
    const processStart: HostTool = {
      name: 'process_start',
      description: 'Start a managed command',
      input: { command: z.string() },
      run: async () => 'Started proc_1.',
    };
    const engine = new Scripted(async function* (input) {
      // The first command meets the recovery hold: refused before it ran.
      yield* step(input, 't1', 'Bash', { command: 'touch made.txt' }, seen);
      // Loading a tool's schema is not an action.
      yield* step(input, 't2', 'ToolSearch', { query: 'select:Write' }, seen);
      // The managed queue is the advice the refusal gives: it must not be refused in turn.
      try {
        started = await input.tools
          .find((t) => t.name === 'process_start')
          ?.run({
            command: 'touch made.txt',
          });
      } catch (error) {
        started = (error as Error).message;
      }
      room = true;
      // A different write, then the very command that never ran.
      yield* step(input, 't3', 'Write', { file_path: 'made.txt', content: 'hi' }, seen);
      yield* step(input, 't4', 'Bash', { command: 'touch made.txt' }, seen);
      await input.tools
        .find((t) => t.name === 'report_result')
        ?.run({ summary: 'Made the file.' } as never);
      yield { type: 'text', messageId: 'm', delta: 'Done.' };
      yield { type: 'done', outcome: 'success' };
    });
    const { tasks } = await setup(engine, () => room, [processStart]);
    const created = await tasks.create({ kind: 'helper', text: 'Make the file' });
    const task = await until(
      () => tasks.get(created.id),
      (t) => finished(t.status),
    );

    expect(seen[0]).toMatchObject({ decision: 'deny' });
    // Nothing later is refused as "may already have happened".
    for (const later of seen.slice(1))
      expect(later?.decision === 'deny' ? later.message : '').not.toMatch(/may already/);
    expect(started).toBe('Started proc_1.');

    const ops = task.operations ?? [];
    expect(ops.find((op) => op.invocationId === 't1')).toMatchObject({ state: 'not-run' });
    expect(ops.find((op) => op.invocationId === 't2')).toMatchObject({
      effect: 'read',
      state: 'confirmed',
    });
    expect(ops.find((op) => op.tool === 'process_start')).toBeDefined();
    // The refused call isn't counted as an action whose result is unknown.
    const assessment = assessTask(task);
    expect(assessment.reasons.filter((r) => r.code === 'effect-uncertain')).toEqual([]);
    expect(taskWorth(task)).toBeUndefined();
    // Said as what it is: it finished, and what Conch can't vouch for, never "not verified".
    expect(merged([task])).not.toMatch(/Not verified/);
    expect(merged([task])).toBe(
      '## Make the file\nIt finished. Conch can’t confirm what 3 of its actions did, since they give no receipt, and no checks were set for this task.\nMade the file.',
    );
  });
});

describe('a task an older version locked', () => {
  it('carries on when resumed: its chat shows Conch refused that call before it ran', async () => {
    let room = false;
    let attempt = 0;
    const seen: (GuardDecision | undefined)[] = [];
    const engine = new Scripted(async function* (input) {
      attempt++;
      if (attempt === 1) {
        yield* step(input, 't1', 'Bash', { command: 'touch made.txt' }, seen);
        yield { type: 'done', outcome: 'error', error: 'It gave up.' };
        return;
      }
      yield* step(input, 't2', 'Write', { file_path: 'made.txt', content: 'hi' }, seen);
      await input.tools
        .find((t) => t.name === 'report_result')
        ?.run({ summary: 'Made the file.' } as never);
      yield { type: 'done', outcome: 'success' };
    });
    const { tasks, store } = await setup(engine, () => room);
    const created = await tasks.create({ kind: 'background', text: 'Make the file' });
    const failed = await until(
      () => tasks.get(created.id),
      (t) => finished(t.status),
    );
    expect(failed.status).toBe('failed');
    // What an older version kept: the refused call as an action that may have happened.
    await store.save({
      ...failed,
      operations: failed.operations?.map(({ refused: _refused, ...op }) => ({
        ...op,
        state: 'unresolved' as const,
        execution: 'failed' as const,
      })),
    });
    room = true;
    await tasks.retry(created.id);
    const resumed = await until(
      () => tasks.get(created.id),
      (t) => t.attempt === 1 && finished(t.status),
    );
    expect(seen[1]?.decision === 'deny' ? seen[1].message : '').not.toMatch(/may already/);
    expect(resumed.operations?.find((op) => op.invocationId === 't1')).toMatchObject({
      state: 'not-run',
      refused: true,
    });
  });
});

describe('a helper that only looked', () => {
  it('is done when its answer is in, whatever read-only commands it ran', async () => {
    const seen: (GuardDecision | undefined)[] = [];
    const engine = new Scripted(async function* (input) {
      yield* step(input, 'r1', 'Bash', { command: 'ls -la && git status' }, seen);
      yield* step(input, 'r2', 'Read', { file_path: 'README.md' }, seen);
      yield* step(input, 'r3', 'ToolSearch', { query: 'select:Read' }, seen);
      await input.tools
        .find((t) => t.name === 'report_result')
        ?.run({ summary: 'There are 3 files.' } as never);
      yield { type: 'done', outcome: 'success' };
    });
    const { tasks } = await setup(engine, () => true);
    const created = await tasks.create({ kind: 'helper', text: 'How many files are there?' });
    const task = await until(
      () => tasks.get(created.id),
      (t) => finished(t.status),
    );
    expect(task.status).toBe('done');
    expect(task.error).toBeUndefined();
    expect(merged([task])).toBe('## How many files are there?\nThere are 3 files.');
  });
});
