import { Check, Pause, Play, Timer, X } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import styles from './Recipe.module.css';
import { formatClock, formatDuration, formatSpan, spokenLeft } from './time';
import {
  clearTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  timeLeft,
  useKitchenTimers,
  useNow,
  type KitchenTimer,
} from './timers';

/** The ring round a running timer: the part still to go, emptying as it runs. */
function Ring({ left, total }: { left: number; total: number }) {
  const fraction = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
  return (
    <svg viewBox="0 0 20 20" className={styles.ring} aria-hidden>
      <circle cx="10" cy="10" r="8" className={styles.ringTrack} />
      <circle
        cx="10"
        cy="10"
        r="8"
        pathLength={1}
        className={styles.ringFill}
        style={{ '--rc-left': fraction } as CSSProperties}
      />
    </svg>
  );
}

export interface TimerChipProps {
  /** The timer's own id: `<recipe>:<step>:<n>`. */
  id: string;
  recipe: string;
  step: number;
  /** What it's for: `Step 3`. */
  label: string;
  seconds: number;
  upTo?: number;
  /** The step's own words for it (`20–25 minutes`), shown until it starts. */
  words: string;
  size?: 'md' | 'lg';
  onDone?: (timer: KitchenTimer) => void;
}

/**
 * A length of time in a step's words, as a chip you can tap: it starts a
 * countdown right there, a ring that empties round the time left. Tap again
 * to pause or carry on; × stops it. When it ends it chimes, and says Done
 * until it's tapped away. It keeps running wherever the card goes.
 */
export function TimerChip({
  id,
  recipe,
  step,
  label,
  seconds,
  upTo,
  words,
  size = 'md',
  onDone,
}: TimerChipProps) {
  const timer = useKitchenTimers().find((t) => t.id === id);
  const running = !!timer && timer.endsAt !== null;
  const now = useNow(running);
  const span = formatSpan(seconds, upTo);

  if (!timer) {
    return (
      <button
        type="button"
        className={styles.chip}
        data-state="idle"
        data-size={size}
        aria-label={`${words}: start a ${formatDuration(seconds)} timer`}
        onClick={() => startTimer({ id, recipe, step, label, ms: seconds * 1000 }, onDone)}
      >
        <Timer aria-hidden className={styles.chipIcon} />
        <span className={styles.chipWords}>{words}</span>
        <Play aria-hidden className={styles.chipGo} />
      </button>
    );
  }

  const left = timeLeft(timer, now);
  const state = timer.done ? 'done' : running ? 'running' : 'paused';
  const press = () =>
    state === 'done' ? clearTimer(id) : state === 'running' ? pauseTimer(id) : resumeTimer(id);
  const spoken =
    state === 'done'
      ? `${span} timer done: put it away`
      : state === 'running'
        ? `Pause the ${span} timer, ${spokenLeft(left)}`
        : `Carry on with the ${span} timer, ${spokenLeft(left)}`;
  return (
    <span className={styles.chipGroup} data-size={size}>
      <button
        type="button"
        className={styles.chip}
        data-state={state}
        data-size={size}
        aria-label={spoken}
        onClick={press}
      >
        {state === 'done' ? (
          <Check aria-hidden className={styles.chipIcon} />
        ) : (
          <Ring left={left} total={timer.ms} />
        )}
        <span className={styles.chipClock} aria-hidden>
          {state === 'done' ? 'Done' : formatClock(left)}
        </span>
        {state === 'running' && <Pause aria-hidden className={styles.chipGo} />}
        {state === 'paused' && <Play aria-hidden className={styles.chipGo} />}
      </button>
      {state !== 'done' && (
        <button
          type="button"
          className={styles.chipStop}
          data-size={size}
          aria-label={`Stop the ${span} timer`}
          onClick={() => clearTimer(id)}
        >
          <X aria-hidden />
        </button>
      )}
    </span>
  );
}

export interface TimerTrayProps {
  /** The recipe whose timers to show. */
  recipe: string;
  /** Pressing a timer's name goes to its step (cook mode). */
  onSelect?: (step: number) => void;
  className?: string;
}

/**
 * The recipe's timers that are going, in one row: each its ring, what it's
 * for and the time left, so a timer started three steps ago is never lost.
 * A finished one says so, here and to a screen reader.
 */
export function TimerTray({ recipe, onSelect, className }: TimerTrayProps) {
  const timers = useKitchenTimers().filter((t) => t.recipe === recipe);
  const running = timers.some((t) => t.endsAt !== null);
  const now = useNow(running);
  const done = timers.filter((t) => t.done);
  return (
    <div className={cx(styles.tray, className)} data-empty={timers.length ? undefined : ''}>
      {timers.length > 0 && (
        <ul className={styles.trayList} aria-label="Timers">
          {timers.map((t) => {
            const left = timeLeft(t, now);
            const state = t.done ? 'done' : t.endsAt !== null ? 'running' : 'paused';
            return (
              <li key={t.id} className={styles.trayItem} data-state={state}>
                <button
                  type="button"
                  className={styles.trayMain}
                  aria-label={
                    onSelect
                      ? `${t.label}: ${state === 'done' ? 'done' : spokenLeft(left)}. Go to it`
                      : `${t.label}: ${state === 'done' ? 'done, put it away' : `${state === 'running' ? 'pause' : 'carry on'}, ${spokenLeft(left)}`}`
                  }
                  onClick={() =>
                    onSelect
                      ? onSelect(t.step)
                      : state === 'done'
                        ? clearTimer(t.id)
                        : state === 'running'
                          ? pauseTimer(t.id)
                          : resumeTimer(t.id)
                  }
                >
                  {state === 'done' ? (
                    <Check aria-hidden className={styles.chipIcon} />
                  ) : (
                    <Ring left={left} total={t.ms} />
                  )}
                  <span className={styles.trayLabel}>{t.label}</span>
                  <span className={styles.trayClock}>
                    {state === 'done' ? 'Done' : formatClock(left)}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.chipStop}
                  aria-label={
                    state === 'done' ? `Put away ${t.label}’s timer` : `Stop ${t.label}’s timer`
                  }
                  onClick={() => clearTimer(t.id)}
                >
                  <X aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <span role="status" className="nc-visually-hidden">
        {done.map((t) => `${t.label}: timer done.`).join(' ')}
      </span>
    </div>
  );
}
