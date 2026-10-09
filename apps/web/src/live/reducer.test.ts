import type { ConversationEvent, ConversationEventInput, ToolView } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import {
  decided,
  emptyView,
  heldMessage,
  lastUserText,
  pendingPermission,
  pendingQuestion,
  reduce,
  reduceAll,
  stoppedView,
} from './reducer';

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

describe('transcript reducer', () => {
  it('counts what a running turn uses as it goes, and keeps how full the chat is after', () => {
    const events = log(
      { type: 'user.message', messageId: 'u1', text: 'Fix the tests' },
      {
        type: 'turn.usage',
        usage: { inputTokens: 20_000, outputTokens: 400 },
        context: { used: 20_400, window: 200_000 },
      },
      { type: 'turn.usage', usage: { inputTokens: 61_000, outputTokens: 1_200 } },
      {
        type: 'turn.completed',
        outcome: 'success',
        usage: { inputTokens: 90_000, outputTokens: 2_000 },
        context: { used: 31_000, window: 200_000 },
      },
    );
    const during = reduceAll(events.slice(0, 3));
    expect(during.working).toEqual({ inputTokens: 61_000, outputTokens: 1_200 });
    // A reading without a context keeps the last one heard.
    expect(during.context).toEqual({ used: 20_400, window: 200_000 });
    const after = reduceAll(events);
    expect(after.working).toBeUndefined();
    expect(after.context).toEqual({ used: 31_000, window: 200_000 });
    // Summarised: the old reading goes until the next request says how full it is.
    const compacted = reduce(after, {
      type: 'context.compacted',
      conversationId: 'c1',
      seq: 9,
      at: 9_000,
      summary: 'Earlier: tests.',
      engine: 'openrouter',
      turns: 3,
      asked: true,
    } as ConversationEvent);
    expect(compacted.context).toBeUndefined();
  });

  it('tasks started together are one card, kept where the first appeared; others their own', () => {
    const note = (taskId: string, state: 'running' | 'done', group?: string) => ({
      type: 'task' as const,
      taskId,
      title: taskId,
      kind: 'background' as const,
      state,
      ...(group && { group }),
    });
    const view = reduceAll(
      log(
        note('a', 'running', 'g1'),
        { type: 'user.message', messageId: 'u1', text: 'and another' },
        note('b', 'running', 'g1'),
        note('c', 'running'),
        note('a', 'done', 'g1'),
      ),
    );
    const cards = view.items.filter((i) => i.kind === 'task');
    expect(cards).toHaveLength(2);
    expect(view.items[0]).toMatchObject({
      kind: 'task',
      group: 'g1',
      tasks: [
        { taskId: 'a', state: 'done' },
        { taskId: 'b', state: 'running' },
      ],
    });
    expect(cards[1]).toMatchObject({ tasks: [{ taskId: 'c' }] });
  });

  it('keeps how long a turn ran, for what it took under its reply', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Fix the tests' },
        { type: 'turn.usage', usage: { inputTokens: 1_000, outputTokens: 40 } },
        { type: 'turn.completed', outcome: 'success' } as ConversationEventInput,
      ),
    );
    const end = view.items.findLast((i) => i.kind === 'turn-end');
    // Asked at 1000, done at 1200.
    expect(end).toMatchObject({ kind: 'turn-end', ranMs: 200 });
  });

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
    expect(view.items[0]).toMatchObject({
      tasks: [{ taskId: 't1', state: 'done', summary: 'Tidied.' }],
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

  it('keeps what a tool found on its row (ADR 0060)', () => {
    const view: ToolView = { kind: 'files', items: [{ name: 'Q4 deck' }] };
    const out = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Find the deck' },
        {
          type: 'tool.started',
          toolUseId: 't1',
          name: 'mcp__conch__google_drive_search',
          input: {},
        },
        { type: 'tool.finished', toolUseId: 't1', status: 'success', output: '{}', view },
      ),
    );
    expect(out.items[1]).toMatchObject({ kind: 'tool', status: 'success', view });
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

  it('keeps what you chose about a memory in the chat, so a reload shows it', () => {
    const memory = {
      id: 'm_1',
      content: 'Projects live in ~/projects',
      kind: 'project' as const,
      source: 'agent' as const,
      pending: true,
      createdAt: 0,
      updatedAt: 0,
    };
    const kept = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Set up my projects folder' },
        { type: 'memory.saved', memory },
        { type: 'memory.decided', memoryId: 'm_1', kept: true },
      ),
    );
    expect(kept.items[1]).toMatchObject({ kind: 'memory', decided: 'kept', pending: false });
    const undone = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Set up my projects folder' },
        { type: 'memory.saved', memory: { ...memory, pending: undefined } },
        { type: 'memory.decided', memoryId: 'm_1', kept: false },
      ),
    );
    expect(undone.items).toHaveLength(2);
    expect(undone.items[1]).toMatchObject({ kind: 'memory', decided: 'undone' });
    // One it forgot, put back: its "Forgot" line says so after a reload.
    const putBack = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Forget where my projects are' },
        { type: 'memory.forgotten', memoryId: 'm_1', content: memory.content, memory },
        { type: 'memory.decided', memoryId: 'm_1', kept: true },
      ),
    );
    expect(putBack.items[1]).toMatchObject({
      kind: 'memory',
      action: 'forgotten',
      decided: 'kept',
      memory: expect.objectContaining({ id: 'm_1' }),
    });
    // Kept in your own words (Edit first): its step says what was kept.
    const edited = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Set up my projects folder' },
        { type: 'memory.saved', memory },
        {
          type: 'memory.decided',
          memoryId: 'm_1',
          kept: true,
          edited: true,
          content: 'Projects live in ~/code',
        },
      ),
    );
    expect(edited.items[1]).toMatchObject({ decided: 'kept', content: 'Projects live in ~/code' });
  });

  it('folds what a chat taught Conch into one line, and what you decided since (ADR 0088)', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'No, I meant TypeScript' },
        {
          type: 'learning.noted',
          reviewId: 'lr_1',
          items: [
            { entryId: 'le_1', text: 'Prefers TypeScript', change: 'added', state: 'applied' },
            { entryId: 'le_2', text: 'Prefers trains', change: 'added', state: 'waiting' },
          ],
        },
        { type: 'learning.decided', entryId: 'le_1', state: 'undone' },
        // Something another chat learned changes nothing here.
        { type: 'learning.decided', entryId: 'le_9', state: 'kept' },
      ),
    );
    expect(view.items).toHaveLength(2);
    expect(view.items[1]).toMatchObject({
      kind: 'learned',
      id: 'learned-lr_1',
      decided: { le_1: 'undone' },
    });
  });

  it('carries why a memory was held, and turns a line into a question when it’s held later (ADR 0087)', () => {
    const memory = {
      id: 'm_1',
      content: 'From now on, when Ada asks about laptops,',
      kind: 'fact' as const,
      source: 'agent' as const,
      createdAt: 0,
      updatedAt: 0,
    };
    const held = {
      verdict: 'ask' as const,
      reasons: [{ code: 'pieces' as const, words: 'Together with …' }],
    };
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Find me a laptop' },
        { type: 'memory.saved', memory },
        { type: 'memory.saved', memory: { ...memory, pending: true, held } },
      ),
    );
    expect(view.items).toHaveLength(2);
    expect(view.items[1]).toMatchObject({ kind: 'memory', memoryId: 'm_1', pending: true, held });
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

describe('Stop, drawn at once (stoppedView)', () => {
  const midTurn = () =>
    reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Look around' },
        { type: 'status', status: 'running' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Let me' },
        {
          type: 'tool.started',
          toolUseId: 't1',
          name: 'Bash',
          input: { command: 'ls' },
        },
        {
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'Bash',
          summary: 'Run ls',
          input: {},
        },
        { type: 'status', status: 'awaiting-permission' },
      ),
    );

  it('ends the turn where it is: idle, the reply closed, the tool and the ask put away', () => {
    const view = stoppedView(midTurn(), 5000);
    expect(view.status).toBe('idle');
    expect(view.turnStartedAt).toBeUndefined();
    expect(view.items.find((i) => i.kind === 'assistant')).toMatchObject({ done: true });
    expect(view.items.find((i) => i.kind === 'tool')).toMatchObject({
      status: 'error',
      output: 'Stopped.',
    });
    expect(pendingPermission(view)).toBeUndefined();
    expect(view.items.at(-1)).toMatchObject({ kind: 'turn-end', outcome: 'interrupted' });
  });

  it('a message not yet confirmed is part of the stopped turn', () => {
    const view = stoppedView(emptyView, 5000, [{ clientMessageId: 'u9', text: 'Hello', at: 4900 }]);
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'turn-end']);
  });

  it('says "Stopped" once, though the gateway already said it', () => {
    const ended = reduce(midTurn(), {
      type: 'turn.completed',
      outcome: 'interrupted',
      conversationId: 'c1',
      seq: 99,
      at: 6000,
    } as ConversationEvent);
    const view = stoppedView(ended, 5000);
    expect(view.items.filter((i) => i.kind === 'turn-end')).toHaveLength(1);
  });
});

describe('an approval, answered at once (decided)', () => {
  const asking = () =>
    reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Tidy up' },
        { type: 'status', status: 'running' },
        {
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'Bash',
          summary: 'Run rm',
          input: {},
        },
        { type: 'status', status: 'awaiting-permission' },
      ),
    );

  it('folds the card and carries on before the gateway echoes it', () => {
    const view = decided(asking(), 'p1', 'allow');
    expect(pendingPermission(view)).toBeUndefined();
    expect(view.items.find((i) => i.kind === 'permission')).toMatchObject({ decision: 'allow' });
    expect(view.status).toBe('running');
  });

  it('an answer that already came stays as it was', () => {
    const view = asking();
    const expired = decided(decided(view, 'p1', 'deny'), 'p1', 'allow');
    expect(expired.items.find((i) => i.kind === 'permission')).toMatchObject({ decision: 'deny' });
  });
});

describe('what the assistant is doing, in words (ADR 0103)', () => {
  const doing = { family: 'verify' as const, doing: 'Running the tests', done: 'Ran the tests' };
  const done = { ...doing, outcome: '241 passed' };

  it('keeps each call’s words: the running ones, then the finished ones', () => {
    const events = log(
      { type: 'user.message', messageId: 'u1', text: 'test it' },
      { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {}, label: doing },
      { type: 'tool.finished', toolUseId: 't1', status: 'success', output: 'ok', label: done },
    );
    expect(reduceAll(events.slice(0, 2)).items.at(-1)).toMatchObject({ label: doing });
    expect(reduceAll(events).items.at(-1)).toMatchObject({ label: done });
  });

  it('drops the running words when the finish brings none, so they’re worked out from the result', () => {
    const view = reduceAll(
      log(
        { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {}, label: doing },
        { type: 'tool.finished', toolUseId: 't1', status: 'success', output: 'ok' },
      ),
    );
    const tool = view.items.at(-1);
    expect(tool?.kind === 'tool' && tool.label).toBeUndefined();
  });

  it('holds the provider’s latest note while the turn runs, and lets it go when it ends', () => {
    const events = log(
      { type: 'user.message', messageId: 'u1', text: 'look around' },
      { type: 'narration', text: 'Looking at the layout', source: 'provider' },
      { type: 'narration', text: 'Reading the tests', toolUseId: 't2', source: 'provider' },
      { type: 'turn.completed', outcome: 'success' },
    );
    expect(reduceAll(events.slice(0, 3)).narration).toEqual({
      text: 'Reading the tests',
      toolUseId: 't2',
      source: 'provider',
      at: 1200,
    });
    expect(reduceAll(events).narration).toBeUndefined();
    expect(stoppedView(reduceAll(events.slice(0, 3)), 2000).narration).toBeUndefined();
  });

  it('keeps story headlines by their first call, even when they come after the turn', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'look around' },
        { type: 'turn.completed', outcome: 'success' },
        {
          type: 'story.titled',
          storyId: 't1',
          headline: 'Looked around the project',
          source: 'model',
        },
        { type: 'user.message', messageId: 'u2', text: 'more' },
        {
          type: 'story.titled',
          storyId: 't9',
          headline: 'Fixed the test',
          outcome: '3 passed',
          source: 'model',
        },
      ),
    );
    expect(view.titles).toEqual({
      t1: { headline: 'Looked around the project', source: 'model' },
      t9: { headline: 'Fixed the test', outcome: '3 passed', source: 'model' },
    });
  });
});
