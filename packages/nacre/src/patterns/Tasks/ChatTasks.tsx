import { Check, ChevronRight, CircleAlert, Clock, Hand, Layers, Square, X } from 'lucide-react';
import { Slot } from 'radix-ui';
import {
  cloneElement,
  isValidElement,
  useId,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Collapsible } from '../../components/Collapsible';
import { IconButton } from '../../components/IconButton';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './ChatTasks.module.css';
import { elapsed, useTick, type TaskCardStatus } from './TaskCard';

/** One task under its chat in the list. */
export interface ChatTask {
  id: string;
  /**
   * Its link, with the title inside: `<NavLink to="/c/…">Tidy the README</NavLink>`.
   * Opens the task's own chat.
   */
  link: ReactElement<{ children?: ReactNode }>;
  status: TaskCardStatus;
  kind?: 'background' | 'helper';
  /** What it's doing right now ("Running `npm test`"), while it works. */
  current?: ReactNode;
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
  onOpenChange: (open: boolean) => void;
  /** The chat's title, so the toggle says whose tasks these are. */
  chat: string;
  /** For tests and stories. */
  now?: number;
}

const WORDS: Record<TaskCardStatus, string> = {
  queued: 'Waiting its turn',
  running: 'Working',
  'needs-you': 'Needs your OK',
  done: 'Done',
  unverified: 'Finished, not verified',
  failed: 'Didn’t finish',
  stopped: 'Stopped',
  interrupted: 'Stopped when Conch did',
};

const going = (s: TaskCardStatus) => s === 'queued' || s === 'running' || s === 'needs-you';

/** "3 tasks · 1 needs you", "2 working", "1 task": what's under a chat, in a few words. */
export function tasksSummary(tasks: readonly Pick<ChatTask, 'status'>[]): string {
  const needs = tasks.filter((t) => t.status === 'needs-you').length;
  const working = tasks.filter((t) => t.status === 'running').length;
  const waiting = tasks.filter((t) => t.status === 'queued').length;
  const all = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
  const now = [
    needs && `${needs} ${needs === 1 ? 'needs' : 'need'} you`,
    working && `${working} working`,
    !needs && !working && waiting && `${waiting} waiting`,
  ].filter(Boolean);
  return now.length ? `${all} · ${now.join(', ')}` : all;
}

function StatusIcon({ status }: { status: TaskCardStatus }) {
  if (status === 'running') return <Pearl size="xs" state="thinking" label={null} />;
  if (status === 'queued') return <Clock aria-hidden />;
  if (status === 'needs-you') return <Hand aria-hidden />;
  if (status === 'done') return <Check aria-hidden />;
  if (status === 'stopped') return <Square aria-hidden />;
  return <CircleAlert aria-hidden />;
}

function TaskRow({ task, now }: { task: ChatTask; now?: number }) {
  const titleId = useId();
  const time = useTick(going(task.status), now);
  const took =
    task.startedAt && task.status !== 'queued'
      ? elapsed((task.finishedAt ?? time) - task.startedAt)
      : undefined;
  const link = task.link;
  const words = going(task.status) && task.current ? task.current : WORDS[task.status];
  const content = isValidElement(link)
    ? cloneElement(
        link,
        undefined,
        <>
          <span className={styles.icon} data-status={task.status}>
            <StatusIcon status={task.status} />
          </span>
          <span className={styles.text}>
            <span className={styles.title} id={titleId}>
              {/* The status icon carries the mark; a helper is only said. */}
              {task.kind === 'helper' && <span className="nc-visually-hidden">Helper: </span>}
              {link.props.children}
            </span>
            <span className={styles.meta} data-status={task.status}>
              {/* Said after the title: what it's doing, or where it stands. */}
              <span className="nc-visually-hidden">, </span>
              <span className={styles.doing}>{words}</span>
              {/* A fixed space, so the separator survives being its own flex item. */}
              {took && <span className={styles.took}>{`\u00a0· ${took}`}</span>}
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
    <li className={styles.row} data-status={task.status}>
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
 * A chat's tasks, under it in the chat list (ADR 0033): one line that says
 * how many and how they're going, and opens into a row per task — its
 * status in words and a mark (never colour alone), what it's doing right
 * now, how long it's been, a press to open its chat and, while it works, a
 * Stop. Something waiting for you says so on the line itself.
 */
export function ChatTasks({
  tasks,
  open,
  onOpenChange,
  chat,
  now,
  className,
  ...props
}: ChatTasksProps) {
  const listId = useId();
  const needs = tasks.some((t) => t.status === 'needs-you');
  const working = tasks.some((t) => t.status === 'running');
  return (
    <div className={cx(styles.root, className)} data-needs={needs || undefined} {...props}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className={styles.toggle}
            aria-controls={listId}
            aria-label={`${open ? 'Hide' : 'Show'} tasks from ${chat}: ${tasksSummary(tasks)}`}
          >
            <ChevronRight className={styles.chevron} aria-hidden />
            {needs ? (
              <Hand className={styles.mark} data-needs aria-hidden />
            ) : working ? (
              <Pearl size="xs" state="thinking" label={null} className={styles.mark} />
            ) : (
              <Layers className={styles.mark} aria-hidden />
            )}
            <span className={styles.summary}>{tasksSummary(tasks)}</span>
          </button>
        </Collapsible.Trigger>
        <Collapsible.Content id={listId}>
          <ul className={styles.list} aria-label={`Tasks from ${chat}`}>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} now={now} />
            ))}
          </ul>
        </Collapsible.Content>
      </Collapsible>
    </div>
  );
}
