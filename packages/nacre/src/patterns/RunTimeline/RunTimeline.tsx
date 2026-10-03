import { ChevronRight, ExternalLink, History } from 'lucide-react';
import { useState, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { RunStatusBadge, runStatusMeta } from '../Routines/RunStatusBadge';
import { formatDate, formatRunDuration, formatTime } from '../Routines/time';
import type { RunStatusValue, RunTrigger } from '../Routines/types';
import styles from './RunTimeline.module.css';

export interface RunTimelineItem {
  id: string;
  status: RunStatusValue;
  /** When the run started (or was due, for missed/skipped runs). */
  at: number;
  trigger: RunTrigger;
  outcome?: string;
  error?: string;
  durationMs?: number;
  /** What it cost, in a few words: “$0.04”, “4% of your plan”, “Free”. */
  cost?: string;
  /** What started it, for a routine that starts when something happens (ADR 0056). */
  event?: { label: string; link?: string };
}

export interface RunTimelineProps extends Omit<ComponentProps<'div'>, 'children'> {
  runs: RunTimelineItem[];
  /** Open a run (its conversation). Rows are only interactive when provided. */
  onOpen?: (id: string) => void;
  emptyText?: string;
  now?: number;
  timeZone?: string;
}

const triggerNotes: Partial<Record<RunTrigger, string>> = {
  manual: 'Run by you',
  'catch-up': 'Caught up after Conch was off',
  event: 'Something happened',
};

function dayKey(ts: number, timeZone?: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ts);
}

function dayLabel(ts: number, now: number, timeZone?: string) {
  const key = dayKey(ts, timeZone);
  if (key === dayKey(now, timeZone)) return 'Today';
  if (key === dayKey(now - 86_400_000, timeZone)) return 'Yesterday';
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone }).format(ts);
  return `${weekday}, ${formatDate(ts, { now, timeZone })}`;
}

/** Friendly words for a run, preferring what the agent reported. */
function runText(run: RunTimelineItem): string {
  if (run.outcome) return run.outcome;
  if (run.status === 'failed' && run.error) return run.error;
  return runStatusMeta[run.status].description;
}

/** A routine's history, newest first, grouped by day. */
export function RunTimeline({
  runs,
  onOpen,
  emptyText = 'No runs yet. The first one will appear here.',
  now: nowProp,
  timeZone,
  className,
  ...props
}: RunTimelineProps) {
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  if (runs.length === 0) {
    return (
      <div className={cx(styles.empty, className)} {...props}>
        <History aria-hidden />
        <p>{emptyText}</p>
      </div>
    );
  }

  const sorted = [...runs].sort((a, b) => b.at - a.at);
  const groups: { label: string; runs: RunTimelineItem[] }[] = [];
  for (const run of sorted) {
    const label = dayLabel(run.at, now, timeZone);
    const last = groups.at(-1);
    if (last?.label === label) last.runs.push(run);
    else groups.push({ label, runs: [run] });
  }

  return (
    <div className={cx(styles.timeline, className)} {...props}>
      {groups.map((group) => (
        <section key={group.label} className={styles.group} aria-label={group.label}>
          <h4 className={styles.day}>{group.label}</h4>
          <ol className={styles.list}>
            {group.runs.map((run) => {
              const note =
                run.trigger === 'event' && run.event
                  ? `After ${run.event.label}`
                  : triggerNotes[run.trigger];
              const body = (
                <>
                  <span className={styles.time}>{formatTime(run.at, { timeZone })}</span>
                  <span className={styles.rail} aria-hidden data-status={run.status} />
                  <span className={styles.main}>
                    <span className={styles.top}>
                      <RunStatusBadge status={run.status} />
                      {note && <span className={styles.note}>{note}</span>}
                      {run.durationMs !== undefined && run.status !== 'running' && (
                        <span className={styles.note}>{formatRunDuration(run.durationMs)}</span>
                      )}
                      {run.cost && <span className={styles.note}>{run.cost}</span>}
                    </span>
                    <span className={styles.outcome} data-status={run.status}>
                      {runText(run)}
                    </span>
                  </span>
                  {onOpen && <ChevronRight aria-hidden className={styles.chevron} />}
                </>
              );
              return (
                <li key={run.id} className={styles.item}>
                  {onOpen ? (
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => onOpen(run.id)}
                      aria-label={`${runStatusMeta[run.status].label} at ${formatTime(run.at, { timeZone })}: ${runText(run)}${run.cost ? ` (${run.cost})` : ''}. Open this run.`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className={styles.row}>{body}</div>
                  )}
                  {run.event?.link && (
                    <a
                      className={styles.eventLink}
                      href={run.event.link}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open {run.event.label}
                      <ExternalLink aria-hidden />
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
