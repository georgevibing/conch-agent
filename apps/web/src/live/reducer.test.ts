import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { emptyView, lastUserText, pendingPermission, reduce, reduceAll } from './reducer';

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

describe('transcript reducer', () => {
  it('streams deltas into one assistant message and closes it', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Hi' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'thinking', delta: 'Hmm' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Hel' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'lo' },
        { type: 'assistant.done', messageId: 'm1' },
      ),
    );
    expect(view.items).toHaveLength(2);
    expect(view.items[1]).toMatchObject({
      kind: 'assistant',
      text: 'Hello',
      thinking: 'Hmm',
      done: true,
      textAt: 1200,
    });
  });

  it('keeps chronological order when tools interleave with text', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'List files' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'thinking', delta: '…' },
        { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool.finished', toolUseId: 't1', status: 'success', output: 'a\nb' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Two files.' },
      ),
    );
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(view.items[1]).toMatchObject({ thoughtEndedAt: 1200, continuation: false });
    expect(view.items[2]).toMatchObject({ status: 'success', output: 'a\nb' });
    expect(view.items[3]).toMatchObject({ id: 'm1#1', text: 'Two files.', continuation: true });
  });

  it('is idempotent when events are replayed', () => {
    const events = log(
      { type: 'user.message', messageId: 'u1', text: 'Hi' },
      { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Yo' },
    );
    const once = reduceAll(events);
    expect(reduceAll(events, once)).toBe(once);
  });

  it('tracks permission prompts until resolved', () => {
    let view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Run tests' },
        {
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'Bash',
          input: {},
          summary: 'Run `npm test`',
        },
        { type: 'status', status: 'awaiting-permission' },
      ),
    );
    expect(pendingPermission(view)).toMatchObject({ id: 'p1' });
    expect(view.status).toBe('awaiting-permission');
    view = reduce(view, {
      type: 'permission.resolved',
      permissionId: 'p1',
      decision: 'allow',
      conversationId: 'c1',
      seq: 10,
      at: 0,
    });
    expect(pendingPermission(view)).toBeUndefined();
  });

  it('records memories and errors, closing open messages at turn end', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Remember I like tea' },
        {
          type: 'memory.saved',
          memory: {
            id: 'm_1',
            content: 'Likes tea',
            kind: 'preference',
            source: 'agent',
            createdAt: 0,
            updatedAt: 0,
          },
        },
        { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Noted' },
        { type: 'turn.completed', outcome: 'error', error: 'Rate limited' },
      ),
    );
    expect(view.items[1]).toMatchObject({ kind: 'memory', memoryId: 'm_1', action: 'saved' });
    expect(view.items[2]).toMatchObject({ kind: 'assistant', done: true });
    expect(view.items[3]).toMatchObject({
      kind: 'turn-end',
      outcome: 'error',
      error: 'Rate limited',
    });
    expect(lastUserText(view)).toBe('Remember I like tea');
    expect(view.turnStartedAt).toBeUndefined();
  });

  it('starts empty', () => {
    expect(emptyView.items).toEqual([]);
  });
});
