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
  useLayoutEffect,
  useRef,
  useState,
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
  /** Worth a look: you've looked, so it can go (offered only then). */
  onChecked?: () => void;
  /** It finished and you haven't looked yet: it stands out, once, then settles. */
  fresh?: boolean;
}

export interface ChatTasksProps extends Omit<ComponentProps<'div'>, 'children'> {
  tasks: readonly ChatTask[];
  open: boolean;
  /** The chat's title, so the list says whose tasks these are. */
  chat: string;
  /**
   * Finished ones you've seen: folded away under "Earlier", a press from
   * the rows that still matter.
   */
  earlier?: readonly ChatTask[];
  /** For tests and stories. */
  now?: number;
}

export interface ChatTasksToggleProps extends Omit<
  ComponentProps<'button'>,
  'children' | 'onToggle'
> {
  tasks: readonly Pick<ChatTask, 'status' | 'fresh'>[];
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
export function tasksSummary(tasks: readonly Pick<ChatTask, 'status' | 'fresh'>[]): string {
  const needs = tasks.filter((t) => t.status === 'needs-you').length;
  const working = tasks.filter((t) => t.status === 'running').length;
  const waiting = tasks.filter((t) => t.status === 'queued').length;
  const failed = tasks.filter((t) => broke(t.status)).length;
  const fresh = tasks.filter((t) => t.fresh).length;
  const all = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
  const now = [
    needs && `${needs} ${needs === 1 ? 'needs' : 'need'} you`,
    working && `${working} working`,
    !needs && !working && waiting && `${waiting} waiting`,
    failed && `${failed} didn’t finish`,
    fresh && `${fresh} new`,
  ].filter(Boolean);
  return now.length ? `${all} · ${now.join(', ')}` : all;
}

/** How a chat's tasks are going, all together: the one the badge shows. */
export type ChatTasksTone = 'needs' | 'working' | 'failed' | 'fresh' | 'idle';

export function tasksTone(tasks: readonly Pick<ChatTask, 'status' | 'fresh'>[]): ChatTasksTone {
  if (tasks.some((t) => t.status === 'needs-you')) return 'needs';
  if (tasks.some((t) => going(t.status))) return 'working';
  if (tasks.some((t) => broke(t.status))) return 'failed';
  if (tasks.some((t) => t.fresh)) return 'fresh';
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

function TaskRow({
  task,
  now,
  index,
  leaving,
  onLeft,
}: {
  task: ChatTask;
  now?: number;
  index: number;
  leaving?: boolean;
  onLeft?: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLLIElement>(null);
  // Going: it folds from its own height, measured before the fold is drawn.
  useLayoutEffect(() => {
    const row = ref.current;
    if (leaving && row) row.style.setProperty('--ct-h', `${row.getBoundingClientRect().height}px`);
  }, [leaving]);
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
              {/* Its own box, so a long title ends in an ellipsis instead of being cut. */}
              <span className={styles.titleText}>{link.props.children}</span>
              {task.fresh && <span className="nc-visually-hidden"> (new)</span>}
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
      ref={ref}
      className={styles.row}
      data-status={task.status}
      data-fresh={task.fresh || undefined}
      data-leaving={leaving || undefined}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      style={{ '--ct-i': index } as CSSProperties}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onLeft?.();
      }}
    >
      <Slot.Root className={styles.link}>{content}</Slot.Root>
      {task.fresh && <span className={styles.fresh} aria-hidden />}
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
      {look === 'check' && task.onChecked && (
        <span className={styles.checked}>
          <IconButton
            size="sm"
            label="Mark checked"
            tooltip={false}
            aria-describedby={titleId}
            onClick={task.onChecked}
          >
            <Check />
          </IconButton>
        </span>
      )}
    </li>
  );
}

/**
 * Rows that leave stay a moment, folding shut where they were, so the list
 * closes over them instead of jumping. Gone at once with motion reduced (the
 * animation is as short as nothing, and ends).
 */
function useLeaving(tasks: readonly ChatTask[]) {
  const [gone, setGone] = useState<{ task: ChatTask; at: number }[]>([]);
  const before = useRef(tasks);
  const ids = tasks.map((t) => t.id).join(' ');
  useLayoutEffect(() => {
    const here = new Set(tasks.map((t) => t.id));
    const left = before.current
      .map((task, at) => ({ task, at }))
      .filter(({ task }) => !here.has(task.id));
    setGone((g) => {
      const kept = g.filter((x) => !here.has(x.task.id));
      return left.length ? [...kept, ...left] : kept.length === g.length ? g : kept;
    });
    // Only which rows are here matters: `ids` says so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  // After the one above: the newest copy of each row, for when it next goes.
  useLayoutEffect(() => {
    before.current = tasks;
  });
  // A fallback, should an animation never end (a hidden tab).
  useLayoutEffect(() => {
    if (!gone.length) return;
    const timer = setTimeout(() => setGone([]), 1000);
    return () => clearTimeout(timer);
  }, [gone]);
  const rows: { task: ChatTask; leaving?: boolean }[] = tasks.map((task) => ({ task }));
  for (const { task, at } of [...gone].sort((a, b) => a.at - b.at))
    rows.splice(Math.min(at, rows.length), 0, { task, leaving: true });
  const left = (id: string) => setGone((g) => g.filter((x) => x.task.id !== id));
  return { rows, left };
}

/**
 * A chat's tasks, under it in the chat list (ADR 0033), opened from the
 * badge on the chat's own row (`ChatTasksToggle`): a row per task on the
 * chat's title line — its state as a mark and in a word or two, what it's
 * doing right now, how long it took, a press to open its chat and, while it
 * works, a Stop. What finished and you've seen folds away under "Earlier";
 * a row that goes folds shut where it was.
 */
export function ChatTasks({
  tasks,
  open,
  chat,
  earlier = [],
  now,
  className,
  id,
  ...props
}: ChatTasksProps) {
  const { rows, left } = useLeaving(tasks);
  const [showEarlier, setShowEarlier] = useState(false);
  const earlierId = useId();
  return (
    <div className={cx(styles.root, className)} {...props}>
      <Collapsible open={open}>
        <Collapsible.Content id={id} className={styles.content}>
          <ul className={styles.list} aria-label={`Tasks from ${chat}`}>
            {rows.map(({ task, leaving }, i) => (
              <TaskRow
                key={task.id}
                task={task}
                now={now}
                index={i}
                leaving={leaving}
                onLeft={() => left(task.id)}
              />
            ))}
            {earlier.length > 0 && (
              <li className={styles.earlierRow}>
                <button
                  type="button"
                  className={styles.earlier}
                  aria-expanded={showEarlier}
                  aria-controls={earlierId}
                  onClick={() => setShowEarlier((v) => !v)}
                >
                  <ChevronRight className={styles.earlierChevron} aria-hidden />
                  <span>Earlier</span> <span className={styles.earlierCount}>{earlier.length}</span>
                </button>
              </li>
            )}
          </ul>
          {earlier.length > 0 && (
            <Collapsible open={showEarlier}>
              <Collapsible.Content id={earlierId} className={styles.content}>
                <ul
                  className={cx(styles.list, styles.earlierList)}
                  aria-label={`Earlier tasks from ${chat}`}
                >
                  {earlier.map((task, i) => (
                    <TaskRow key={task.id} task={task} now={now} index={i} />
                  ))}
                </ul>
              </Collapsible.Content>
            </Collapsible>
          )}
        </Collapsible.Content>
      </Collapsible>
    </div>
  );
}
