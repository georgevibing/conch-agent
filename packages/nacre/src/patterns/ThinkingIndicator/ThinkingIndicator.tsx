import {
  useEffect,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import { useSmoothText } from '../StreamingText/useSmoothText';
import styles from './ThinkingIndicator.module.css';

export interface ThinkingIndicatorProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** A fixed label, e.g. "Reading 3 files". Ignored when `verbs` are given. */
  label?: ReactNode;
  /**
   * Words for what's happening, e.g. `['Listening', 'Untangling it', 'Connecting the dots']`.
   * The first opens briefly; the rest take turns, each morphing in letter by letter.
   */
  verbs?: readonly string[];
  /** Milliseconds each verb stays before the next one takes over. */
  interval?: number;
  /** A live glimpse of the model's reasoning: the newest words drift in at the end of a faded line. */
  trail?: string;
  /** Optional secondary detail shown after the label. */
  detail?: ReactNode;
  /** Epoch ms when work started — a quiet elapsed timer fades in after a few seconds. */
  startedAt?: number;
  size?: 'sm' | 'md';
  /** Show the swirling pearl. Turn off when something nearby (the message mark) already moves. */
  orb?: boolean;
  /** What assistive tech hears; stays stable while the verbs change. */
  srLabel?: string;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/** How long the opening verb stays: it's a greeting, not a status, so it hands over sooner. */
const OPENING_MS = 1500;

/**
 * Which verb shows `elapsed` ms into the wait. The first verb opens once; the
 * rest take turns. Derived from the clock (not a counter) so a remounted
 * indicator carries on exactly where the last one was.
 */
export function verbAt(elapsed: number, count: number, interval: number) {
  const first = Math.min(interval, OPENING_MS);
  if (count < 2 || elapsed < first) return { index: 0, since: elapsed, next: first - elapsed };
  const t = elapsed - first;
  const since = t % interval;
  return { index: 1 + (Math.floor(t / interval) % (count - 1)), since, next: interval - since };
}

function useVerb(verbs: readonly string[] | undefined, interval: number, origin?: number) {
  const count = verbs?.length ?? 0;
  const [state, setState] = useState(() => {
    const now = Date.now();
    const at = verbAt(now - (origin ?? now), count, interval);
    // Mounted part-way through a verb (e.g. replacing a placeholder): its letters
    // carry on from where they were (`since`), never replaying their entrance.
    return {
      now,
      start: origin ?? now,
      leaving: undefined as string | undefined,
      mountedOn: at.index as number | undefined,
      since: at.since,
    };
  });
  const at = verbAt(state.now - state.start, count, interval);
  const current = verbs?.[at.index];
  useEffect(() => {
    if (count < 2) return;
    const id = setTimeout(
      () => setState((s) => ({ ...s, now: Date.now(), leaving: current, mountedOn: undefined })),
      at.next + 16,
    );
    return () => clearTimeout(id);
  }, [at.next, count, current]);
  useEffect(() => {
    if (!state.leaving) return;
    const id = setTimeout(() => setState((s) => ({ ...s, leaving: undefined })), 520);
    return () => clearTimeout(id);
  }, [state.leaving]);
  return {
    current,
    leaving: state.leaving === current ? undefined : state.leaving,
    since: at.index === state.mountedOn ? state.since : 0,
  };
}

function Letters({
  text,
  leaving,
  since = 0,
}: {
  text: string;
  leaving?: boolean;
  /** Milliseconds this word has already been showing (mounted part-way through it). */
  since?: number;
}) {
  // Fixed at mount: a re-render never shifts the running animations.
  const [offset] = useState(since);
  return (
    <span
      className={styles.word}
      data-leaving={leaving || undefined}
      style={offset ? ({ '--since': `${Math.round(offset)}ms` } as CSSProperties) : undefined}
    >
      {[...text].map((ch, i) => (
        <span key={i} className={styles.ch} style={{ '--i': i } as CSSProperties}>
          {ch}
        </span>
      ))}
    </span>
  );
}

const TRAIL_CHARS = 180;

function Trail({ text }: { text: string }) {
  const flat = text.replace(/\s+/g, ' ');
  const smooth = useSmoothText(flat, { streaming: true });
  const shown = smooth.text;
  let start = Math.max(0, shown.length - TRAIL_CHARS);
  if (start > 0) start = shown.indexOf(' ', start) + 1 || start;
  const freshFrom = Math.max(start, smooth.freshFrom ?? shown.length);
  const fresh = [...shown.slice(freshFrom).matchAll(/\S+\s*/g)];
  return (
    <div className={styles.trail} data-overflow={shown.length > 64 || undefined} aria-hidden>
      <span className={styles.trailText}>
        {shown.slice(start, freshFrom)}
        {fresh.map((m) => (
          <span key={freshFrom + m.index} data-nc-fresh="">
            {m[0]}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * The anticipation before an answer. Verbs describe what's happening and take
 * turns, each one surfacing letter by letter while a slow tide of colour
 * washes across it; three tiny bubbles rise beside it; and, when the model is
 * reasoning, the newest words of that reasoning drift past underneath — so the
 * wait shows real progress rather than a spinner. A polite live region.
 */
export function ThinkingIndicator({
  label = 'Thinking',
  verbs,
  interval = 3200,
  trail,
  detail,
  startedAt,
  size = 'md',
  orb = true,
  srLabel,
  className,
  style,
  ...props
}: ThinkingIndicatorProps) {
  const now = useNow(startedAt !== undefined);
  const { current, leaving, since } = useVerb(verbs, interval, startedAt);
  // How long the wait has gone on when this mounts: the bubbles and the orb keep
  // that time, so an indicator that replaces another carries on instead of starting over.
  const [age] = useState(() => (startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt)));
  const elapsed = startedAt === undefined ? undefined : now - startedAt;
  const cycling = current !== undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      data-size={size}
      className={cx(styles.root, className)}
      style={{ '--age': `${Math.round(age)}ms`, ...style } as CSSProperties}
      {...props}
    >
      {cycling && <span className="nc-visually-hidden">{srLabel ?? 'Thinking'}</span>}
      <div className={styles.line}>
        {orb && (
          <span className={styles.orb} aria-hidden>
            <span className={styles.core} />
          </span>
        )}
        {cycling ? (
          <span className={styles.label} aria-hidden>
            {leaving && <Letters key={`out-${leaving}`} text={leaving} leaving />}
            <Letters key={current} text={current} since={since} />
          </span>
        ) : (
          <span className={styles.label}>
            {typeof label === 'string' ? <Letters text={label} /> : label}
          </span>
        )}
        <span className={styles.bubbles} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {detail != null && <span className={styles.detail}>{detail}</span>}
        {elapsed !== undefined && elapsed >= 3000 && (
          <span className={styles.elapsed} aria-hidden>
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
      {trail && <Trail text={trail} />}
    </div>
  );
}
