import type { Task, TaskList } from '@conch/protocol';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('@conch/nacre', () => ({ toast }));

import { applyTaskEvent, taskKeys } from './queries';

const task = (over: Partial<Task> & { batchId?: string } = {}): Task =>
  ({
    id: 't_1',
    kind: 'background',
    title: 'Add dark mode',
    prompt: 'Add it',
    status: 'running',
    options: {},
    expectations: [{ tool: 'Write', minimum: 1 }],
    parentConversationId: 'c_main',
    conversationId: 'c_t1',
    createdAt: 1,
    rev: 1,
    ...over,
  }) as Task;

function cached(...tasks: Task[]) {
  const client = new QueryClient();
  client.setQueryData<TaskList>(taskKeys.all, { tasks, concurrent: 3 });
  return client;
}

const finish = (t: Task, over: Partial<Task> = {}): Task => ({
  ...t,
  status: 'done',
  finishedAt: 10,
  summary: 'It’s in.',
  rev: t.rev + 1,
  ...over,
});

beforeEach(() => window.history.replaceState(null, '', '/c/c_elsewhere'));
afterEach(() => vi.clearAllMocks());

describe('applyTaskEvent', () => {
  it('says a task is done, and opens at it in the chat it came from', () => {
    const t = task();
    const navigate = vi.fn();
    applyTaskEvent(cached(t), { type: 'task.changed', task: finish(t) }, navigate);
    expect(toast.success).toHaveBeenCalledWith(
      'Done: Add dark mode',
      expect.objectContaining({ id: 'task-t_1', description: 'It’s in.' }),
    );
    const [[, options]] = toast.success.mock.calls as [[string, { action: { onClick(): void } }]];
    options.action.onClick();
    expect(navigate).toHaveBeenCalledWith('/c/c_main?task=t_1');
  });

  it('stays quiet about a done task while you look at the chat it came from', () => {
    window.history.replaceState(null, '', '/c/c_main');
    const t = task();
    applyTaskEvent(cached(t), { type: 'task.changed', task: finish(t) });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('tells about tasks started together once, when the last is over', () => {
    const a = task({ id: 't_a', batchId: 'b' });
    const b = task({ id: 't_b', batchId: 'b' });
    const client = cached(a, b);
    applyTaskEvent(client, { type: 'task.changed', task: finish(a) });
    expect(toast.success).not.toHaveBeenCalled();
    applyTaskEvent(client, { type: 'task.changed', task: finish(b, { finishedAt: 20 }) });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      '2 tasks done',
      expect.objectContaining({ id: 'tasks-b' }),
    );
  });

  it('says when a task needs your OK, unless you’re looking at it', () => {
    const t = task();
    applyTaskEvent(cached(t), {
      type: 'task.changed',
      task: { ...t, status: 'needs-you', rev: 2 },
    });
    expect(toast).toHaveBeenCalledWith(
      'A task needs your OK',
      expect.objectContaining({ description: 'Add dark mode' }),
    );
  });
});
