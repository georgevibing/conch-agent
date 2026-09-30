import { Sparkles } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './HealedNotes.module.css';

export interface HealedNote {
  at: number;
  message: string;
}

export interface HealedNotesProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** What Conch fixed on its own, newest first. */
  notes: HealedNote[];
  /** How many to show; the rest are older and matter less. */
  limit?: number;
  /** Formats "when"; defaults to a relative time. */
  formatTime?: (at: number) => string;
  /** Hides the "Fixed on its own" heading when a surrounding section already says it. */
  bare?: boolean;
}

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * What Conch repaired by itself, as reassurance: a quiet list with a sparkle,
 * never a warning. Renders nothing when there's nothing to say.
 */
export function HealedNotes({
  notes,
  limit = 4,
  formatTime = (at) => ago(at),
  bare = false,
  className,
  ...props
}: HealedNotesProps) {
  if (!notes.length) return null;
  return (
    <section
      aria-label={bare ? undefined : 'Fixed on its own'}
      className={cx(styles.healed, className)}
      {...props}
    >
      {!bare && (
        <p className={styles.title} aria-hidden>
          <Sparkles /> Fixed on its own
        </p>
      )}
      <ul>
        {notes.slice(0, limit).map((note) => (
          <li key={`${note.at}-${note.message}`}>
            <span>{note.message}</span>
            <time dateTime={new Date(note.at).toISOString()}>{formatTime(note.at)}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
