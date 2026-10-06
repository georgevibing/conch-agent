import { describe, expect, it, vi } from 'vitest';
import { BrowserStepQueue } from './step-queue';

it('serializes a chat while other chats can browse, and cancels queued calls without running them', async () => {
  const queue = new BrowserStepQueue();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const signal = new AbortController().signal;
  const first = queue.run('one', signal, vi.fn(), () => held);
  const abort = new AbortController();
  const waiting = vi.fn();
  const work = vi.fn(async () => undefined);
  const second = queue.run('one', abort.signal, waiting, work);
  const checked = expect(second).rejects.toThrow();
  await expect(queue.run('two', signal, vi.fn(), async () => 'other chat')).resolves.toBe(
    'other chat',
  );
  expect(waiting).toHaveBeenCalledOnce();
  expect(work).not.toHaveBeenCalled();
  abort.abort();
  await checked;
  finish();
  await first;
  await queue.run('one', signal, vi.fn(), async () => undefined);
  expect(work).not.toHaveBeenCalled();
});

describe('queue cleanup', () => {
  it('does not poison the queue after a failed operation', async () => {
    const queue = new BrowserStepQueue();
    const signal = new AbortController().signal;
    await expect(
      queue.run('one', signal, vi.fn(), async () => {
        throw new Error('closed');
      }),
    ).rejects.toThrow('closed');
    await expect(queue.run('one', signal, vi.fn(), async () => 'ready')).resolves.toBe('ready');
  });
});
