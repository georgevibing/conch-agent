import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ChatLearningBody,
  ConversationEvent,
  LearnedEntry,
  LearningAnswerBody,
  LearningSpendingBody,
  LearningStatus,
  Memory,
  ServerEvent,
} from './index';

/**
 * `Memory` exactly as the version before quiet learning reads it (ADR 0051 §
 * Data across versions): a memory written now must still be read by it.
 */
const PreviousMemory = z.object({
  id: z.string(),
  content: z.string().min(1).max(2000),
  kind: z.enum(['fact', 'preference', 'project', 'person']).default('fact'),
  source: z.enum(['user', 'agent', 'tidy']),
  conversationId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  pending: z.boolean().optional(),
  untrusted: z.string().max(300).optional(),
});

const memory = {
  id: 'm_1',
  content: 'On this computer, `python` isn’t found; `py` works.',
  kind: 'fact',
  source: 'agent',
  createdAt: 1,
  updatedAt: 1,
  about: 'environment',
  learned: 'le_1',
} as const;

describe('quiet learning on the wire (ADR 0087)', () => {
  it('a learned memory is still a memory to the version before', () => {
    const now = Memory.parse(memory);
    const before = PreviousMemory.safeParse(now);
    expect(before.success).toBe(true);
    // What it doesn't know it leaves out, rather than dropping the memory.
    expect(before.data).not.toHaveProperty('about');
    // A new kind would make it vanish there: that's why there isn't one.
    expect(PreviousMemory.safeParse({ ...now, kind: 'environment' }).success).toBe(false);
  });

  it('a superseded memory says when it stopped being true', () => {
    const past = Memory.parse({ ...memory, invalidAt: 5, supersededBy: 'm_2' });
    expect(past.invalidAt).toBe(5);
    expect(past.supersededBy).toBe('m_2');
  });

  it('reads an entry with where it came from', () => {
    const entry = LearnedEntry.parse({
      id: 'le_1',
      at: 2,
      change: 'superseded',
      before: { ...memory, id: 'm_0', content: 'Lives in Berlin', kind: 'fact' },
      after: { ...memory, content: 'Lives in Lisbon' },
      from: {
        conversationId: 'c1',
        quotes: ['I moved to Lisbon'],
        signals: ['correction'],
        trigger: 'idle',
        model: { engine: 'mock', model: 'mock-small' },
      },
      state: 'applied',
    });
    expect(entry.seen).toBe(1);
    expect(entry.why).toBe('');
    expect(() =>
      LearnedEntry.parse({ ...entry, from: { ...entry.from, signals: ['shouting'] } }),
    ).toThrow();
  });

  it('logs what a chat learned, and what you decided', () => {
    const noted = ConversationEvent.parse({
      conversationId: 'c1',
      seq: 9,
      at: 3,
      type: 'learning.noted',
      reviewId: 'lr_1',
      items: [
        { entryId: 'le_1', text: 'Prefers TypeScript', change: 'added', state: 'applied' },
        {
          entryId: 'le_2',
          text: 'Lives in Lisbon',
          change: 'superseded',
          state: 'waiting',
          was: 'Lives in Berlin',
          waits: 'Learned in a chat that read news.example.',
        },
      ],
    });
    expect(noted.type).toBe('learning.noted');
    expect(() => ConversationEvent.parse({ ...noted, items: [] })).toThrow();
    expect(
      ConversationEvent.parse({
        conversationId: 'c1',
        seq: 10,
        at: 4,
        type: 'learning.decided',
        entryId: 'le_1',
        state: 'undone',
      }).type,
    ).toBe('learning.decided');
    expect(ServerEvent.parse({ type: 'learning.changed' }).type).toBe('learning.changed');
  });

  it('takes only what a person may set', () => {
    expect(LearningAnswerBody.parse({ entryId: 'le_1', answer: 'undo' }).answer).toBe('undo');
    expect(() => LearningAnswerBody.parse({ entryId: 'le_1', answer: 'apply' })).toThrow();
    expect(LearningSpendingBody.parse({ limitUsd: null }).limitUsd).toBeNull();
    expect(() => LearningSpendingBody.parse({ limitUsd: -1 })).toThrow();
    expect(() => LearningSpendingBody.parse({ limitUsd: 2, extra: true })).toThrow();
    expect(() => ChatLearningBody.parse({ quiet: 'yes' })).toThrow();
  });

  it('reads a status with nothing learned yet', () => {
    const status = LearningStatus.parse({
      on: true,
      entries: [],
      waiting: 0,
      never: [],
      past: [],
      spending: { limitUsd: 1, isDefault: true, monthUsd: 0 },
      quiet: [],
    });
    expect(status.recap).toBeUndefined();
  });
});
