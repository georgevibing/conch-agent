import { describe, expect, it } from 'vitest';

import type { ConversationView } from '../../live/reducer';
import { chatMarkdown, exportName, lastReply } from './export';

const view: Pick<ConversationView, 'items' | 'goal'> = {
  goal: 'Plan the garden',
  items: [
    { kind: 'user', id: 'u1', text: 'Where do tomatoes go?', at: 1 },
    {
      kind: 'assistant',
      id: 'a1',
      messageId: 'a1',
      continuation: false,
      text: 'Along the south fence.',
      thinking: 'hidden thoughts',
      done: true,
      startedAt: 1,
    },
    {
      kind: 'assistant',
      id: 'a1#1',
      messageId: 'a1',
      continuation: true,
      text: 'With basil between them.',
      thinking: '',
      done: true,
      startedAt: 2,
    },
    { kind: 'cleared', id: 'cleared-5', seq: 5 },
    { kind: 'goal-note', id: 'goal-6' },
  ],
};

describe('/export', () => {
  it('writes what was said, where it was cleared, and the goal, never the thinking', () => {
    const text = chatMarkdown(view, { title: 'Garden', name: 'Conch', at: new Date(0) });
    expect(text).toMatch(/^# Garden\n/);
    expect(text).toContain('**Goal:** Plan the garden');
    expect(text).toContain('## You\n\nWhere do tomatoes go?');
    // One reply under one heading, however many segments it came in.
    expect(text.match(/## Conch/g)).toHaveLength(1);
    expect(text).toContain('Along the south fence.\n\nWith basil between them.');
    expect(text).toContain('_Context cleared: Conch started fresh from here._');
    expect(text).toContain('_Goal cleared_');
    expect(text).not.toContain('hidden thoughts');
  });

  it('names the file after the chat', () => {
    expect(exportName('Plan my week!')).toBe('plan-my-week.md');
    expect(exportName('Café crème')).toBe('cafe-creme.md');
    expect(exportName('   ')).toBe('chat.md');
  });

  it('copies the whole last reply', () => {
    expect(lastReply(view)).toBe('Along the south fence.\n\nWith basil between them.');
    expect(lastReply({ items: [] })).toBeUndefined();
  });
});
