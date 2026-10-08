import { MorningDigest, useNow } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { keys } from '../../api/queries';
import { learningApi, learningKeys, useLearning } from '../learning/api';
import { memoryApi } from './api';
import { morningDigest, readSeen, writeSeen, type DigestEntry } from './digest';
import styles from './MorningNote.module.css';
import { memoryKeys, useTidy } from './queries';

/**
 * The morning's note (ADR 0107): what Conch learned and tidied since you last
 * looked, each with Undo, until you put it away. `home`: on the new chat's
 * screen, only in the morning and in three lines.
 */
export function MorningNote({ home = false }: { home?: boolean }) {
  const { data: learning } = useLearning();
  const { data: tidy } = useTidy();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [seenAt, setSeenAt] = useState(readSeen);
  const [busy, setBusy] = useState<string>();
  const now = useNow(60_000);
  const hour = new Date(now).getHours();
  if (home && (hour < 5 || hour >= 12)) return null;
  const digest = morningDigest({
    ...(learning && { learning }),
    ...(tidy && { tidy }),
    seenAt,
    now,
    hour,
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
      max={home ? 3 : 5}
      {...(home && { className: styles.home })}
      {...(busy && { busy })}
      onUndo={(id) => {
        const item = digest.items.find((i) => i.id === id);
        if (item) void undo(item);
      }}
      onDismiss={() => {
        writeSeen(now);
        setSeenAt(now);
      }}
      {...(home && { onOpen: () => void navigate('/memory') })}
    />
  );
}
