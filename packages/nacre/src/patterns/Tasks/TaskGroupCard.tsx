import { ChevronRight, ShieldQuestion } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { TaskStatusMark } from './ChatTasks';
import { taskHeadline } from './headline';
import {
  elapsed,
  TASK_STATUS_LABELS,
  useTick,
  type TaskCardAsking,
  type TaskCardStatus,
} from './TaskCard';
import styles from './TaskGroupCard.module.css';

/** One task of a batch, as its line on the batch's card. */
export interface TaskGroupItem {
  id: string;
  title: string;
  status: TaskCardStatus;
  /** Finished with nothing to check it against. */
  unchecked?: boolean;
  /** What it's doing right now, while it works. */
  current?: ReactNode;
  /** Its result: its first sentence or so is its line once it's done. */
  summary?: string;
  /** What went wrong: its line, first, when it didn't finish. */
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** Answered right on its line while it waits for your OK. */
  asking?: TaskCardAsking;
}

export interface TaskGroupCardProps extends Omit<ComponentProps<'article'>, 'title'> {
  /** In the order they started. */
  tasks: TaskGroupItem[];
  /** Open one (its sheet, over the chat). */
  onOpen?: (id: string) => void;
  /** For tests and stories. */
  now?: number;
}

const going = (s: TaskCardStatus) => s === 'queued' || s === 'running' || s === 'needs-you';
const wrong = (s: TaskCardStatus) => s === 'failed' || s === 'interrupted';

/** How the batch stands, in words: "1 needs you · 2 working · 3 done". */
export function batchSummary(tasks: Pick<TaskGroupItem, 'status'>[]): string {
  const count = (test: (s: TaskCardStatus) => boolean) =>
    tasks.filter((t) => test(t.status)).length;
  return [
    [count((s) => s === 'needs-you'), 'needs you', 'need you'],
    [count((s) => s === 'running'), 'working', 'working'],
    [count((s) => s === 'queued'), 'waiting', 'waiting'],
    [count((s) => s === 'done' || s === 'unverified'), 'done', 'done'],
    [count(wrong), 'didn’t finish', 'didn’t finish'],
    [count((s) => s === 'stopped'), 'stopped', 'stopped'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(' · ');
}

/** The batch's own mark: what needs you first, then what's working, then how it ended. */
function batchStatus(tasks: TaskGroupItem[]): TaskCardStatus {
  const has = (s: TaskCardStatus) => tasks.some((t) => t.status === s);
  if (has('needs-you')) return 'needs-you';
  if (has('running')) return 'running';
  if (has('queued')) return 'queued';
  if (tasks.some((t) => wrong(t.status))) return 'failed';
  if (tasks.every((t) => t.status === 'stopped')) return 'stopped';
  return 'done';
}

/**
 * Tasks started together (ADR 0033), as one card in the chat they came from:
 * how the batch stands in a line and a bar (a segment each, in its colour),
 * then a line per task. What needs your OK rises to the top and is answered
 * right there. Once every one has finished, the bar folds away and the lines
 * are the result: what each did, or why it didn't. Each opens its task.
 */
export function TaskGroupCard({ tasks, onOpen, now, className, ...props }: TaskGroupCardProps) {
  const titleId = useId();
  const live = tasks.some((t) => going(t.status));
  const time = useTick(live, now);
  const status = batchStatus(tasks);
  const finished = tasks.filter((t) => !going(t.status)).length;
  // Waiting for you first; otherwise the order they started in, so nothing jumps.
  const lines = live
    ? [
        ...tasks.filter((t) => t.status === 'needs-you'),
        ...tasks.filter((t) => t.status !== 'needs-you'),
      ]
    : tasks;
  const starts = tasks.flatMap((t) => (t.startedAt ? [t.startedAt] : []));
  const ends = tasks.flatMap((t) => (t.finishedAt ? [t.finishedAt] : []));
  const took =
    starts.length > 0
      ? elapsed((live ? time : Math.max(...ends, Math.min(...starts))) - Math.min(...starts))
      : undefined;
  return (
    <article
      aria-labelledby={titleId}
      className={cx(styles.card, className)}
      data-status={status}
      data-live={live || undefined}
      {...props}
    >
      <div className={styles.head}>
        <span key={status} className={styles.mark}>
          <TaskStatusMark status={status} />
        </span>
        <p className={styles.title} id={titleId}>
          {tasks.length} tasks
        </p>
        <p className={styles.meta} aria-live="polite">
          {batchSummary(tasks)}
          {took && <span className={styles.took}> · {took}</span>}
        </p>
      </div>

      {/* Folded away once they've all finished: the lines say it then. */}
      <div className={styles.fold} data-open={live || undefined} aria-hidden={!live || undefined}>
        <div
          className={styles.bar}
          role="img"
          aria-label={`${finished} of ${tasks.length} finished`}
        >
          {tasks.map((t) => (
            <span key={t.id} className={styles.segment} data-status={t.status} />
          ))}
        </div>
      </div>

      <ul className={styles.lines}>
        {lines.map((task) => (
          <li key={task.id} className={styles.item} data-status={task.status}>
            <GroupLine task={task} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </article>
  );
}

function GroupLine({ task, onOpen }: { task: TaskGroupItem; onOpen?: (id: string) => void }) {
  const { status, asking } = task;
  const line =
    status === 'running' || status === 'queued'
      ? (task.current ?? (status === 'queued' ? TASK_STATUS_LABELS.queued : undefined))
      : status === 'needs-you'
        ? undefined
        : wrong(status)
          ? (taskHeadline(task.error) ?? TASK_STATUS_LABELS[status])
          : status === 'stopped'
            ? TASK_STATUS_LABELS.stopped
            : taskHeadline(task.summary);
  const word = status === 'unverified' && task.unchecked ? 'Finished' : TASK_STATUS_LABELS[status];
  const inner = (
    <>
      <TaskStatusMark status={status} className={styles.lineMark} />
      <span className={styles.lineText}>
        <span className={styles.lineTitle}>{task.title}</span>
        <span className="nc-visually-hidden">: {word}.</span>
        {line && (
          <span className={styles.lineSays} data-wrong={wrong(status) || undefined}>
            {line}
          </span>
        )}
      </span>
      {onOpen && <ChevronRight aria-hidden className={styles.chevron} />}
    </>
  );
  return (
    <>
      {onOpen ? (
        <button type="button" className={styles.line} onClick={() => onOpen(task.id)}>
          {inner}
        </button>
      ) : (
        <div className={styles.line}>{inner}</div>
      )}
      {status === 'needs-you' && asking && (
        <div className={styles.asking} role="group" aria-label={`${task.title} is asking`}>
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
      )}
    </>
  );
}
