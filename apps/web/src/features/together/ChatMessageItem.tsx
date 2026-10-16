import type { ChatInbound } from '@conch/protocol';
import { ChatMessageCard, toast } from '@conch/nacre';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { useConversations } from '../../api/queries';
import type { TranscriptItem } from '../../live/reducer';
import { togetherApi } from './api';

type ChatMessage = Extract<TranscriptItem, { kind: 'chat-message' }>;

const failed = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : 'That didn’t go through. Try again.');

/**
 * A message between two of your chats (ADR 0134), as this chat's card: the
 * other chat opens from its name, a held one passes on or is dismissed by your
 * press, and a card that came here chooses whether this chat takes them.
 */
export function ChatMessageItem({
  item,
  conversationId,
}: {
  item: ChatMessage;
  conversationId?: string;
}) {
  const navigate = useNavigate();
  const { message } = item;
  const here = useConversations().data?.find((c) => c.id === conversationId);
  const act = (action: 'pass' | 'dismiss') => {
    if (!conversationId) return;
    togetherApi.act(conversationId, message.messageId, action).catch(failed);
  };
  const choose = (inbound: ChatInbound) => {
    if (!conversationId) return;
    api
      .changeConversation(conversationId, { inbound })
      .then(() =>
        toast.success(
          inbound === 'accept'
            ? 'Your other chats can message this one'
            : inbound === 'hold'
              ? 'Messages from your other chats wait here for you'
              : 'Messages from your other chats are turned away',
        ),
      )
      .catch(failed);
  };
  const incoming = message.direction === 'in' && conversationId;
  return (
    <ChatMessageCard
      data-anchor={item.id}
      direction={message.direction}
      kind={message.kind}
      chatTitle={message.chat.title}
      text={message.text}
      state={message.state}
      {...(message.wakes && { wakes: true })}
      {...(message.why && { why: message.why })}
      onOpenChat={() => void navigate(`/c/${encodeURIComponent(message.chat.id)}`)}
      {...(incoming &&
        message.state === 'held' && { onPass: () => act('pass'), onDismiss: () => act('dismiss') })}
      {...(incoming && { inbound: here?.inbound ?? 'accept', onInboundChange: choose })}
    />
  );
}
