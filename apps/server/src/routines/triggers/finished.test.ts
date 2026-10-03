import type { RoutineRun, ServerEvent, Task } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { routineSource, taskSource, type Subscribe } from './finished';
import type { Happening } from './types';

function bus() {
  const listeners = new Set<(e: ServerEvent) => void>();
  const subscribe: Subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    subscribe,
    emit: (e: ServerEvent) => listeners.forEach((l) => l(e)),
    size: () => listeners.size,
  };
}

const task = (extra: Partial<Task>): Task =>
  ({
    id: 't1',
    kind: 'background',
    title: 'Tidy the notes',
    prompt: 'Tidy',
    status: 'done',
    options: {},
    createdAt: 0,
    finishedAt: 100,
    steps: [],
    rev: 1,
    summary: 'Moved 12 notes.',
    ...extra,
  }) as Task;

const run = (extra: Partial<RoutineRun>): RoutineRun => ({
  id: 'run1',
  routineId: 'r_brief',
  trigger: 'schedule',
  status: 'succeeded',
  startedAt: 50,
  finishedAt: 100,
  outcome: 'Sent your briefing',
  ...extra,
});

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('when a background task finishes', () => {
  it('starts once per task when it’s done, unverified or failed', async () => {
    const b = bus();
    const arrived: Happening[] = [];
    const handle = taskSource({ subscribe: b.subscribe }).watch?.(
      { routineId: 'r1', title: 'x', trigger: { kind: 'task' }, since: 10, state: {} },
      (h) => arrived.push(...h),
      () => undefined,
    );
    b.emit({ type: 'task.changed', task: task({ status: 'running', finishedAt: undefined }) });
    b.emit({ type: 'task.changed', task: task({}) });
    b.emit({ type: 'task.changed', task: task({}) });
    b.emit({ type: 'task.changed', task: task({ id: 't2', status: 'failed', error: 'No disk.' }) });
    b.emit({ type: 'task.changed', task: task({ id: 'old', finishedAt: 5 }) });
    await flush();
    expect(arrived.map((h) => h.label)).toEqual([
      '“Tidy the notes” finished',
      '“Tidy the notes” didn’t finish',
    ]);
    expect(arrived[0]?.detail).toContain('Moved 12 notes.');
    handle?.stop();
    expect(b.size()).toBe(0);
  });

  it('never starts again for a task its own run started', async () => {
    const b = bus();
    const arrived: Happening[] = [];
    taskSource({
      subscribe: b.subscribe,
      routineOf: async (c) => (c === 'c_run' ? 'r1' : undefined),
    }).watch?.(
      { routineId: 'r1', title: 'x', trigger: { kind: 'task' }, since: 0, state: {} },
      (h) => arrived.push(...h),
      () => undefined,
    );
    b.emit({ type: 'task.changed', task: task({ parentConversationId: 'c_run' }) });
    b.emit({ type: 'task.changed', task: task({ id: 't9', parentConversationId: 'c_other' }) });
    await flush();
    expect(arrived.map((h) => h.id)).toEqual(['task:t9:done']);
  });
});

describe('after another routine runs', () => {
  const titles: Record<string, string> = { r_brief: 'Morning briefing', r_a: 'A', r_b: 'B' };
  const follows: Record<string, string> = { r_b: 'r_a', r_a: 'r_new' };
  const source = (b = bus()) =>
    routineSource({
      subscribe: b.subscribe,
      follows: async (id) => follows[id],
      exists: async (id) => id in titles || id === 'r_new',
      title: (id) => titles[id],
    });

  it('says which routine, and starts when it ran well, carrying the chain', async () => {
    const b = bus();
    const s = source(b);
    expect(s.describe({ kind: 'routine', routineId: 'r_brief' })).toBe(
      'After “Morning briefing” runs',
    );
    expect(s.describe({ kind: 'routine', routineId: 'gone' })).toBe('After another routine runs');
    const arrived: (Happening & { chain?: string[] })[] = [];
    s.watch?.(
      {
        routineId: 'r_next',
        title: 'x',
        trigger: { kind: 'routine', routineId: 'r_brief' },
        since: 0,
        state: {},
      },
      (h) => arrived.push(...h),
      () => undefined,
    );
    b.emit({ type: 'routine.run', run: run({ status: 'running', finishedAt: undefined }) });
    b.emit({ type: 'routine.run', run: run({ status: 'nothing-to-do' }) });
    b.emit({ type: 'routine.run', run: run({ routineId: 'r_other' }) });
    b.emit({
      type: 'routine.run',
      run: run({ id: 'run2', event: { label: 'x', count: 1, chain: ['r_first'] } }),
    });
    expect(arrived).toHaveLength(1);
    expect(arrived[0]).toMatchObject({
      id: 'run:run2',
      label: '“Morning briefing” ran',
      chain: ['r_first', 'r_brief'],
    });
    expect(arrived[0]?.detail).toContain('Sent your briefing');
  });

  it('refuses to follow itself, a routine that isn’t there, or one that would loop back', async () => {
    const s = source();
    await expect(
      s.validate?.({ kind: 'routine', routineId: 'r_brief' }, { routineId: 'r_brief' }),
    ).rejects.toThrow(/after itself/);
    await expect(
      s.validate?.({ kind: 'routine', routineId: 'nope' }, { routineId: 'r_x' }),
    ).rejects.toThrow(/isn’t there/);
    // r_new after r_b, but r_b follows r_a which follows r_new: a loop.
    await expect(
      s.validate?.({ kind: 'routine', routineId: 'r_b' }, { routineId: 'r_new' }),
    ).rejects.toThrow(/start each other forever/);
    await expect(
      s.validate?.({ kind: 'routine', routineId: 'r_brief' }, { routineId: 'r_new' }),
    ).resolves.toEqual({ kind: 'routine', routineId: 'r_brief' });
  });
});
