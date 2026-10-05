import type { LearnedItem } from '@conch/protocol';
import { LearnedLine, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { keys } from '../../api/queries';
import { learningApi, learningKeys, useLearning } from './api';
import { thingFromChat } from './things';

/** What you answered about one thing a chat learned. */
type Decided = 'undone' | 'kept' | 'dismissed' | 'gone';

/**
 * What this chat taught Conch once it went quiet (ADR 0088): one folded line
 * at its end, with Undo and Why?, and Keep and Forget on what waits. What
 * you press shows at once; the chat's own log says it after a reload.
 */
export function LearnedChatLine({
  items,
  decided,
}: {
  items: LearnedItem[];
  decided: Record<string, Decided>;
}) {
  const client = useQueryClient();
  const { data } = useLearning();
  const [busy, setBusy] = useState<string>();
  const [pressed, setPressed] = useState<Record<string, Decided>>({});
  const entries = new Map((data?.entries ?? []).map((e) => [e.id, e]));
  const answer = async (id: string, kind: 'keep' | 'undo' | 'dismiss') => {
    setBusy(id);
    try {
      // The words you saw: a Keep is your answer for exactly those (ADR 0087).
      const seen = items.find((i) => i.entryId === id)?.text;
      const entry = await learningApi.answer(id, kind, seen);
      setPressed((p) => ({ ...p, [id]: entry.state as Decided }));
      void client.invalidateQueries({ queryKey: learningKeys.all });
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <LearnedLine
      items={items.map((item) => {
        const entry = entries.get(item.entryId);
        const was = pressed[item.entryId];
        const said = decided[item.entryId];
        return thingFromChat(item, {
          ...(was && { pressed: was }),
          ...(said && { decided: said }),
          ...(entry && { entry }),
        });
      })}
      onUndo={(id) => void answer(id, 'undo')}
      onKeep={(id) => void answer(id, 'keep')}
      onForget={(id) => void answer(id, 'dismiss')}
      {...(busy && { busy })}
    />
  );
}
