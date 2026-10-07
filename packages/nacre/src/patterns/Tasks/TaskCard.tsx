import {
  Check,
  CircleAlert,
  Clock,
  GitBranch,
  Hand,
  Layers,
  MessageSquare,
  RotateCcw,
  ShieldQuestion,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './Tasks.module.css';

export type TaskCardStatus =
  'queued' | 'running' | 'needs-you' | 'done' | 'unverified' | 'failed' | 'stopped' | 'interrupted';

/**
 * What a task waiting for your OK is asking (ADR 0033), answered right on its
 * card in the chat it came from: the same question its own chat shows.
 */
export interface TaskCardAsking {
  /** What it wants to do, sentence case: "Run `npm test`". */
  summary: ReactNode;
  /** The command, when it's one, shown whole. */
  command?: string;
  /** Why it asks although the mode would allow it (something it read). */
  why?: ReactNode;
  onAllow: () => void;
  onDeny: () => void;
  /** Sent: the buttons wait for the answer to land. */
  pending?: boolean;
}

export interface TaskCardProps extends Omit<ComponentProps<'article'>, 'title'> {
  title: string;
  status: TaskCardStatus;
  /** Finished execution with no automatic criteria; distinct from an uncertain action. */
  unchecked?: boolean;
  /** A helper the assistant runs side by side, or something you sent away. */
  kind?: 'background' | 'helper';
  /** When it started, to show how long it's been going (epoch ms). */
  startedAt?: number;
  finishedAt?: number;
  /** What it's doing right now: "Running `npm test`". */
  current?: ReactNode;
  /** What it did, newest last. */
  steps?: ReactNode[];
  /** Its result. */
  summary?: ReactNode;
  error?: ReactNode;
  /** "Claude Code reached its limit, so OpenRouter carried on." */
  note?: ReactNode;
  /** A helper's own branch, when it changed things there. */
  branch?: string;
  /** Another provider is doing it, by name ("Codex CLI"): said beside its status. */
  by?: ReactNode;
  /** Answered here while it waits for your OK; without it, "See what it's asking" opens its chat. */
  asking?: TaskCardAsking;
  /** Where it came from, on the Tasks page: a link to that chat. */
  from?: ReactNode;
  /** The mode it runs in, in words ("Full trust"): its chat's, never more. */
  mode?: ReactNode;
  /** `full` on the Tasks page; `compact` in a chat. */
  variant?: 'full' | 'compact';
  onOpen?: () => void;
  onStop?: () => void;
  onRetry?: () => void;
  onRemove?: () => void;
  /** For tests and stories. */
  now?: number;
}

const LABELS: Record<TaskCardStatus, string> = {
  queued: 'Waiting its turn',
  running: 'Working',
  'needs-you': 'Needs your OK',
  done: 'Verified complete',
  unverified: 'Result not verified',
  failed: 'Didn’t finish',
  stopped: 'Stopped',
  interrupted: 'Stopped when Conch did',
};

const going = (s: TaskCardStatus) => s === 'queued' || s === 'running' || s === 'needs-you';

/** "4s", "2 min", "1 h 5 min". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Ticks once a second while something is going, for the elapsed time. */
export function useTick(on: boolean, now?: number): number {
  const [time, setTime] = useState(() => now ?? Date.now());
  useEffect(() => {
    if (!on || now !== undefined) return;
    const t = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on, now]);
  return now ?? time;
}

/**
 * A task working away in the background (ADR 0033): what it is, how it's
 * going in words (never colour alone), what it's doing right now and what
 * it did, how long it's been, and the one or two things you can do. While it
 * works, the pearl breathes; when it needs you, the card says so first.
 */
export function TaskCard({
  title,
  status,
  unchecked = false,
  kind = 'background',
  startedAt,
  finishedAt,
  current,
  steps = [],
  summary,
  error,
  note,
  branch,
  by,
  asking,
  from,
  mode,
  variant = 'full',
  onOpen,
  onStop,
  onRetry,
  onRemove,
  now,
  className,
  ...props
}: TaskCardProps) {
  const titleId = useId();
  const time = useTick(going(status), now);
  const took = startedAt ? elapsed((finishedAt ?? time) - startedAt) : undefined;
  // In a chat, a finished task is its result; the steps are a page away.
  const shown = variant === 'compact' ? (going(status) ? steps.slice(-3) : []) : steps;
  const icon =
    status === 'running' ? (
      <Pearl size="sm" state="thinking" label={null} />
    ) : status === 'queued' ? (
      <Clock aria-hidden />
    ) : status === 'needs-you' ? (
      <Hand aria-hidden />
    ) : status === 'done' ? (
      <Check aria-hidden />
    ) : unchecked || status === 'stopped' ? (
      <Square aria-hidden />
    ) : (
      <CircleAlert aria-hidden />
    );
  return (
    <article
      aria-labelledby={titleId}
      className={cx(styles.card, className)}
      data-status={status}
      data-variant={variant}
      {...props}
    >
      <div className={styles.head}>
        <span className={styles.icon} data-status={status}>
          {icon}
        </span>
        <div className={styles.text}>
          <p className={styles.title} id={titleId}>
            {kind === 'helper' && (
              <>
                <Layers className={styles.kind} aria-hidden />
                <span className="nc-visually-hidden">Helper: </span>
              </>
            )}
            {title}
          </p>
          <p className={styles.meta} aria-live="polite">
            <span className={styles.status} data-status={status}>
              {unchecked && status === 'unverified'
                ? 'Finished — outcome not checked'
                : LABELS[status]}
            </span>
            {took && status !== 'queued' && <span> · {took}</span>}
            {by && <span> · by {by}</span>}
            {mode && <span> · {mode}</span>}
            {from && <span> · from {from}</span>}
          </p>
        </div>
      </div>

      {status === 'needs-you' && asking ? (
        <div className={styles.asking} role="group" aria-label="It’s asking">
          <p className={styles.askingLine}>
            <ShieldQuestion aria-hidden />
            <span>Wants to {asking.summary}</span>
          </p>
          {asking.why && <p className={styles.askingWhy}>{asking.why}</p>}
          {asking.command && <pre className={styles.askingCommand}>{asking.command}</pre>}
          <div className={styles.askingActions}>
            <Button size="sm" variant="ghost" onClick={asking.onDeny} disabled={asking.pending}>
              Deny
            </Button>
            <Button size="sm" onClick={asking.onAllow} loading={asking.pending}>
              Allow
            </Button>
          </div>
        </div>
      ) : (
        going(status) && current && <p className={styles.current}>{current}</p>
      )}
      {shown.length > 0 && (
        <ol className={styles.steps} aria-label="What it did">
          {shown.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {!going(status) && summary && <div className={styles.summary}>{summary}</div>}
      {note && <p className={styles.note}>{note}</p>}
      {(status === 'failed' || status === 'interrupted' || status === 'unverified') && error && (
        <p className={styles.error}>{error}</p>
      )}
      {branch && (
        <p className={styles.branch}>
          <GitBranch aria-hidden /> Its changes are on <code>{branch}</code>
        </p>
      )}

      {(onOpen || onStop || onRetry || onRemove) && (
        <div className={styles.actions}>
          {status === 'needs-you' && onOpen && !asking ? (
            <Button size="sm" onClick={onOpen} leadingIcon={<Hand />}>
              See what it’s asking
            </Button>
          ) : (
            onOpen && (
              <Button size="sm" variant="surface" onClick={onOpen} leadingIcon={<MessageSquare />}>
                Open
              </Button>
            )
          )}
          {going(status) && onStop && (
            <Button size="sm" variant="ghost" onClick={onStop} leadingIcon={<X />}>
              Stop
            </Button>
          )}
          {(status === 'failed' ||
            status === 'interrupted' ||
            status === 'stopped' ||
            status === 'unverified') &&
            !unchecked &&
            onRetry && (
              <Button size="sm" variant="surface" onClick={onRetry} leadingIcon={<RotateCcw />}>
                Resume safely
              </Button>
            )}
          {!going(status) && onRemove && variant === 'full' && (
            <Button size="sm" variant="ghost" onClick={onRemove} leadingIcon={<Trash2 />}>
              Remove
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
