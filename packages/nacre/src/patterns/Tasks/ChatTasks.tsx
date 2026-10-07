import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleSlash,
  Clock,
  Hand,
  Layers,
  X,
} from 'lucide-react';
import { Slot } from 'radix-ui';
import {
  cloneElement,
  isValidElement,
  useId,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Collapsible } from '../../components/Collapsible';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import styles from './ChatTasks.module.css';
import {
  elapsed,
  TASK_STATUS_LABELS,
  TASK_WORTH_A_LOOK,
  taskLook,
  useTick,
  type TaskCardStatus,
} from './TaskCard';

/** One task under its chat in the list. */
export interface ChatTask {
  id: string;
  /**
   * Its link, with the title inside: `<NavLink to="/c/…">Tidy the README</NavLink>`.
   * Opens the task's own chat.
   */
  link: ReactElement<{ children?: ReactNode }>;
  status: TaskCardStatus;
  /** Done, but worth a look: why, in a few words (see `TaskCard`'s `worth`). */
  worth?: ReactNode;
  /** What it's doing right now ("Running `npm test`"), while it works. */
  current?: ReactNode;
  /** Why it didn't finish, in a few words ("The tests failed"). */
  reason?: ReactNode;
  startedAt?: number;
  finishedAt?: number;
  /** Another provider is doing it, by name. */
  by?: ReactNode;
  /** Given, a going task can be stopped from the list. */
  onStop?: () => void;
}

export interface ChatTasksProps extends Omit<ComponentProps<'div'>, 'children'> {
  tasks: readonly ChatTask[];
  open: boolean;
  /** The chat's title, so the list says whose tasks these are. */
  chat: string;
  /** For tests and stories. */
  now?: number;
}

export interface ChatTasksToggleProps extends Omit<
  ComponentProps<'button'>,
  'children' | 'onToggle'
> {
  tasks: readonly Pick<ChatTask, 'status'>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chat's title, so the toggle says whose tasks these are. */
  chat: string;
  /** The `id` of the `ChatTasks` it opens. */
  'aria-controls': string;
}

const going = (s: TaskCardStatus) => s === 'queued' || s === 'running' || s === 'needs-you';
const broke = (s: TaskCardStatus) => s === 'failed' || s === 'interrupted';

/** "3 tasks · 1 needs you", "2 working", "1 task": what's under a chat, in a few words. */
export function tasksSummary(tasks: readonly Pick<ChatTask, 'status'>[]): string {
  const needs = tasks.filter((t) => t.status === 'needs-you').length;
  const working = tasks.filter((t) => t.status === 'running').length;
  const waiting = tasks.filter((t) => t.status === 'queued').length;
  const failed = tasks.filter((t) => broke(t.status)).length;
  const all = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
  const now = [
    needs && `${needs} ${needs === 1 ? 'needs' : 'need'} you`,
    working && `${working} working`,
    !needs && !working && waiting && `${waiting} waiting`,
    failed && `${failed} didn’t finish`,
  ].filter(Boolean);
  return now.length ? `${all} · ${now.join(', ')}` : all;
}

/** How a chat's tasks are going, all together: the one the badge shows. */
export type ChatTasksTone = 'needs' | 'working' | 'failed' | 'idle';

export function tasksTone(tasks: readonly Pick<ChatTask, 'status'>[]): ChatTasksTone {
  if (tasks.some((t) => t.status === 'needs-you')) return 'needs';
  if (tasks.some((t) => going(t.status))) return 'working';
  if (tasks.some((t) => broke(t.status))) return 'failed';
  return 'idle';
}

/**
 * A task's state as a mark, never colour alone: a turning ring of lustre
 * while it works, a hand when it needs you, a tick, a cross, a stop.
 */
export function TaskStatusMark({
  status,
  worth,
  className,
}: {
  status: TaskCardStatus;
  /** Done, but worth a look: the tick in amber. */
  worth?: unknown;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(styles.mark, className)}
      data-status={status}
      data-look={taskLook(status, worth)}
    >
      {status === 'running' ? (
        <span className={styles.ring} />
      ) : status === 'queued' ? (
        <Clock />
      ) : status === 'needs-you' ? (
        <Hand />
      ) : status === 'done' || status === 'unverified' ? (
        <Check />
      ) : status === 'stopped' ? (
        <CircleSlash />
      ) : (
        <X />
      )}
    </span>
  );
}

/**
 * On the chat's own row (`ChatRow`'s `disclosure`): how many tasks it sent off
 * and how they're going, in a small badge that opens them under it. Working,
 * the mark turns; needing you, it's a hand in amber; something that didn't
 * finish tints it. Said in full to a screen reader.
 */
export function ChatTasksToggle({
  tasks,
  open,
  onOpenChange,
  chat,
  className,
  onClick,
  ...props
}: ChatTasksToggleProps) {
  const tone = tasksTone(tasks);
  return (
    <button
      type="button"
      className={cx(styles.toggle, className)}
      data-tone={tone}
      data-state={open ? 'open' : 'closed'}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} tasks from ${chat}: ${tasksSummary(tasks)}`}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onOpenChange(!open);
      }}
      {...props}
    >
      <span className={styles.badgeMark} aria-hidden>
        {tone === 'working' ? (
          <span className={styles.ring} />
        ) : tone === 'needs' ? (
          <Hand />
        ) : tone === 'failed' ? (
          <CircleAlert />
        ) : (
          <Layers />
        )}
      </span>
      <span className={styles.count} aria-hidden>
        {tasks.length}
      </span>
      <ChevronRight className={styles.chevron} aria-hidden />
    </button>
  );
}

function TaskRow({ task, now, index }: { task: ChatTask; now?: number; index: number }) {
  const titleId = useId();
  const time = useTick(going(task.status), now);
  const took =
    task.startedAt && task.status !== 'queued'
      ? elapsed((task.finishedAt ?? time) - task.startedAt)
      : undefined;
  const link = task.link;
  const look = taskLook(task.status, task.worth);
  const words =
    going(task.status) && task.current
      ? task.current
      : broke(task.status) && task.reason
        ? task.reason
        : look === 'check'
          ? TASK_WORTH_A_LOOK
          : TASK_STATUS_LABELS[task.status];
  const content = isValidElement(link)
    ? cloneElement(
        link,
        undefined,
        <>
          <TaskStatusMark status={task.status} worth={task.worth} className={styles.icon} />
          <span className={styles.text}>
            <span className={styles.title} id={titleId}>
              {link.props.children}
            </span>
            <span className={styles.meta} data-status={task.status} data-look={look}>
              {/* Said after the title: what it's doing, or where it stands. */}
              <span className="nc-visually-hidden">, </span>
              {broke(task.status) && task.reason && (
                <span className="nc-visually-hidden">{TASK_STATUS_LABELS[task.status]}: </span>
              )}
              {look === 'check' && <span className="nc-visually-hidden">Done, </span>}
              <span className={styles.doing}>{words}</span>
              {/* A fixed space, so the separator survives being its own flex item. */}
              {took && !(broke(task.status) && task.reason) && (
                <span className={styles.took}>{`\u00a0· ${took}`}</span>
              )}
              {task.by && (
                <span className={styles.by}>
                  {'\u00a0· by '}
                  {task.by}
                </span>
              )}
            </span>
          </span>
        </>,
      )
    : link;
  return (
    <li
      className={styles.row}
      data-status={task.status}
      style={{ '--ct-i': index } as CSSProperties}
    >
      <Slot.Root className={styles.link}>{content}</Slot.Root>
      {going(task.status) && task.onStop && (
        <span className={styles.stop}>
          <IconButton
            size="sm"
            label="Stop"
            tooltip={false}
            aria-describedby={titleId}
            onClick={task.onStop}
          >
            <X />
          </IconButton>
        </span>
      )}
    </li>
  );
}

/**
 * A chat's tasks, under it in the chat list (ADR 0033), opened from the
 * badge on the chat's own row (`ChatTasksToggle`): a row per task on the
 * chat's title line — its state as a mark and in a word or two, what it's
 * doing right now, how long it took, a press to open its chat and, while it
 * works, a Stop.
 */
export function ChatTasks({ tasks, open, chat, now, className, id, ...props }: ChatTasksProps) {
  return (
    <div className={cx(styles.root, className)} {...props}>
      <Collapsible open={open}>
        <Collapsible.Content id={id} className={styles.content}>
          <ul className={styles.list} aria-label={`Tasks from ${chat}`}>
            {tasks.map((task, i) => (
              <TaskRow key={task.id} task={task} now={now} index={i} />
            ))}
          </ul>
        </Collapsible.Content>
      </Collapsible>
    </div>
  );
}
