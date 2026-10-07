import type { ConversationSummary, Task } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { FRESH_MS, isTaskFresh } from './seen';

const NOW = 1_790_000_000_000;

const task = (patch: Partial<Task> = {}): Task => ({
  id: 't1',
  kind: 'background',
  title: 'Tidy up the README',
  prompt: 'Tidy up the README',
  status: 'done',
  options: {},
  createdAt: NOW - 60_000,
  startedAt: NOW - 60_000,
  finishedAt: NOW - 1000,
  steps: [],
  parentConversationId: 'c1',
  conversationId: 'c-task',
  rev: 1,
  ...patch,
});

const chat = (patch: Partial<ConversationSummary>) =>
  ({
    id: 'c-task',
    title: 'Tidy up the README',
    preview: '',
    createdAt: NOW - 60_000,
    updatedAt: NOW - 1000,
    status: 'idle',
    options: {},
    ...patch,
  }) as ConversationSummary;

describe('isTaskFresh', () => {
  it('is new while its own chat moved on after you last had it open', () => {
    expect(isTaskFresh(task(), [chat({ seenAt: 0 })], NOW)).toBe(true);
    expect(isTaskFresh(task(), [chat({ seenAt: NOW - 500 })], NOW)).toBe(false);
  });

  it('counts one that didn’t finish, whatever its chat’s state', () => {
    expect(
      isTaskFresh(task({ status: 'failed' }), [chat({ seenAt: 0, status: 'error' })], NOW),
    ).toBe(true);
  });

  it('is never new while it’s going, or long after', () => {
    expect(isTaskFresh(task({ status: 'running' }), [chat({ seenAt: 0 })], NOW)).toBe(false);
    expect(isTaskFresh(task({ finishedAt: NOW - FRESH_MS - 1 }), [chat({ seenAt: 0 })], NOW)).toBe(
      false,
    );
  });

  it('without a chat of its own, asks the chat it came from', () => {
    const lone = task({ conversationId: undefined });
    expect(isTaskFresh(lone, [chat({ id: 'c1', seenAt: NOW - 5000 })], NOW)).toBe(true);
    expect(isTaskFresh(lone, [chat({ id: 'c1', seenAt: NOW })], NOW)).toBe(false);
    // From before Conch kept track: never new.
    expect(isTaskFresh(lone, [chat({ id: 'c1' })], NOW)).toBe(false);
  });
});
