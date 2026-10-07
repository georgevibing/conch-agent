import type { ComponentProps, CSSProperties, ReactElement, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import { TaskStatusMark } from './ChatTasks';
import type { TaskCardStatus } from './TaskCard';
import styles from './TasksPulse.module.css';

/** One task that's still going, anywhere. */
export interface PulseTask {
  id: string;
  /**
   * Its link, with the title inside: `<Link to="/c/…">Tidy the README</Link>`.
   * Pressing it closes the list.
   */
  link: ReactElement<{ children?: ReactNode }>;
  status: TaskCardStatus;
  /** The chat it came from, by name. */
  chat?: ReactNode;
  /** What it's doing right now, or what it wants to do. */
  current?: ReactNode;
  /** It's asking: answered from the list. */
  asking?: { pending?: boolean; onAllow: () => void; onDeny: () => void };
}

export interface TasksPulseProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Only the ones still going: waiting, working, or waiting for you. */
  tasks: readonly PulseTask[];
  /** Beside the pearl: the assistant's name. Left out, just the pearl and a count. */
  children?: ReactNode;
  /** Something just finished: the pearl glints once. */
  celebrate?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const ORDER: Partial<Record<TaskCardStatus, number>> = { 'needs-you': 0, running: 1, queued: 2 };

/** "2 tasks working, 1 needs you": what's going on in the background, in words. */
export function pulseSummary(tasks: readonly Pick<PulseTask, 'status'>[]): string {
  const needs = tasks.filter((t) => t.status === 'needs-you').length;
  const working = tasks.filter((t) => t.status === 'running').length;
  const waiting = tasks.filter((t) => t.status === 'queued').length;
  const noun = (n: number) => (n === 1 ? 'task' : 'tasks');
  const parts: string[] = [];
  if (working) parts.push(`${working} ${noun(working)} working`);
  if (needs)
    parts.push(
      `${needs}${parts.length ? '' : ` ${noun(needs)}`} ${needs === 1 ? 'needs' : 'need'} you`,
    );
  if (waiting) parts.push(`${waiting}${parts.length ? '' : ` ${noun(waiting)}`} waiting`);
  return parts.join(', ');
}

/**
 * The pearl that says something's going on in the background. Calm when
 * nothing is; breathing while tasks work; warm amber when one needs you; one
 * glint when something finishes. While anything's going it opens a short list
 * of just those, wherever they came from, and what's asking can be answered
 * right there.
 */
export function TasksPulse({
  tasks,
  children,
  celebrate,
  open,
  onOpenChange,
  className,
  ...props
}: TasksPulseProps) {
  const compact = children === undefined;
  if (!tasks.length) {
    if (compact) return null;
    return (
      <span className={cx(styles.pulse, className)} {...props}>
        <Pearl size="xs" label={null} glint={celebrate} />
        <span className={styles.name}>{children}</span>
      </span>
    );
  }
  const needs = tasks.some((t) => t.status === 'needs-you');
  const sorted = [...tasks].sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3));
  const summary = pulseSummary(tasks);
  return (
    <span className={cx(styles.pulse, className)} {...props}>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger
          className={styles.trigger}
          data-tone={needs ? 'needs' : 'working'}
          data-compact={compact || undefined}
          // Its name says it in full: "Conch: 2 tasks working, 1 needs you".
          aria-label={typeof children === 'string' ? `${children}: ${summary}` : summary}
        >
          <Pearl
            size={compact ? 'sm' : 'xs'}
            label={null}
            state={needs ? 'attention' : 'thinking'}
            glint={celebrate}
          />
          {!compact && <span className={styles.name}>{children}</span>}
          <span className={styles.count} aria-hidden>
            {tasks.length}
          </span>
        </Popover.Trigger>
        <Popover.Content
          padding="none"
          side="bottom"
          align="start"
          className={styles.panel}
          aria-label="In the background"
          // Into the first task, not onto Deny: Enter pressed twice opens, never refuses.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).querySelector<HTMLElement>('li a')?.focus();
          }}
        >
          <p className={styles.heading} aria-hidden>
            In the background
          </p>
          <ul className={styles.list}>
            {sorted.map((task, i) => (
              <li
                key={task.id}
                className={styles.row}
                data-status={task.status}
                style={{ '--i': i } as CSSProperties}
              >
                <TaskStatusMark status={task.status} className={styles.mark} />
                <span className={styles.text}>
                  <Popover.Close asChild>{task.link}</Popover.Close>
                  {(task.current || task.chat) && (
                    <span className={styles.meta}>
                      {task.current ?? task.chat}
                      {task.current && task.chat && (
                        <span className={styles.from}> · {task.chat}</span>
                      )}
                    </span>
                  )}
                  {task.asking && (
                    <span className={styles.actions}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={task.asking.onDeny}
                        disabled={task.asking.pending}
                      >
                        Deny
                      </Button>
                      <Button size="sm" onClick={task.asking.onAllow} loading={task.asking.pending}>
                        Allow
                      </Button>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Root>
    </span>
  );
}
