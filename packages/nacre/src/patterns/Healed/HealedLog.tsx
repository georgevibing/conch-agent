import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { ago } from './HealedNotes';
import styles from './HealedLog.module.css';

export interface HealedEntry {
  at: number;
  /** A few words: "Stopped a stuck command". */
  message: string;
  /** A small mark for its kind (the browser, a chat, an app); a sparkle if left out. */
  icon?: ReactNode;
}

export interface HealedLogProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** What Conch fixed on its own, newest first. The same words twice are one line, counted. */
  notes: HealedEntry[];
  /** How many lines show before "Show all". */
  limit?: number;
  /** Formats "when"; defaults to a relative time. */
  formatTime?: (at: number) => string;
  /** Now, for counting this week (tests and stories). */
  now?: number;
}

const WEEK = 7 * 86_400_000;

interface Line {
  message: string;
  at: number;
  count: number;
  icon?: ReactNode;
}

/**
 * "Reset part of your settings. A copy is kept." reads as its few words, then
 * what else matters, quieter.
 */
export function splitHealed(message: string): { head: string; detail?: string } {
  const [head = '', ...rest] = message.trim().split(/(?<=[.!?])\s+/);
  const detail = rest.join(' ');
  return { head: head.replace(/\.$/, ''), ...(detail && { detail }) };
}

/**
 * The same repair, again and again, is one line with how often: the same few
 * words, whatever follows them, with the latest one's.
 */
export function collapseHealed(notes: HealedEntry[]): Line[] {
  const lines = new Map<string, Line>();
  for (const note of notes) {
    const key = splitHealed(note.message).head;
    const line = lines.get(key);
    if (!line) lines.set(key, { ...note, count: 1 });
    else {
      line.count += 1;
      if (note.at > line.at) Object.assign(line, { at: note.at, message: note.message });
    }
  }
  return [...lines.values()].sort((a, b) => b.at - a.at);
}

function Message({ text }: { text: string }) {
  const { head, detail } = splitHealed(text);
  return (
    <span className={styles.message}>
      <span className={styles.head}>{head}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
    </span>
  );
}

/**
 * Fixed on its own: what Conch repaired by itself, as reassurance. One line
 * says how much it fixed this week; below it, a short timeline, each repair a
 * few words with its mark, repeats folded into one line with a count. Never a
 * warning: nothing in it needs you.
 */
export function HealedLog({
  notes,
  limit = 5,
  now: nowProp,
  formatTime,
  className,
  ...props
}: HealedLogProps) {
  const listId = useId();
  const [all, setAll] = useState(false);
  const [opened] = useState(() => Date.now());
  const now = nowProp ?? opened;
  const when = formatTime ?? ((at: number) => ago(at, now));
  const lines = collapseHealed(notes);
  const week = notes.filter((n) => now - n.at < WEEK).length;
  const shown = all ? lines : lines.slice(0, limit);

  const title = !notes.length
    ? 'All quiet'
    : week
      ? `Conch fixed ${week === 1 ? 'one thing' : `${week} things`} this week`
      : 'A quiet week';
  const subtitle = !notes.length
    ? 'Nothing has needed fixing.'
    : week
      ? 'Nothing here needs you.'
      : 'Nothing needed fixing in the last 7 days.';

  return (
    <section
      aria-label="Fixed on its own"
      className={cx(styles.log, className)}
      data-empty={!notes.length || undefined}
      {...props}
    >
      <div className={styles.hero}>
        <span className={styles.orb} aria-hidden>
          {notes.length ? <Sparkles /> : <Check />}
        </span>
        <div className={styles.words}>
          <p className={styles.title}>{title}</p>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </div>

      {lines.length > 0 && (
        <ol id={listId} className={styles.lines}>
          {shown.map((line) => (
            <li key={splitHealed(line.message).head} className={styles.line}>
              <span className={styles.mark} aria-hidden>
                {line.icon ?? <Sparkles />}
              </span>
              <Message text={line.message} />
              <span className={styles.meta}>
                {line.count > 1 && (
                  <span className={styles.count}>
                    <span aria-hidden>{line.count}×</span>
                    <span className="nc-visually-hidden">{line.count} times, last</span>
                  </span>
                )}
                <time dateTime={new Date(line.at).toISOString()}>{when(line.at)}</time>
              </span>
            </li>
          ))}
        </ol>
      )}

      {lines.length > limit && (
        <button
          type="button"
          className={styles.more}
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((a) => !a)}
        >
          {all ? 'Show fewer' : `Show all ${lines.length}`}
          <ChevronDown aria-hidden className={styles.chevron} />
        </button>
      )}
    </section>
  );
}
