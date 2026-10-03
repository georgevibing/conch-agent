import { describe, expect, it } from 'vitest';

import { toolUseIdOf } from './engine';

describe('which tool call a host tool answers', () => {
  it('reads Claude Code’s own note on the request', () => {
    expect(toolUseIdOf({ _meta: { 'claudecode/toolUseId': 'toolu_01' } })).toBe('toolu_01');
  });

  it('says nothing when the note is missing or isn’t one', () => {
    for (const extra of [
      undefined,
      null,
      'toolu_01',
      {},
      { _meta: null },
      { _meta: { 'claudecode/toolUseId': 7 } },
      { _meta: { 'claudecode/toolUseId': '' } },
      { _meta: { 'claudecode/toolUseId': 'x'.repeat(201) } },
    ])
      expect(toolUseIdOf(extra)).toBeUndefined();
  });
});
