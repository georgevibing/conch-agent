import { AwayDigest, type AwayDigestItem } from '@conch/nacre';
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './Transcript.module.css';

/** What a chat had finished when its reader left: by story, and when. */
interface Left {
  done: ReadonlySet<string>;
  at: number;
}

/**
 * Chats left while they worked (another chat opened, a page away), by id:
 * kept here, outside any one transcript, so coming back can say what happened.
 */
const left = new Map<string, Left>();

/** At least this many stories finished while away before the chat says so. */
const WORTH_SAYING = 2;

export interface AwayStory extends AwayDigestItem {
  /** Still going, or over. */
  finished: boolean;
}

export interface Away {
  items: AwayDigestItem[];
  durationMs: number;
}

/**
 * "While you were away" (ADR 0103): when the tab is hidden, or another chat
 * is open, while this one works, it notes what had finished; back here, if
 * two or more stories finished meanwhile, it says which. `stories` are the
 * chat's, in order, with the words their lines show.
 */
export function useAway({
  conversationId,
  stories,
  running,
  ready,
}: {
  conversationId: string | undefined;
  stories: readonly AwayStory[];
  running: boolean;
  /** The chat's log is all here: only then can it tell what's new. */
  ready: boolean;
}): { away: Away | undefined; dismiss: () => void } {
  // Said for one chat: a different chat in the same place starts with nothing to say.
  const [said, setAway] = useState<{ chat: string; away: Away }>();
  const away = said && said.chat === conversationId ? said.away : undefined;
  const latest = useRef({ stories, running });
  useEffect(() => {
    latest.current = { stories, running };
  });

  const note = useCallback(() => {
    if (!conversationId) return;
    const done = new Set(latest.current.stories.filter((s) => s.finished).map((s) => s.id));
    left.set(conversationId, { done, at: Date.now() });
  }, [conversationId]);

  const back = useCallback(() => {
    if (!conversationId) return;
    const was = left.get(conversationId);
    if (!was) return;
    left.delete(conversationId);
    const since = latest.current.stories.filter((s) => s.finished && !was.done.has(s.id));
    if (since.length < WORTH_SAYING) return;
    setAway({
      chat: conversationId,
      away: {
        items: since.map(({ finished: _, ...item }) => item),
        durationMs: Date.now() - was.at,
      },
    });
  }, [conversationId]);

  // The tab hidden and shown again.
  useEffect(() => {
    const onChange = () => (document.visibilityState === 'hidden' ? note() : back());
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [note, back]);

  // Another chat opened while this one worked: noted as this one goes.
  useEffect(
    () => () => {
      if (latest.current.running) note();
    },
    [note],
  );

  // Back to this chat once its log is here.
  useEffect(() => {
    if (ready && document.visibilityState !== 'hidden') back();
  }, [ready, back]);

  return { away, dismiss: useCallback(() => setAway(undefined), []) };
}

/** Distance from the bottom (px) that counts as being there. */
const AT_BOTTOM = 48;

function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let at = el?.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return null;
}

/**
 * The digest, floating at the top of the chat: a line per story, each a
 * jump to it. It goes when you jump, dismiss it, send something, or read
 * down to the newest message from further up.
 */
export function AwayCard({
  away,
  column,
  onJump,
  onDismiss,
}: {
  away: Away;
  column: HTMLElement | null;
  onJump: (storyId: string) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const el = scroller(column);
    if (!el) return;
    const distance = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    // Only reading down from above counts: someone already at the bottom keeps it.
    let above = distance() > AT_BOTTOM;
    const onScroll = () => {
      if (distance() > AT_BOTTOM) above = true;
      else if (above) onDismiss();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [column, onDismiss]);
  return (
    <div className={styles.away}>
      <AwayDigest
        items={away.items}
        durationMs={away.durationMs}
        onJump={onJump}
        onDismiss={onDismiss}
        className={styles.awayCard}
      />
    </div>
  );
}
