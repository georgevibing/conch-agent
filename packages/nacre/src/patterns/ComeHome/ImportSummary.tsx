import { CircleCheck, House, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Progress } from '../../components/Progress';
import { cx } from '../../utils/cx';
import styles from './ComeHome.module.css';
import { importGroups, type ImportGroupId } from './ImportPreview';

export interface ImportOfferProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** “OpenClaw”. */
  from: string;
  /** What's there: “24 memories, 3 skills, 2 routines and your profile”. */
  summary: ReactNode;
  /** “Brought over 12 things on 3 May”. */
  imported?: ReactNode;
  /** The button: “Take a look”. */
  action?: ReactNode;
}

/**
 * “Bring your things from OpenClaw”: a quiet card where Conch found another
 * agent on this computer. Nothing moves until you look and say so.
 */
export function ImportOffer({
  from,
  summary,
  imported,
  action,
  className,
  ...props
}: ImportOfferProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.offer, className)} {...props}>
      <span className={styles.offerIcon} aria-hidden>
        <House />
      </span>
      <div className={styles.offerText}>
        <p className={styles.offerTitle} id={titleId}>
          Bring your things from {from}
        </p>
        <p className={styles.offerDetail}>{summary}</p>
        {imported && <p className={styles.offerDone}>{imported}</p>}
      </div>
      {action && <div className={styles.offerAction}>{action}</div>}
    </section>
  );
}

export interface ImportProgressProps extends ComponentProps<'div'> {
  done: number;
  total: number;
  /** What's coming over now: “Morning briefing”. */
  current?: ReactNode;
}

/** Bringing things over, one at a time, after a backup. */
export function ImportProgress({ done, total, current, className, ...props }: ImportProgressProps) {
  return (
    <div className={cx(styles.progress, className)} {...props}>
      <Progress
        value={total ? done : null}
        max={Math.max(total, 1)}
        label="Bringing your things over"
        showValue={(v, max) => `${v} of ${max}`}
      />
      <p className={styles.current} aria-live="polite">
        {current}
      </p>
    </div>
  );
}

export interface ImportSummaryProps extends Omit<ComponentProps<'section'>, 'title'> {
  from: string;
  /** How many of each came over. */
  counts: Partial<Record<ImportGroupId, number>>;
  /** What didn't, each with why. */
  failed?: { title: ReactNode; message: ReactNode }[];
  /** What to do next, in a sentence each: “Say hello to @pearl_bot in Telegram to finish.” */
  next?: ReactNode[];
  /** A backup was made first. */
  backedUp?: boolean;
  /** Undo (and anything else). */
  action?: ReactNode;
}

const NOUNS: Record<ImportGroupId, [string, string]> = {
  agents: ['agent', 'agents'],
  persona: ['personality setting', 'personality settings'],
  model: ['model choice', 'model choices'],
  about: ['note about you', 'notes about you'],
  memories: ['memory', 'memories'],
  skills: ['skill, off for now', 'skills, off for now'],
  routines: ['routine, as a draft', 'routines, as drafts'],
  channels: ['chat bot', 'chat bots'],
  keys: ['key', 'keys'],
};

/** What came over, what didn't and why, what's next, and Undo. */
export function ImportSummary({
  from,
  counts,
  failed = [],
  next = [],
  backedUp = false,
  action,
  className,
  ...props
}: ImportSummaryProps) {
  const titleId = useId();
  const rows = (Object.keys(NOUNS) as ImportGroupId[]).filter((g) => (counts[g] ?? 0) > 0);
  const total = rows.reduce((n, g) => n + (counts[g] ?? 0), 0);
  return (
    <section aria-labelledby={titleId} className={cx(styles.summary, className)} {...props}>
      <p className={styles.summaryTitle} id={titleId}>
        {total ? `Your things from ${from} are here` : `Nothing came over from ${from}`}
      </p>
      {rows.length > 0 && (
        <ul className={styles.counts}>
          {rows.map((g) => {
            const n = counts[g] ?? 0;
            return (
              <li key={g}>
                <span className={styles.countIcon} aria-hidden>
                  {importGroups[g].icon}
                </span>
                {n} {NOUNS[g][n === 1 ? 0 : 1]}
              </li>
            );
          })}
        </ul>
      )}
      {next.length > 0 && (
        <ul className={styles.next} aria-label="To finish">
          {next.map((n, i) => (
            <li key={i}>
              <CircleCheck aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && (
        <ul className={styles.failed} aria-label="Didn’t come over">
          {failed.map((f, i) => (
            <li key={i}>
              <TriangleAlert aria-hidden />
              <span>
                <strong>{f.title}</strong> {f.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {backedUp && (
        <p className={styles.backedUp}>
          <ShieldCheck aria-hidden />
          <span>Conch backed itself up first, and {from}’s folder wasn’t changed.</span>
        </p>
      )}
      {action && <div className={styles.summaryAction}>{action}</div>}
    </section>
  );
}
