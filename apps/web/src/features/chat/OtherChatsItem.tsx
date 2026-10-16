import { otherChatWords } from '@conch/protocol';
import { OtherChatsLook, type OtherChatView } from '@conch/nacre';
import { useNavigate } from 'react-router';

import type { TranscriptItem } from '../../live/reducer';

type Listed = Extract<TranscriptItem, { kind: 'listed' }>;

/**
 * Your assistant checked on your other chats (ADR 0134): the row says how
 * many are busy, and each chat opens where it is.
 */
export function OtherChatsItem({ item }: { item: Listed }) {
  const navigate = useNavigate();
  const chats: OtherChatView[] = item.chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    state: chat.state,
    words: otherChatWords(chat),
    ...(chat.sameFolder && { sameFolder: true }),
    ...(chat.from && { from: chat.from }),
  }));
  return (
    <OtherChatsLook
      data-anchor={item.id}
      chats={chats}
      onOpen={(chat) => void navigate(`/c/${encodeURIComponent(chat.id)}`)}
    />
  );
}
