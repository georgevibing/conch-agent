import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import {
  emptyView,
  heldMessage,
  lastUserText,
  pendingPermission,
  pendingQuestion,
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

  it('keeps one card per task, brought up to date where it first appeared', () => {
    const task = { type: 'task', taskId: 't1', title: 'Tidy', kind: 'background' } as const;
    const view = reduceAll(
      log(
        { ...task, state: 'queued' },
        { type: 'user.message', messageId: 'u1', text: 'Meanwhile…' },
        { ...task, state: 'running' },
        { ...task, state: 'done', summary: 'Tidied.' },
      ),
    );
    expect(view.items.map((i) => i.kind)).toEqual(['task', 'user']);
    expect(view.items[0]).toMatchObject({ taskId: 't1', state: 'done', summary: 'Tidied.' });
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

  it('shows where it looked through earlier chats, once per look', () => {
    const chats = [{ id: 'c9', title: 'Wedding', lines: [] }];
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Which venue was it?' },
        { type: 'chats.looked', lookId: 'look_1', action: 'search', query: 'venue', chats },
        { type: 'chats.looked', lookId: 'look_2', action: 'read', chats },
      ),
    );
    expect(view.items.slice(1)).toEqual([
      { kind: 'looked', id: 'look_1', action: 'search', query: 'venue', chats, at: 1100 },
      { kind: 'looked', id: 'look_2', action: 'read', chats, at: 1200 },
    ]);
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

describe('offline and at a limit (ADR 0023)', () => {
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

describe('a long chat (ADR 0055)', () => {
  const compacted = (before: string | undefined, summary = 'They chose tomatoes.') =>
    ({
      type: 'context.compacted',
      summary,
      ...(before && { before }),
      engine: 'openrouter',
      model: 'GPT-5 mini',
      turns: 2,
    }) as const;

  it('puts one line where the model’s memory starts, and a newer one replaces it', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'one' },
        { type: 'user.message', messageId: 'u2', text: 'two' },
        { type: 'user.message', messageId: 'u3', text: 'three' },
        compacted('u2'),
      ),
    );
    expect(view.items.map((i) => (i.kind === 'user' ? i.id : i.kind))).toEqual([
      'u1',
      'summary',
      'u2',
      'u3',
    ]);
    expect(view.items[1]).toMatchObject({ summary: 'They chose tomatoes.', model: 'GPT-5 mini' });

    const later = reduce(view, {
      ...compacted('u3', 'Newer.'),
      conversationId: 'c1',
      seq: 9,
      at: 2000,
    });
    expect(later.items.map((i) => (i.kind === 'user' ? i.id : i.kind))).toEqual([
      'u1',
      'u2',
      'summary',
      'u3',
    ]);
    expect(later.items.filter((i) => i.kind === 'summary')).toHaveLength(1);
  });

  it('goes before the message being answered when it doesn’t say where', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'one' },
        { type: 'user.message', messageId: 'u2', text: 'two' },
        compacted(undefined),
      ),
    );
    expect(view.items.map((i) => (i.kind === 'user' ? i.id : i.kind))).toEqual([
      'u1',
      'summary',
      'u2',
    ]);
  });
});

describe('what the chat is held to (ADR 0047)', () => {
  it('folds holds from the log, and says where one ended', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: '/quick-setup' },
        {
          type: 'skill.used',
          skillId: 'quick-setup',
          name: 'quick-setup',
          title: 'Quick setup',
          by: 'user',
          permissions: {
            declared: true,
            capabilities: ['commands'],
            commands: ['git'],
            words: ['run commands (only `git`)'],
          },
        },
        { type: 'turn.completed', outcome: 'success' },
        { type: 'user.message', messageId: 'u2', text: 'go on' },
      ),
    );
    expect(view.holds).toMatchObject([
      { skillId: 'quick-setup', permissions: { commands: ['git'] } },
    ]);
    const ended = reduce(view, {
      type: 'skill.hold.ended',
      skillId: 'quick-setup',
      title: 'Quick setup',
      reason: 'you',
      conversationId: 'c1',
      seq: 9,
      at: 2000,
    });
    expect(ended.holds).toEqual([]);
    expect(ended.items.at(-1)).toEqual({
      kind: 'skill-ended',
      id: 'skill-ended-9',
      title: 'Quick setup',
    });
  });
});

describe('questions answered with a tap (ADR 0060)', () => {
  const question = {
    questionId: 'q1',
    fields: [
      {
        id: 'how',
        label: 'How would you like to talk?',
        kind: 'choice' as const,
        optional: false,
        multiple: false,
        other: true,
        options: [
          { id: 'video', label: 'Video call' },
          { id: 'phone', label: 'Phone call' },
        ],
      },
    ],
  };

  it('shows the question where it was asked, waiting, then answered in place', () => {
    const asked = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'book a call with Ada' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'thinking', delta: 'Need a time' },
        { type: 'question', question },
        { type: 'status', status: 'awaiting-permission' },
      ),
    );
    expect(asked.items.at(-1)).toMatchObject({ kind: 'question', id: 'q1', question });
    // The thinking before it ended where the question began.
    expect(asked.items[1]).toMatchObject({ kind: 'assistant', thoughtEndedAt: 1200 });
    expect(pendingQuestion(asked)?.id).toBe('q1');
    const answered = reduce(asked, {
      type: 'question.answered',
      questionId: 'q1',
      answer: { values: { how: 'phone' }, text: 'Phone call' },
      conversationId: 'c1',
      seq: 9,
      at: 2000,
    });
    expect(answered.items.at(-1)).toMatchObject({ answer: { text: 'Phone call' } });
    expect(pendingQuestion(answered)).toBeUndefined();
  });

  it('skipped (or stopped) is an answer of nothing', () => {
    const view = reduceAll(
      log(
        { type: 'question', question },
        { type: 'question.answered', questionId: 'q1', answer: null },
      ),
    );
    expect(view.items.at(-1)).toMatchObject({ kind: 'question', answer: null });
    expect(pendingQuestion(view)).toBeUndefined();
  });
});
