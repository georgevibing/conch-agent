import { findRanges, foldText, isPastChatId, parseQuery, type PastChatWho } from '@conch/protocol';
import { PastChatsLook, type PastChatView } from '@conch/nacre';
import { useNavigate } from 'react-router';

import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { openPastChat } from '../import/pastChats';
import type { TranscriptItem } from '../../live/reducer';

type Looked = Extract<TranscriptItem, { kind: 'looked' }>;

const WHO: Record<Exclude<PastChatWho, 'assistant'>, string> = {
  you: 'You',
  them: 'Someone else',
  step: 'A step',
};

/**
 * Your assistant looked through your other chats (ADR 0059): the row says
 * what for, and each place it found opens that chat at that line, lit like
 * a search result.
 */
export function PastChatsItem({ item, name }: { item: Looked; name: string }) {
  const navigate = useNavigate();
  const terms = item.query ? parseQuery(item.query) : [];
  const chats: PastChatView[] = item.chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    ...(chat.archived && { archived: true }),
    ...(chat.from && { from: chat.from }),
    ...(chat.lines[0] && { when: relativeTime(chat.lines[0].at) }),
    lines: chat.lines.map((line) => ({
      id: line.message,
      who: line.who === 'assistant' ? name : WHO[line.who],
      text: line.text,
      ranges: terms.length ? findRanges(foldText(line.text), terms) : [],
    })),
  }));
  return (
    <PastChatsLook
      data-anchor={item.id}
      action={item.action}
      query={item.query}
      close={item.close}
      chats={chats}
      onOpen={(chat, line) => {
        // A past chat from another app opens to read, beside this one (ADR 0111).
        if (isPastChatId(chat.id)) return openPastChat(chat.id);
        void navigate(`/c/${encodeURIComponent(chat.id)}`);
        // Lands on the line itself, with what it looked for lit, as a search result does.
        if (line)
          useUi.getState().openFind(chat.id, item.query, `[data-anchor="${CSS.escape(line.id)}"]`);
      }}
    />
  );
}
