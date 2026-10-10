import { describe, expect, it } from 'vitest';

import { ServerEvent } from './index';
import { waitingLine, waitingWhen } from './task-waiting';
import { Task, TaskCapacity, TaskEstimate, TaskList, TaskWaiting } from './tasks';

const base = {
  id: 't1',
  kind: 'helper',
  title: 'Check the tests',
  prompt: 'Run the tests',
  status: 'queued',
  createdAt: 1,
};

describe('a waiting task on the wire (ADR 0128)', () => {
  it('carries its estimate and why it waits, and an older copy without them still reads', () => {
    const task = Task.parse({
      ...base,
      estimate: { weight: 'heavy', uses: ['cpu'], minutes: 4, by: 'model', touches: ['src/a.ts'] },
      waiting: { reason: 'room', words: 'Starts when one of the 4 working finishes' },
    });
    expect(task.waiting?.canStartNow).toBe(false);
    expect(task.estimate?.weight).toBe('heavy');
    expect(Task.parse(base).waiting).toBeUndefined();
  });

  it('refuses what isn’t a reason or a size', () => {
    expect(TaskWaiting.safeParse({ reason: 'bored', words: 'x' }).success).toBe(false);
    expect(TaskWaiting.safeParse({ reason: 'room', words: 'x'.repeat(201) }).success).toBe(false);
    expect(
      TaskEstimate.safeParse({ weight: 'huge', uses: [], minutes: 1, by: 'rules' }).success,
    ).toBe(false);
    expect(
      TaskEstimate.safeParse({ weight: 'light', uses: [], minutes: 0, by: 'rules' }).success,
    ).toBe(false);
    expect(
      TaskEstimate.safeParse({ weight: 'light', uses: ['gpu'], minutes: 1, by: 'rules' }).success,
    ).toBe(false);
  });

  it('a list carries the live capacity, and so does its own event', () => {
    const capacity = { atOnce: 4, working: 4, waiting: 1, words: 'Up to 4 at once right now' };
    expect(TaskList.parse({ tasks: [], concurrent: 4, capacity }).capacity).toEqual(capacity);
    expect(TaskList.parse({ tasks: [], concurrent: 3 }).capacity).toBeUndefined();
    expect(ServerEvent.parse({ type: 'task.capacity', capacity })).toEqual({
      type: 'task.capacity',
      capacity,
    });
    expect(TaskCapacity.safeParse({ atOnce: -1, working: 0, waiting: 0 }).success).toBe(false);
  });
});

describe('waitingLine', () => {
  const now = 1_000_000;
  it('counts down to a retry it knows', () => {
    const waiting = TaskWaiting.parse({
      reason: 'provider',
      words: 'Codex asked Conch to slow down',
      retryAt: now + 20_000,
    });
    expect(waitingLine(waiting, now)).toBe('Codex asked Conch to slow down · trying again in 20s');
    expect(waitingLine(waiting, now + 25_000)).toBe('Codex asked Conch to slow down');
  });

  it('says a guess only while it’s worth saying', () => {
    const waiting = TaskWaiting.parse({
      reason: 'room',
      words: 'Starts when one of the 4 working finishes',
      expectedAt: now + 3 * 60_000,
    });
    expect(waitingWhen(waiting, now)).toBe('likely in about 3 min');
    expect(waitingWhen(waiting, now + 3 * 60_000 - 10_000)).toBeUndefined();
  });
});
