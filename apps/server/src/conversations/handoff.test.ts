import type { ConversationEvent } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { handoff } from './handoff';

let seq = 0;
const base = () => ({ conversationId: 'c1', seq: seq++, at: 0 });
const user = (text: string): ConversationEvent => ({
  ...base(),
  type: 'user.message',
  messageId: `u${seq}`,
  text,
});
const reply = (messageId: string, ...deltas: string[]): ConversationEvent[] =>
  deltas.map((delta) => ({
    ...base(),
    type: 'assistant.delta',
    messageId,
    kind: 'text',
    delta,
  }));

describe('handoff', () => {
  it('hands over what was said since the provider last took part, oldest first', () => {
    seq = 0;
    const events = [
      user('first question'), // 0
      ...reply('a1', 'first ', 'answer'), // 1, 2
      user('second question'), // 3
      ...reply('a2', 'second answer'), // 4
      {
        ...base(),
        type: 'assistant.delta',
        messageId: 'a2',
        kind: 'thinking',
        delta: 'secret thoughts',
      } as ConversationEvent, // 5
      user('the new message'), // 6
    ];
    const text = handoff(events, { afterSeq: 2, beforeSeq: 6 });
    expect(text).toContain('<earlier-conversation>');
    expect(text).toContain('went on without you');
    expect(text).toContain('User: second question\n\nAssistant: second answer');
    // Nothing the provider already saw, no thinking, and not the message it's about to get.
    expect(text).not.toContain('first question');
    expect(text).not.toContain('secret thoughts');
    expect(text).not.toContain('the new message');
  });

  it('says the conversation started without it when it never took part', () => {
    seq = 0;
    const events = [user('hello'), ...reply('a1', 'hi there'), user('now you')];
    const text = handoff(events, { afterSeq: -1, beforeSeq: 3 });
    expect(text).toContain('started before you joined it');
    expect(text).toContain('User: hello\n\nAssistant: hi there');
  });

  it('is nothing when nothing was missed', () => {
    seq = 0;
    const events = [user('hello'), ...reply('a1', 'hi'), user('again')];
    expect(handoff(events, { afterSeq: 2, beforeSeq: 3 })).toBeUndefined();
    expect(handoff([], { afterSeq: -1, beforeSeq: 0 })).toBeUndefined();
  });

  it('keeps the newest lines when the budget runs out, and says how many were left out', () => {
    seq = 0;
    const events: ConversationEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(user(`question ${i} ${'x'.repeat(40)}`));
      events.push(...reply(`a${i}`, `answer ${i}`));
    }
    const text = handoff(events, { afterSeq: -1, beforeSeq: 1000, maxChars: 400 }) ?? '';
    expect(text).toContain('answer 19');
    expect(text).not.toContain('question 0 ');
    expect(text).toMatch(/\[\d+ earlier messages left out\]/);
  });

  it('carries the chat’s summary for what it leaves out, when there is one (ADR 0055)', () => {
    seq = 0;
    const events: ConversationEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(user(`question ${i} ${'x'.repeat(40)}`));
      events.push(...reply(`a${i}`, `answer ${i}`));
    }
    events.push({
      ...base(),
      type: 'context.compacted',
      summary: 'They chose tomatoes.',
      engine: 'openrouter',
      turns: 10,
    });
    const text = handoff(events, { afterSeq: -1, beforeSeq: 1000, maxChars: 400 }) ?? '';
    expect(text).toMatch(/\[\d+ earlier messages left out\. In short, earlier in this chat:\]/);
    expect(text).toContain('They chose tomatoes.');
    // Nothing left out: no summary needed.
    expect(handoff(events, { afterSeq: 37, beforeSeq: 1000 })).not.toContain('tomatoes');
  });
});
