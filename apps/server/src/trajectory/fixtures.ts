/** A chat's log, as every provider's turns reach it, for the trajectory tests. */
import type { ConversationEvent, ConversationSummary } from '@conch/protocol';

type Event = ConversationEvent extends infer E
  ? E extends ConversationEvent
    ? Omit<E, 'conversationId' | 'seq' | 'at'>
    : never
  : never;

/** Events one second apart from `start`, numbered in order. */
export function logOf(
  id: string,
  events: (Event & { at?: number })[],
  start = 1_000_000,
): ConversationEvent[] {
  let at = start;
  return events.map((e, seq) => {
    at = e.at ?? at + 1000;
    return { conversationId: id, seq, ...e, at } as ConversationEvent;
  });
}

export const chatOf = (
  id: string,
  extra: Partial<ConversationSummary> = {},
): ConversationSummary => ({
  id,
  title: 'Fix the login test',
  preview: '',
  createdAt: 1_000_000,
  updatedAt: 1_100_000,
  status: 'idle',
  options: {},
  ...extra,
});

/** A turn that thinks, edits a file after asking, runs the tests, and answers. */
export function workedChat(id = 'c1', engine: 'claude-code' | 'codex-cli' = 'claude-code') {
  return logOf(id, [
    { type: 'user.message', messageId: 'u1', text: 'Fix the login test please' },
    {
      type: 'assistant.delta',
      messageId: 'a1',
      kind: 'thinking',
      delta: 'The test expects a 200.',
    },
    { type: 'assistant.delta', messageId: 'a1', kind: 'text', delta: 'Looking at it now.' },
    {
      type: 'tool.started',
      toolUseId: 't1',
      name: 'Edit',
      input: { file_path: 'src/login.ts', old_string: 'return 500;', new_string: 'return 200;' },
    },
    {
      type: 'permission.requested',
      permissionId: 'p1',
      toolUseId: 't1',
      toolName: 'Edit',
      input: {},
      summary: 'Edit src/login.ts',
    },
    { type: 'permission.resolved', permissionId: 'p1', decision: 'allow', at: 1_009_000 },
    {
      type: 'tool.finished',
      toolUseId: 't1',
      status: 'success',
      output: 'Edited',
      durationMs: 300,
    },
    {
      type: 'files.changed',
      changeSetId: 'cs1',
      toolUseId: 't1',
      label: 'Changed login.ts',
      files: [{ path: 'src/login.ts', kind: 'changed' }],
    },
    { type: 'tool.started', toolUseId: 't2', name: 'Bash', input: { command: 'npm test' } },
    { type: 'tool.finished', toolUseId: 't2', status: 'success', output: '241 passed' },
    {
      type: 'assistant.delta',
      messageId: 'a2',
      kind: 'text',
      delta: 'Fixed: the test passes now.',
    },
    { type: 'assistant.done', messageId: 'a2' },
    {
      type: 'turn.completed',
      outcome: 'success',
      engine,
      model: 'model-x',
      usage: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 800 },
      cost: { billing: 'metered', usd: 0.04 },
    },
  ]);
}
