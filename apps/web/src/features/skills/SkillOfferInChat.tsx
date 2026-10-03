import { SkillOffer } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { ConversationView } from '../../live/reducer';
import { useWorkSuggestions } from './queries';
import { dismissSuggestion, draftFrom } from './SkillSuggestions';

/** The offer this chat earned, while it still belongs under the last reply. */
export function useChatOffer(conversationId: string | undefined, view: ConversationView) {
  const { data } = useWorkSuggestions();
  if (!conversationId) return undefined;
  const offer = data?.suggestions.find(
    (s) => s.from === 'work' && s.chat?.conversationId === conversationId,
  );
  if (!offer?.chat) return undefined;
  const { endedAt } = offer.chat;
  // You've moved on in this chat: it waits on the Skills page instead.
  if (view.items.some((i) => i.kind === 'user' && i.at > endedAt)) return undefined;
  return offer;
}

/**
 * Save how I did this (ADR 0058), in the chat: one quiet line under the
 * reply that earned it, once the turn is over. Not now puts it away; the
 * Skills page keeps it until then.
 */
export function SkillOfferInChat({
  conversationId,
  view,
  running,
  className,
}: {
  conversationId: string | undefined;
  view: ConversationView;
  running: boolean;
  className?: string;
}) {
  const offer = useChatOffer(conversationId, view);
  const navigate = useNavigate();
  const client = useQueryClient();
  // Never while an answer is being written.
  if (!offer || running) return null;
  return (
    <SkillOffer
      className={className}
      {...(offer.steps !== undefined && { steps: offer.steps })}
      {...(offer.untrusted && { untrusted: offer.untrusted })}
      onSave={() => void navigate('/skills/new', { state: draftFrom(offer) })}
      onDismiss={() => void dismissSuggestion(client, offer.id, false)}
    />
  );
}
