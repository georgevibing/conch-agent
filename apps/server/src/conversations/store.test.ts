import { describe, expect, it } from 'vitest';

import { compact } from './store';
import { summarizeToolUse, titleFrom } from './summarize';

describe('conversation helpers', () => {
  it('merges streaming deltas but keeps seq monotonic', () => {
    const base = { conversationId: 'c', at: 0 };
    const out = compact([
      { ...base, seq: 0, type: 'user.message', messageId: 'u', text: 'hi' },
      { ...base, seq: 1, type: 'status', status: 'running' },
      { ...base, seq: 2, type: 'assistant.delta', messageId: 'm', kind: 'text', delta: 'Hel' },
      { ...base, seq: 3, type: 'assistant.delta', messageId: 'm', kind: 'text', delta: 'lo' },
      { ...base, seq: 4, type: 'assistant.done', messageId: 'm' },
    ]);
    expect(out.map((e) => e.seq)).toEqual([0, 3, 4]);
    expect(out[1]).toMatchObject({ delta: 'Hello' });
  });

  it('summarises tool use for permission prompts', () => {
    expect(summarizeToolUse('Bash', { command: 'npm test' })).toBe('Run `npm test`');
    expect(summarizeToolUse('Edit', { file_path: '/a/b.ts' })).toBe('Edit /a/b.ts');
    expect(summarizeToolUse('mcp__github__create_issue', {})).toBe('Use create_issue from github');
  });

  it('makes short titles', () => {
    expect(titleFrom('Fix the bug')).toBe('Fix the bug');
    expect(
      titleFrom('Please help me write a long and detailed plan for migrating our database'),
    ).toMatch(/…$/);
  });
});
