import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import {
  emptyView,
  heldMessage,
  lastUserText,
  pendingPermission,
  reduce,
  reduceAll,
} from './reducer';

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

  it('shows retry notices until progress resumes, and tracks options', () => {
    const e = (seq: number, rest: object) =>
      ({ conversationId: 'c', seq, at: seq, ...rest }) as ConversationEvent;
    let view = reduceAll([
      e(0, { type: 'user.message', messageId: 'u', text: 'hi' }),
      e(1, { type: 'notice', code: 'retry', message: 'Retrying in 2s' }),
      e(2, { type: 'options', options: { effort: 'high' } }),
    ]);
    // The code travels with it: only a retry is "still trying".
    expect(view.notice).toEqual({ code: 'retry', message: 'Retrying in 2s' });
    expect(view.options).toEqual({ effort: 'high' });
    view = reduce(
      view,
      e(3, { type: 'assistant.delta', messageId: 'm', kind: 'text', delta: 'Hello' }),
    );
    expect(view.notice).toBeUndefined();
  });
});

describe('offline and at a limit (ADR 0018)', () => {
  it('a message waiting for the internet is one card, counting what waits, until it goes', () => {
    const waiting = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'first' },
        { type: 'turn.held', reason: 'offline' },
        { type: 'user.message', messageId: 'u2', text: 'second' },
        { type: 'turn.held', reason: 'offline' },
      ),
    );
    expect(waiting.items.map((i) => i.kind)).toEqual(['user', 'user', 'held']);
    expect(heldMessage(waiting)).toMatchObject({ kind: 'held', count: 2 });

    // Back online, it goes by itself: the card becomes a quiet "sent" line.
    const sent = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'first' },
        { type: 'turn.held', reason: 'offline' },
        { type: 'status', status: 'running' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Hi' },
      ),
    );
    expect(sent.items[1]).toMatchObject({ kind: 'held', sent: true });
    expect(heldMessage(sent)).toBeUndefined();
  });

  it('a provider that couldn’t be reached, then waiting: the card says it, not an error', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'hi' },
        { type: 'turn.completed', outcome: 'error', error: 'fetch failed', problem: 'unavailable' },
        { type: 'status', status: 'error' },
        { type: 'turn.held', reason: 'offline' },
      ),
    );
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'held']);
  });

  it('another provider answering replaces the failure (or the wait) with one quiet line', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'go on' },
        { type: 'turn.completed', outcome: 'error', error: 'limit', problem: 'limit' },
        { type: 'status', status: 'error' },
        {
          type: 'turn.routed',
          from: 'claude-code',
          to: 'openrouter',
          reason: 'limit',
          message: 'Claude Code reached its limit for now, so OpenRouter answered.',
        },
        { type: 'status', status: 'running' },
      ),
    );
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'routed']);
    expect(view.items[1]).toMatchObject({ reason: 'limit', to: 'openrouter' });

    const released = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'hi' },
        { type: 'turn.held', reason: 'offline' },
        {
          type: 'turn.routed',
          from: 'claude-code',
          to: 'mock',
          reason: 'offline',
          message: 'You were offline, so Ollama on this computer answered.',
        },
      ),
    );
    expect(released.items.map((i) => i.kind)).toEqual(['user', 'routed']);
  });
});
