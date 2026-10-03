import type { ReplySuggestion } from '@conch/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { cleanReplies, suggestRepliesTool } from './tools';

const texts = (replies: ReplySuggestion[]) => replies.map((r) => r.text);

describe('cleaning what the assistant offers', () => {
  it('trims, keeps one line, and drops repeats whatever their case or full stop', () => {
    expect(
      texts(
        cleanReplies([
          { text: '  Make it shorter ' },
          { text: 'make it shorter.' },
          { text: 'Add Ada\nto the invite' },
        ]),
      ),
    ).toEqual(['Make it shorter', 'Add Ada to the invite']);
  });

  it('drops filler and empty ones', () => {
    expect(
      texts(
        cleanReplies([
          { text: 'Tell me more' },
          { text: 'Thanks!' },
          { text: '   ' },
          { text: 'OK' },
          { text: 'Draft the email to Sam' },
        ]),
      ),
    ).toEqual(['Draft the email to Sam']);
  });

  it('drops one too long rather than cutting it, and keeps three at most', () => {
    expect(
      texts(
        cleanReplies([
          { text: 'x'.repeat(121) },
          { text: 'One' + ' more'.repeat(3) },
          { text: 'Two of them' },
          { text: 'Three of them' },
          { text: 'Four of them' },
        ]),
      ),
    ).toEqual(['One more more more', 'Two of them', 'Three of them']);
  });
});

describe('suggest_replies', () => {
  it('takes note of what to show, and says so in words the model can act on', async () => {
    let noted: ReplySuggestion[] | undefined;
    const tool = suggestRepliesTool((replies) => (noted = replies));
    expect(tool.name).toBe('suggest_replies');
    expect(tool.alwaysLoad).toBe(true);
    const out = await tool.run({ replies: [{ text: 'Make it shorter' }, { text: 'Thanks' }] });
    expect(noted).toEqual([{ text: 'Make it shorter' }]);
    expect(out).toMatch(/under your reply/);
  });

  it('says when nothing was worth showing, and clears what an earlier call offered', async () => {
    let noted: ReplySuggestion[] | undefined = [{ text: 'Earlier' }];
    const tool = suggestRepliesTool((replies) => (noted = replies));
    const out = await tool.run({ replies: [{ text: 'Tell me more' }] });
    expect(noted).toEqual([]);
    expect(out).toMatch(/Nothing to show/);
  });

  it('asks for one to three replies of at most 120 characters', () => {
    const schema = z.object(suggestRepliesTool(() => {}).input);
    expect(schema.safeParse({ replies: [] }).success).toBe(false);
    expect(
      schema.safeParse({ replies: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ replies: [{ text: 'x'.repeat(121) }] }).success).toBe(false);
    expect(schema.safeParse({ replies: [{ text: 'Make it shorter' }] }).success).toBe(true);
  });

  it('tells the model when and how to use it', () => {
    const { description } = suggestRepliesTool(() => {});
    expect(description).toMatch(/Call it last/);
    expect(description).toMatch(/first person/);
    expect(description).toMatch(/Tell me more/);
    expect(description).toMatch(/should simply have done already/);
  });
});
