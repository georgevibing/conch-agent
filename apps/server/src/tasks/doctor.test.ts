import { describe, expect, it } from 'vitest';

import type { Task } from '@conch/protocol';

import { tasksCheck } from './doctor';
import type { TaskService } from './service';

const unsure = (id: string): Task =>
  ({
    id,
    kind: 'background',
    title: `Send report ${id}`,
    prompt: 'Send the report',
    status: 'unverified',
    createdAt: 1,
    conversationId: `c_${id}`,
    operations: [
      {
        id: `op_${id}`,
        key: `send:${id}`,
        tool: 'send_email',
        effect: 'write',
        state: 'unresolved',
        execution: 'succeeded',
        receiptExpected: true,
      },
    ],
  }) as unknown as Task;

const check = (tasks: Task[]) =>
  tasksCheck({ list: async () => ({ tasks, concurrent: 2 }) } as unknown as TaskService).run({
    repair: false,
    signal: new AbortController().signal,
  });

describe('tasks in Repair everything', () => {
  it('asks for a quick check of tasks that couldn’t confirm what they did, with the way to review them', async () => {
    const [one] = await check([unsure('a')]);
    expect(one).toMatchObject({
      id: 'tasks:unverified',
      state: 'warning',
      message: '“Send report a” needs a quick check of what it did. Remove its card once you have.',
      action: { kind: 'open', label: 'Review it', place: 'tasks', focus: 'c_a' },
    });
    const [many] = await check([unsure('a'), unsure('b'), unsure('c'), unsure('d')]);
    expect(many).toMatchObject({
      state: 'warning',
      message: '4 tasks need a quick check of what they did. Remove each card once you have.',
      action: { kind: 'open', label: 'Review tasks', place: 'tasks' },
    });
    expect(many?.action).not.toHaveProperty('focus');
  });

  it('says nothing is wrong once they’re removed (archived tasks aren’t listed)', async () => {
    expect(await check([])).toEqual([
      expect.objectContaining({ id: 'tasks', state: 'ok', message: 'No tasks running.' }),
    ]);
  });
});
