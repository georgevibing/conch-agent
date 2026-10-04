import type { ConversationSummary } from '@conch/protocol';
import { ChatSpendChip, SpendLimitCard, SpendNote, toast } from '@conch/nacre';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api/client';
import { keys, useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import type { TranscriptItem } from '../../live/reducer';
import styles from '../chat/Transcript.module.css';

type Choice = 'raise' | 'switch' | 'stop';
const settledBy = { raise: 'raised', switch: 'switched', stop: 'stopped' } as const;

/**
 * A message (or a reply part way) at a spending limit (ADR 0079). It waits
 * here for one tap: raise the limit, carry on with a model that costs less,
 * or stop. The chat carries on by itself once it's chosen.
 */
export function CappedItem({
  item,
  conversationId,
}: {
  item: Extract<TranscriptItem, { kind: 'capped' }>;
  conversationId?: string;
}) {
  /** Chosen here: the card says so at once, until the chat's log does. */
  const [chosen, setChosen] = useState<Choice>();
  const settle = useMutation({
    mutationFn: (choice: Choice) => api.settleCapped(conversationId ?? '', choice),
    onMutate: (choice) => setChosen(choice),
    onError: (error: Error) => {
      setChosen(undefined);
      toast.error(error.message);
    },
  });
  const settled = item.settled ?? (chosen && settledBy[chosen]);
  // Overtaken by a newer message: nothing more to say.
  if (settled === 'moved-on') return null;
  const waiting = !settled && conversationId;
  const { switchTo } = item;
  return (
    <div className={styles.aside}>
      <SpendLimitCard
        limit={item.limit}
        spentUsd={item.spentUsd}
        limitUsd={item.limitUsd}
        raiseTo={item.raiseTo}
        {...(switchTo && {
          switchTo: {
            label: switchTo.label,
            provider: switchTo.provider,
            why: switchTo.why,
            ...(switchTo.allowUsd && { allowUsd: switchTo.allowUsd }),
          },
        })}
        during={item.during}
        state={settled ?? 'offer'}
        busy={settle.isPending}
        onRaise={waiting ? () => settle.mutate('raise') : undefined}
        onSwitch={waiting && switchTo ? () => settle.mutate('switch') : undefined}
        onStop={waiting ? () => settle.mutate('stop') : undefined}
      />
    </div>
  );
}

/** A quiet word about money in the chat (ADR 0079). */
export function SpendNoteItem({ item }: { item: Extract<TranscriptItem, { kind: 'spend-note' }> }) {
  return (
    <div className={styles.aside}>
      <SpendNote data-note={item.note}>{item.message}</SpendNote>
    </div>
  );
}

/**
 * What this chat has spent, beside the model picker (ADR 0079): shown once
 * it has spent money or has a limit, or when ⌘K asks for it. Its tasks are in
 * it. The limit is the person's to set, here, and nowhere the assistant reaches.
 */
export function ChatSpend({ conversationId }: { conversationId?: string }) {
  const client = useQueryClient();
  const { data: conversations } = useConversations();
  const open = useUi((s) => (conversationId ? s.chatSpendOpen === conversationId : false));
  const spend = conversations?.find((c) => c.id === conversationId)?.spend;
  const setLimit = useMutation({
    mutationFn: (capUsd: number | null) => api.setChatSpendLimit(conversationId ?? '', capUsd),
    onSuccess: (summary) => {
      client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
        list?.map((c) => (c.id === summary.id ? summary : c)),
      );
      toast.success(
        summary.spend?.capUsd ? 'This chat has a limit now' : 'This chat has no limit now',
      );
      useUi.setState({ chatSpendOpen: null });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!conversationId) return null;
  const shown = spend ?? { usd: 0 };
  if (!open && !(shown.usd >= 0.005) && !shown.capUsd) return null;
  return (
    <ChatSpendChip
      spend={shown}
      open={open}
      onOpenChange={(next) => useUi.setState({ chatSpendOpen: next ? conversationId : null })}
      busy={setLimit.isPending}
      onSetLimit={(capUsd) => setLimit.mutate(capUsd)}
    />
  );
}
