import type { LearnedItem, MemoryHold } from '@conch/protocol';

import { HeldMemory } from '../memory/HeldMemory';
import { useLearning } from './api';

/** What you answered about one thing a chat learned. */
type Decided = 'undone' | 'kept' | 'dismissed' | 'gone';

/**
 * What this chat taught Conch once it went quiet (ADR 0088, ADR 0097).
 * Routine learning is silent; only a memory the check held for a security
 * reason is said here, as the same card a held memory gets anywhere: what
 * it wanted to remember, why that looks off, and Remember it or Don't. Older
 * chats' logs may list routine things too: those stay quiet now.
 */
export function LearnedChatLine({
  items,
  decided,
}: {
  items: LearnedItem[];
  decided: Record<string, Decided>;
}) {
  const { data } = useLearning();
  const held = items.filter((i) => i.state === 'waiting');
  if (!held.length) return null;
  const entries = new Map((data?.entries ?? []).map((e) => [e.id, e]));
  return (
    <>
      {held.map((item) => {
        const entry = entries.get(item.entryId);
        // Without the record (not loaded yet, or gone), nothing to answer for.
        if (!entry) return null;
        const hold: MemoryHold = entry.after.held ?? {
          verdict: 'ask',
          reasons: [{ code: 'outside', words: item.waits ?? 'Conch wasn’t sure about this one.' }],
        };
        const said = decided[item.entryId];
        const settled =
          entry.state === 'kept' || said === 'kept'
            ? 'kept'
            : entry.state !== 'waiting' || said
              ? 'undone'
              : undefined;
        return (
          <HeldMemory
            key={item.entryId}
            memoryId={entry.after.id}
            content={entry.after.content}
            held={hold}
            {...(settled && { decided: settled })}
          />
        );
      })}
    </>
  );
}
