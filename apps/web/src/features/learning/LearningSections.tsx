import type { LearnedEntry as Entry } from '@conch/protocol';
import {
  Button,
  Heading,
  LearnedEntry,
  LearningTimeline,
  MemoryItem,
  MemoryList,
  NeverList,
  Skeleton,
  Text,
  toast,
  WeeklyRecap,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import styles from '../memory/Memory.module.css';
import { learningApi, learningKeys, useLearning } from './api';
import { thingOf } from './things';

/** `memoryIntent` values that bring a section into view (⌘K). */
export const LEARNED_INTENT = 'learned';
export const NEVER_INTENT = 'never';

/** A page of the record at a time. */
const PAGE = 10;

/** "From “Rename photos” · 2 days ago" — where and when. */
function metaOf(entry: Entry): string {
  const chat = entry.from.chatTitle ? `“${entry.from.chatTitle}”` : 'a chat';
  const how = entry.from.trigger === 'tool' ? `Remembered in ${chat}` : `From ${chat}`;
  return `${how} · ${relativeTime(entry.at)}`;
}

/** "Until August 2026". */
function until(at: number): string {
  return `Until ${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(at)}`;
}

/** Keep, Undo and Forget on the record, with the page fetched again after. */
function useAnswer() {
  const client = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const answer = async (id: string, kind: 'keep' | 'undo' | 'dismiss') => {
    setBusy(id);
    try {
      await learningApi.answer(id, kind);
      void client.invalidateQueries({ queryKey: learningKeys.all });
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return { busy, answer };
}

/**
 * Recent learnings (ADR 0088): the week at a glance, then everything Conch
 * learned by itself, newest first — each with Undo and Why?, and Keep and
 * Forget on what waits.
 */
export function LearnedSection() {
  const learning = useLearning();
  const client = useQueryClient();
  const navigate = useNavigate();
  const intent = useUi((s) => s.memoryIntent);
  const setIntent = useUi((s) => s.setMemoryIntent);
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(PAGE);
  const { busy, answer } = useAnswer();
  const status = learning.data;

  // ⌘K → What Conch learned: here.
  useEffect(() => {
    if (intent !== LEARNED_INTENT || !status) return;
    setIntent(null);
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [intent, status, setIntent]);

  const open = (id: string) => void navigate(`/c/${encodeURIComponent(id)}`);
  const seen = async () => {
    try {
      await learningApi.seeRecap();
      void client.invalidateQueries({ queryKey: learningKeys.all });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const entries = status?.entries ?? [];
  return (
    <section ref={ref} className={styles.section} aria-labelledby="memory-learned">
      <Heading level={2} size="lg" id="memory-learned">
        Recent learnings
      </Heading>
      <Text size="sm" tone="muted">
        {status?.on === false
          ? 'Learning from your chats is off, so Conch only remembers what you ask it to.'
          : 'Once a chat goes quiet, Conch keeps what will still matter: how you like things, what changed, what this computer needs. Undo puts anything back, and it won’t be learned again.'}
      </Text>
      {status?.recap && (
        <WeeklyRecap
          count={status.recap.count}
          items={status.recap.items}
          onDismiss={() => void seen()}
        />
      )}
      {learning.isPending ? (
        <Skeleton shape="block" height="5rem" />
      ) : entries.length === 0 ? (
        <Text size="sm" tone="muted">
          Nothing learned yet. Correct Conch in a chat, or tell it something that lasts, and it
          shows up here.
        </Text>
      ) : (
        <>
          <LearningTimeline>
            {entries.slice(0, shown).map((entry) => (
              <LearnedEntry
                key={entry.id}
                thing={thingOf(entry, open)}
                meta={metaOf(entry)}
                onUndo={(id) => void answer(id, 'undo')}
                onKeep={(id) => void answer(id, 'keep')}
                onForget={(id) => void answer(id, 'dismiss')}
                {...(busy && { busy })}
              />
            ))}
          </LearningTimeline>
          {entries.length > shown && (
            <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
              Show more
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** Earlier (ADR 0088): what used to be true, with when it stopped. Undo on what replaced it brings it back. */
export function EarlierSection() {
  const { data } = useLearning();
  const past = data?.past ?? [];
  if (!past.length) return null;
  return (
    <section className={styles.section} aria-labelledby="memory-earlier">
      <Heading level={2} size="lg" id="memory-earlier">
        Earlier
      </Heading>
      <Text size="sm" tone="muted">
        What used to be true. It’s no longer in your chats, but Conch can still answer questions
        about before.
      </Text>
      <MemoryList aria-label="What used to be true">
        {past.map((m) => (
          <MemoryItem key={m.id} source={m.source} time={until(m.invalidAt ?? m.updatedAt)}>
            {m.content}
          </MemoryItem>
        ))}
      </MemoryList>
    </section>
  );
}

/** Things Conch won't learn again (ADR 0088): each you took back once, with Remove. */
export function NeverSection() {
  const { data } = useLearning();
  const client = useQueryClient();
  const intent = useUi((s) => s.memoryIntent);
  const setIntent = useUi((s) => s.setMemoryIntent);
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<string>();
  const never = data?.never ?? [];

  useEffect(() => {
    if (intent !== NEVER_INTENT || !data) return;
    setIntent(null);
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [intent, data, setIntent]);

  if (!never.length && intent !== NEVER_INTENT) return null;
  const remove = async (id: string) => {
    setBusy(id);
    try {
      await learningApi.removeNever(id);
      void client.invalidateQueries({ queryKey: learningKeys.all });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section ref={ref} className={styles.section} aria-labelledby="memory-never">
      <Heading level={2} size="lg" id="memory-never">
        Things Conch won’t learn again
      </Heading>
      <Text size="sm" tone="muted">
        {never.length
          ? 'You took these back. Remove one and Conch may learn it again.'
          : 'Nothing here. What you undo or forget from what Conch learned shows up here.'}
      </Text>
      {never.length > 0 && (
        <NeverList
          items={never.map((n) => ({
            id: n.id,
            text: n.text,
            when: `Taken back ${relativeTime(n.at)}`,
          }))}
          onRemove={(id) => void remove(id)}
          {...(busy && { busy })}
        />
      )}
    </section>
  );
}
