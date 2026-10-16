import { describe, expect, it } from 'vitest';

import type { TranscriptItem } from '../../live/reducer';
import { carriedBy } from './carried';

const routed: TranscriptItem = {
  kind: 'routed',
  id: 'routed-1',
  from: 'claude-code',
  to: 'codex-cli',
  reason: 'limit',
  message: 'Claude Code reached its limit until 17:00. Codex is answering.',
};

const end = (engine: 'claude-code' | 'codex-cli', model?: string): TranscriptItem => ({
  kind: 'turn-end',
  id: `end-${engine}`,
  outcome: 'success',
  engine,
  ...(model && { model }),
});

describe('carriedBy', () => {
  it('is the provider carrying the chat on, from the line on', () => {
    expect(carriedBy([routed])).toEqual({ from: 'claude-code', engine: 'codex-cli' });
    expect(carriedBy([{ ...routed, model: 'gpt-6.1' }])).toEqual({
      from: 'claude-code',
      engine: 'codex-cli',
      model: 'gpt-6.1',
    });
  });

  it('takes the model its replies were from', () => {
    expect(carriedBy([routed, end('codex-cli', 'gpt-6.1-sol')])).toEqual({
      from: 'claude-code',
      engine: 'codex-cli',
      model: 'gpt-6.1-sol',
    });
  });

  it('ends once the chat’s own provider answers again (the limit reset)', () => {
    expect(carriedBy([routed, end('codex-cli'), end('claude-code')])).toBeUndefined();
  });

  it('ends at Switch back, a move for good, or a switch someone asked for', () => {
    expect(carriedBy([{ ...routed, back: {} }])).toBeUndefined();
    expect(carriedBy([{ ...routed, stayed: true }])).toBeUndefined();
    expect(
      carriedBy([
        routed,
        {
          kind: 'switched',
          id: 'switched-1',
          from: 'claude-code',
          to: 'codex-cli',
          message: 'Switched to GPT-6.1',
          by: 'person',
        },
      ]),
    ).toBeUndefined();
  });

  it('is nothing in a chat its own provider answers', () => {
    expect(carriedBy([end('claude-code')])).toBeUndefined();
    expect(carriedBy([])).toBeUndefined();
  });
});
