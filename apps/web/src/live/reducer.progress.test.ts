import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { reduceAll } from './reducer';

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

const started = (id: string): ConversationEventInput => ({
  type: 'tool.started',
  toolUseId: id,
  name: 'mcp__conch__image_generate',
  input: { prompt: 'Dunes', aspect_ratio: '3:2' },
});

const tool = (events: ConversationEvent[], id: string) => {
  const item = reduceAll(events).items.find((i) => i.kind === 'tool' && i.id === id);
  if (item?.kind !== 'tool') throw new Error('no tool row');
  return item;
};

describe('tool.progress', () => {
  it('goes to the newest unfinished call of its tool, never backwards, keeping the last preview', () => {
    const events = log(
      started('t0'),
      { type: 'tool.finished', toolUseId: 't0', status: 'success', output: '{}' },
      started('t1'),
      { type: 'tool.progress', toolName: 'image_generate', stage: 'queued', progress: 0 },
      {
        type: 'tool.progress',
        toolName: 'image_generate',
        stage: 'generating',
        progress: 0.5,
        preview: 'att-p1',
        by: 'OpenAI',
      },
      { type: 'tool.progress', toolName: 'image_generate', stage: 'generating', progress: 0.4 },
    );
    expect(tool(events, 't0').progress).toBeUndefined();
    expect(tool(events, 't1').progress).toEqual({
      stage: 'generating',
      progress: 0.5,
      preview: 'att-p1',
      by: 'OpenAI',
      at: 1500,
      since: 1300,
    });
  });

  it('matches by id when it has one, and is ignored once the call is over or for nothing', () => {
    const events = log(
      started('t1'),
      { type: 'tool.progress', toolName: 'image_generate', toolUseId: 't1', progress: 0.2 },
      { type: 'tool.finished', toolUseId: 't1', status: 'success', output: '{}' },
      { type: 'tool.progress', toolName: 'image_generate', toolUseId: 't1', progress: 0.9 },
      { type: 'tool.progress', toolName: 'other_tool', progress: 0.9 },
    );
    expect(tool(events, 't1').progress?.progress).toBe(0.2);
  });
});
