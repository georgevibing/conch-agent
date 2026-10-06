import { describe, expect, it } from 'vitest';

import type { ConversationEvent } from './index';
import { chatGoal, contextStart, undoableClear } from './chat-context';

let seq = 0;
const base = () => ({ conversationId: 'c1', seq: seq++, at: 0 });
const user = (text = 'hello'): ConversationEvent => ({
  ...base(),
  type: 'user.message',
  messageId: `u${seq}`,
  text,
});
const cleared = (): ConversationEvent => ({ ...base(), type: 'context.cleared' });
const restored = (clearedSeq: number): ConversationEvent => ({
  ...base(),
  type: 'context.restored',
  clearedSeq,
});
const goal = (value: string | null): ConversationEvent => ({
  ...base(),
  type: 'goal',
  goal: value,
});

describe('where the model’s memory starts', () => {
  it('is the newest clear still in force, and -1 when none is', () => {
    seq = 0;
    expect(contextStart([user()])).toBe(-1);
    seq = 0;
    const events = [user(), cleared(), user(), cleared()];
    expect(contextStart(events)).toBe(3);
    // Each Undo takes back the newest.
    const back = [...events, restored(3)];
    expect(contextStart(back)).toBe(1);
    expect(contextStart([...back, restored(1)])).toBe(-1);
  });

  it('ignores an Undo that doesn’t match the newest clear', () => {
    seq = 0;
    const events = [user(), cleared(), user(), cleared(), restored(1)];
    expect(contextStart(events)).toBe(3);
  });

  it('reads it as of a moment, for the turn being answered', () => {
    seq = 0;
    const events = [user(), cleared(), user()];
    expect(contextStart(events, 1)).toBe(-1);
    expect(contextStart(events, 3)).toBe(1);
  });
});

describe('undoableClear', () => {
  it('is the newest clear while nothing was sent after it', () => {
    seq = 0;
    const events = [user(), cleared()];
    expect(undoableClear(events)).toBe(1);
    expect(undoableClear([...events, user()])).toBeUndefined();
    seq = 0;
    expect(undoableClear([user()])).toBeUndefined();
  });
});

describe('chatGoal', () => {
  it('is the latest one set, and gone once it’s cleared', () => {
    seq = 0;
    expect(chatGoal([user()])).toBeUndefined();
    expect(chatGoal([goal('Ship it'), goal('Ship it well')])).toBe('Ship it well');
    expect(chatGoal([goal('Ship it'), goal(null)])).toBeUndefined();
    // A clear doesn't touch it.
    expect(chatGoal([goal('Ship it'), cleared()])).toBe('Ship it');
  });
});
