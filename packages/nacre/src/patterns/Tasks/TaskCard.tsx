import {
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  GitBranch,
  Hand,
  MessageSquare,
  Play,
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
import { TaskSteps } from './TaskSteps';
import styles from './Tasks.module.css';
import { taskWaitingLine, type TaskWaitingInfo } from './waiting';

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
  /**
   * Done, but worth a look, and why, in a few words: "Couldn't confirm one of
   * its actions worked." Only with a concrete reason; without one, done is done.
   */
  worth?: ReactNode;
  /** When it started, to show how long it's been going (epoch ms). */
  startedAt?: number;
  finishedAt?: number;
  /** What it's doing right now: "Running `npm test`". */
  current?: ReactNode;
  /**
   * Still waiting: why, in a few words, and when that's known (ADR 0129). With
   * `onStartNow`, it waits only for room, and **Start now** is offered.
   */
  waiting?: TaskWaitingInfo;
  /** What it did, newest last: repeats and long runs of one kind are said as one line. */
  steps?: readonly string[];
  /** Draw a step's words (`code` as code, say). */
  renderStep?: (label: string) => ReactNode;
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

/**
 * A task's state in a word or two. Once it's over there are only two: it's
 * done, or it didn't finish (and Stopped, when you stopped it). One that's done
 * but worth a look says so beside it (`TASK_WORTH_A_LOOK`), and why.
 */
export const TASK_STATUS_LABELS: Record<TaskCardStatus, string> = {
  queued: 'Waiting',
  running: 'Working',
  'needs-you': 'Needs your OK',
  done: 'Done',
  unverified: 'Done',
  failed: 'Didn’t finish',
  stopped: 'Stopped',
  interrupted: 'Didn’t finish',
};

/** Said beside "Done" when there's a reason to look at what it did. */
export const TASK_WORTH_A_LOOK = 'Worth a look';

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
 * A task (ADR 0033), read at a glance: what
 * it is, how it's going in words (never colour alone) and how long it's
 * been; while it works, what it's doing, the pearl turning in its ring; once
 * it's done, one line of what came of it, or of what went wrong. Everything
 * else (its whole result, what was confirmed, what it did) waits behind
 * "Details". When it needs you, the card says so first.
 */
export function TaskCard({
  title,
  status,
  worth,
  startedAt,
  finishedAt,
  current,
  waiting,
  steps = [],
  renderStep,
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
  const look = taskLook(status, worth);
  const broke = status === 'failed' || status === 'interrupted';
  // The one line you read: what went wrong, or why it's worth a look, else what came of it.
  const problem =
    broke && error
      ? typeof error === 'string'
        ? taskHeadline(error)
        : error
      : look === 'check'
        ? worth
        : undefined;
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
  const startNow = status === 'queued' ? waiting?.onStartNow : undefined;
  const hidden = fullSummary || fullError || details || pastSteps.length > 0;
  // While it works: what it's doing, and the last few things (all of them on the Tasks page).
  const shown = live ? steps : [];
  const icon =
    status === 'running' ? (
      <Pearl size="sm" state="thinking" label={null} />
    ) : status === 'queued' ? (
      <Clock aria-hidden />
    ) : status === 'needs-you' ? (
      <Hand aria-hidden />
    ) : look === 'done' || look === 'check' ? (
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
              {title}
            </p>
            <p className={styles.meta} aria-live="polite">
              <span className={styles.status} data-look={look}>
                {TASK_STATUS_LABELS[status]}
              </span>
              {look === 'check' && (
                <span className={styles.worth}>
                  {' · '}
                  {TASK_WORTH_A_LOOK}
                </span>
              )}
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
        ) : status === 'queued' && waiting ? (
          <p className={styles.waiting}>{taskWaitingLine(waiting, time)}</p>
        ) : (
          live && current && <p className={styles.current}>{current}</p>
        )}
        {shown.length > 0 && (
          <TaskSteps
            steps={shown}
            {...(renderStep && { render: renderStep })}
            {...(variant === 'compact' && { last: 3 })}
          />
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
              <TaskSteps steps={pastSteps} {...(renderStep && { render: renderStep })} />
            )}
          </Collapsible.Content>
        )}

        {(onOpen || onStop || onRetry || onRemove || startNow) && (
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
            {startNow && (
              <Button
                size="sm"
                variant="surface"
                onClick={startNow}
                loading={waiting?.starting}
                leadingIcon={<Play />}
              >
                Start now
              </Button>
            )}
            {live && onStop && (
              <Button size="sm" variant="ghost" onClick={onStop} leadingIcon={<X />}>
                Stop
              </Button>
            )}
            {(broke || status === 'stopped' || look === 'check') && onRetry && (
              <Button size="sm" variant="surface" onClick={onRetry} leadingIcon={<RotateCcw />}>
                Resume safely
              </Button>
            )}
            {!live && onRemove && variant === 'full' && (
              <Button size="sm" variant="ghost" onClick={onRemove} leadingIcon={<Trash2 />}>
                Remove
              </Button>
            )}
            {/* In the chat, one worth a look goes once you've looked. */}
            {!live && onRemove && variant !== 'full' && look === 'check' && (
              <Button size="sm" variant="ghost" onClick={onRemove} leadingIcon={<Check />}>
                Checked
              </Button>
            )}
          </div>
        )}
      </Collapsible>
    </article>
  );
}

/**
 * How it looks at a glance, a little finer than its status: done is done
 * unless there's a reason to look ("check"); interrupted is didn't finish.
 */
export type TaskLook = 'queued' | 'running' | 'needs-you' | 'done' | 'check' | 'failed' | 'stopped';

export function taskLook(status: TaskCardStatus, worth?: unknown): TaskLook {
  if (status === 'unverified') return worth ? 'check' : 'done';
  if (status === 'interrupted') return 'failed';
  return status;
}

const words = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The line in view already says all of it. */
function same(full: string, line: ReactNode): boolean {
  return typeof line === 'string' && words(full) === words(line.replace(/…$/, ''));
}
