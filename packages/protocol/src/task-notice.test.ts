import { describe, expect, it } from 'vitest';

import { taskFinishNotice, taskLink } from './task-notice';
import type { Task } from './tasks';

let n = 0;
const task = (over: Partial<Task> & { batchId?: string } = {}): Task => {
  n += 1;
  return {
    id: `t${n}`,
    kind: 'background',
    title: 'Fix the login page',
    prompt: 'Fix it',
    status: 'done',
    options: {},
    expectations: [{ tool: 'Write', minimum: 1 }],
    parentConversationId: 'c_main',
    conversationId: `c_task${n}`,
    createdAt: n,
    finishedAt: 100 + n,
    summary: '## Fixed\nThe login page works again.',
    ...over,
  } as Task;
};

describe('taskFinishNotice', () => {
  it('says a task you sent away is done, and opens at it in the chat it came from', () => {
    const t = task();
    expect(taskFinishNotice(t, [t])).toMatchObject({
      title: 'Done: Fix the login page',
      body: 'Fixed',
      tone: 'done',
      url: `/c/c_main?task=${t.id}`,
      tag: `task-${t.id}`,
    });
  });

  it('says what went wrong when it didn’t finish', () => {
    const t = task({ status: 'failed', error: 'Tests failed\nstack…' });
    expect(taskFinishNotice(t, [t])).toMatchObject({
      title: 'Didn’t finish: Fix the login page',
      body: 'Tests failed',
      tone: 'failed',
    });
  });

  it('calls a result with nothing to check against plain done', () => {
    const t = task({ status: 'unverified', expectations: [] });
    expect(taskFinishNotice(t, [t])?.title).toBe('Done: Fix the login page');
  });

  it('stays quiet for helpers, a task you stopped, and one still going', () => {
    for (const t of [
      task({ kind: 'helper' }),
      task({ status: 'stopped' }),
      task({ status: 'running' }),
      task({ status: 'needs-you' }),
    ])
      expect(taskFinishNotice(t, [t])).toBeUndefined();
  });

  it('waits for the rest of its batch, then tells about them all at once', () => {
    const a = task({ batchId: 'b1', title: 'Add dark mode' });
    const b = task({ batchId: 'b1', title: 'Fix the login page', status: 'running' });
    const c = task({ batchId: 'b1', title: 'Write the docs', status: 'failed', error: 'No' });
    const other = task({ batchId: 'b2', status: 'running' });
    expect(taskFinishNotice(a, [a, b, c, other])).toBeUndefined();
    const last = { ...b, status: 'done' as const };
    const notice = taskFinishNotice(last, [a, b, c, other]);
    expect(notice).toMatchObject({
      title: '2 tasks done · 1 didn’t finish',
      tag: 'tasks-b1',
      tone: 'failed',
      // The one that didn't finish is the one to open.
      url: `/c/c_main?task=${c.id}`,
    });
    expect(notice?.body).toMatch(/^Didn’t finish: Write the docs\. Done: /);
    expect(notice?.tasks).toHaveLength(3);
  });

  it('opens the chat they came from when the whole batch is done', () => {
    const a = task({ batchId: 'b3' });
    const b = task({ batchId: 'b3' });
    expect(taskFinishNotice(b, [a, b])).toMatchObject({ title: '2 tasks done', url: '/c/c_main' });
  });

  it('counts a stopped sibling as over, but doesn’t tell about it', () => {
    const a = task({ batchId: 'b4', status: 'stopped' });
    const b = task({ batchId: 'b4', title: 'Add dark mode' });
    expect(taskFinishNotice(b, [a, b])?.title).toBe('Done: Add dark mode');
  });

  it('says so when every task in a batch didn’t finish', () => {
    const a = task({ batchId: 'b5', status: 'failed' });
    const b = task({ batchId: 'b5', status: 'failed' });
    expect(taskFinishNotice(b, [a, b])?.title).toBe('2 tasks didn’t finish');
  });
});

describe('taskLink', () => {
  it('opens a task without a chat it came from in its own chat', () => {
    expect(taskLink(task({ parentConversationId: undefined, conversationId: 'c_own' }))).toBe(
      '/c/c_own',
    );
  });
});
