import { describe, expect, it } from 'vitest';

import { ConversationEvent } from './index';
import { readPastChatRead, readPastChatsFound } from './past-chats';

describe('looking through earlier chats', () => {
  it('reads what the tools answer, and nothing else', () => {
    const found = {
      query: 'venue',
      match: 'exact',
      chats: [
        {
          chat: 'c1',
          title: 'Wedding',
          lastActive: '2026-10-01T10:00:00.000Z',
          matches: 1,
          lines: [{ message: 'u1', who: 'you', when: '2026-10-01T10:00:00.000Z', text: 'venue' }],
        },
      ],
    };
    expect(readPastChatsFound(JSON.stringify(found))?.chats[0]?.chat).toBe('c1');
    expect(readPastChatsFound('Someone other than the user writes in this chat.')).toBeUndefined();
    expect(readPastChatsFound(undefined)).toBeUndefined();
    expect(readPastChatRead(JSON.stringify(found))).toBeUndefined();
    expect(
      readPastChatRead(
        JSON.stringify({ ...found.chats[0], earlier: false, later: true, matches: undefined }),
      )?.later,
    ).toBe(true);
  });

  it('logs what it looked for as an event of the chat', () => {
    const event = ConversationEvent.parse({
      conversationId: 'c2',
      seq: 3,
      at: 1,
      type: 'chats.looked',
      lookId: 'look_1',
      action: 'search',
      query: 'venue',
      chats: [
        {
          id: 'c1',
          title: 'Wedding',
          archived: true,
          lines: [{ message: 'u1', who: 'them', at: 1, text: 'the venue' }],
        },
      ],
    });
    expect(event.type).toBe('chats.looked');
    expect(() =>
      ConversationEvent.parse({
        conversationId: 'c2',
        seq: 3,
        at: 1,
        type: 'chats.looked',
        lookId: 'look_1',
        action: 'delete',
        chats: [],
      }),
    ).toThrow();
  });
});
