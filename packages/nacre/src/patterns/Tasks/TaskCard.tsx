import {
  Check,
  ChevronDown,
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
import { Collapsible } from '../../components/Collapsible';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import { taskHeadline } from './headline';
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
  /**
   * Its result, in one line, always in view once it's finished. Without it, a
   * text `summary`'s first sentence or two, ids and bookkeeping left out.
   */
  outcome?: ReactNode;
  /** Its result in full: behind "Details" when there's more to it than the outcome. */
  summary?: ReactNode;
  /** More to look at, behind "Details": confirmed results, what's still unchecked. */
  details?: ReactNode;
  /** Open "Details" to begin with. */
  defaultExpanded?: boolean;
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
  done: 'Done',
  unverified: 'Needs a look',
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
 * A task working away in the background (ADR 0033), read at a glance: what
 * it is, how it's going in words (never colour alone) and how long it's
 * been; while it works, what it's doing, the pearl turning in its ring; once
 * it's done, one line of what came of it, or of what went wrong. Everything
 * else (its whole result, what was confirmed, what it did) waits behind
 * "Details". When it needs you, the card says so first.
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
  outcome,
  summary,
  details,
  defaultExpanded = false,
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
  const [open, setOpen] = useState(defaultExpanded);
  const live = going(status);
  const time = useTick(live, now);
  const took = startedAt ? elapsed((finishedAt ?? time) - startedAt) : undefined;
  const look = lookOf(status, unchecked);
  const wrong = status === 'failed' || status === 'interrupted' || status === 'unverified';
  // The one line you read: what went wrong first, else what came of it.
  const problem =
    wrong && error ? (typeof error === 'string' ? taskHeadline(error) : error) : undefined;
  const result = live
    ? undefined
    : (outcome ?? (typeof summary === 'string' ? taskHeadline(summary) : undefined));
  // Behind "Details": only what the lines in view don't already say.
  const fullSummary =
    !live && summary && !(typeof summary === 'string' && same(summary, result))
      ? summary
      : undefined;
  const fullError =
    problem && typeof error === 'string' && !same(error, problem) ? error : undefined;
  const pastSteps = live ? [] : steps;
  const hidden = fullSummary || fullError || details || pastSteps.length > 0;
  // While it works: what it's doing, and the last few things (all of them on the Tasks page).
  const shown = live ? (variant === 'compact' ? steps.slice(-3) : steps) : [];
  const icon =
    status === 'running' ? (
      <Pearl size="sm" state="thinking" label={null} />
    ) : status === 'queued' ? (
      <Clock aria-hidden />
    ) : status === 'needs-you' ? (
      <Hand aria-hidden />
    ) : look === 'done' || look === 'finished' ? (
      <Check aria-hidden />
    ) : status === 'stopped' ? (
      <Square aria-hidden />
    ) : (
      <CircleAlert aria-hidden />
    );
  return (
    <article
      aria-labelledby={titleId}
      className={cx(styles.card, className)}
      data-status={status}
      data-look={look}
      data-variant={variant}
      {...props}
    >
      <Collapsible open={open} onOpenChange={setOpen} className={styles.body}>
        <div className={styles.head}>
          {/* Keyed by how it looks, so a change of state arrives with its own little motion. */}
          <span key={look} className={styles.icon} data-look={look}>
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
              <span className={styles.status} data-look={look}>
                {unchecked && status === 'unverified' ? 'Finished' : LABELS[status]}
              </span>
              {took && status !== 'queued' && <span> · {took}</span>}
              {by && <span> · by {by}</span>}
              {mode && <span> · {mode}</span>}
              {from && <span> · from {from}</span>}
            </p>
          </div>
          {hidden && (
            <Collapsible.Trigger className={styles.more} chevron={false}>
              <ChevronDown aria-hidden />
              <span className="nc-visually-hidden">Details</span>
            </Collapsible.Trigger>
          )}
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
          live && current && <p className={styles.current}>{current}</p>
        )}
        {shown.length > 0 && (
          <ol className={styles.steps} aria-label="What it did">
            {shown.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
        {problem && <p className={styles.problem}>{problem}</p>}
        {/* Opened, its whole result says it: the line would only repeat it. */}
        {result && !(open && fullSummary) && <p className={styles.outcome}>{result}</p>}
        {note && <p className={styles.note}>{note}</p>}
        {branch && (
          <p className={styles.branch}>
            <GitBranch aria-hidden /> Its changes are on <code>{branch}</code>
          </p>
        )}

        {hidden && (
          <Collapsible.Content className={styles.details}>
            {fullSummary && <div className={styles.summary}>{fullSummary}</div>}
            {fullError && <p className={styles.error}>{fullError}</p>}
            {details && <div className={styles.extra}>{details}</div>}
            {pastSteps.length > 0 && (
              <ol className={styles.steps} aria-label="What it did">
                {pastSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            )}
          </Collapsible.Content>
        )}

        {(onOpen || onStop || onRetry || onRemove) && (
          <div className={styles.actions}>
            {status === 'needs-you' && onOpen && !asking ? (
              <Button size="sm" onClick={onOpen} leadingIcon={<Hand />}>
                See what it’s asking
              </Button>
            ) : (
              onOpen && (
                <Button
                  size="sm"
                  variant="surface"
                  onClick={onOpen}
                  leadingIcon={<MessageSquare />}
                >
                  Open
                </Button>
              )
            )}
            {live && onStop && (
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
            {!live && onRemove && variant === 'full' && (
              <Button size="sm" variant="ghost" onClick={onRemove} leadingIcon={<Trash2 />}>
                Remove
              </Button>
            )}
          </div>
        )}
      </Collapsible>
    </article>
  );
}

/**
 * How it looks at a glance, a little finer than its status: a finished task
 * with nothing to check it against is "finished", not a warning.
 */
type TaskLook =
  'queued' | 'running' | 'needs-you' | 'done' | 'finished' | 'check' | 'failed' | 'stopped';

function lookOf(status: TaskCardStatus, unchecked: boolean): TaskLook {
  if (status === 'unverified') return unchecked ? 'finished' : 'check';
  if (status === 'interrupted') return 'failed';
  return status;
}

const words = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The line in view already says all of it. */
function same(full: string, line: ReactNode): boolean {
  return typeof line === 'string' && words(full) === words(line.replace(/…$/, ''));
}
