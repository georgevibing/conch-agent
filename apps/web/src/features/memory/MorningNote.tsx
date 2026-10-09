import { MorningDigest, useNow } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { keys } from '../../api/queries';
import { learningApi, learningKeys, useLearning } from '../learning/api';
import { memoryApi } from './api';
import { morningDigest, readSeen, writeSeen, type DigestEntry } from './digest';
import { useMemoryHeadlines } from './headlines';
import { memoryKeys, useTidy } from './queries';

/**
 * The morning's note (ADR 0107): what Conch learned and tidied since you last
 * looked, each with Undo, until you put it away. Only here, atop Settings →
 * Memory: never on the new chat's screen or in a chat (ADR 0107).
 */
export function MorningNote() {
  const { data: learning } = useLearning();
  const { data: tidy } = useTidy();
  const headlines = useMemoryHeadlines();
  const client = useQueryClient();
  const [seenAt, setSeenAt] = useState(readSeen);
  const [busy, setBusy] = useState<string>();
  const now = useNow(60_000);
  const hour = new Date(now).getHours();
  const digest = morningDigest({
    ...(learning && { learning }),
    ...(tidy && { tidy }),
    seenAt,
    now,
    hour,
    headlines,
  });
  if (!digest) return null;

  const undo = async (item: DigestEntry) => {
    setBusy(item.id);
    try {
      if (item.undo.from === 'learning') await learningApi.answer(item.undo.entryId, 'undo');
      else await memoryApi.answer(item.undo.runId, item.undo.changeId, 'undo');
    } finally {
      await Promise.all([
        client.invalidateQueries({ queryKey: learningKeys.all }),
        client.invalidateQueries({ queryKey: memoryKeys.tidy }),
        client.invalidateQueries({ queryKey: keys.memories }),
      ]);
      setBusy(undefined);
    }
  };

  return (
    <MorningDigest
      title={digest.title}
      items={digest.items}
      {...(busy && { busy })}
      onUndo={(id) => {
        const item = digest.items.find((i) => i.id === id);
        if (item) void undo(item);
      }}
      onDismiss={() => {
        writeSeen(now);
        setSeenAt(now);
      }}
    />
  );
}
