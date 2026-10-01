import {
  AppWindow,
  Brain,
  ChartColumn,
  Check,
  Clock,
  FilePen,
  Globe,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  X,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Activity.module.css';

export type ActivityRowKind =
  'command' | 'file' | 'web' | 'app' | 'approval' | 'read' | 'memory' | 'artifact';
export type ActivityRowStatus = 'done' | 'failed' | 'allowed' | 'denied' | 'waiting' | 'noted';

export interface ActivityRow {
  id: string;
  kind: ActivityRowKind;
  status: ActivityRowStatus;
  /** "Ran `npm test`", with code already marked up. */
  title: ReactNode;
  /** "9:41 AM". */
  time: string;
  /** The chat it happened in: "Fix the build". */
  where: ReactNode;
  /** One thing to do about it, beside the row: Undo, Redo, Forget (ADR 0030). */
  action?: ReactNode;
}

export interface ActivityTimelineProps extends Omit<ComponentProps<'div'>, 'children'> {
  groups: { label: string; rows: ActivityRow[] }[];
  /** Open the chat at that moment. */
  onOpen?: (row: ActivityRow) => void;
}

const ICONS: Record<ActivityRowKind, typeof Globe> = {
  command: SquareTerminal,
  file: FilePen,
  web: Globe,
  app: AppWindow,
  approval: ShieldCheck,
  read: ShieldAlert,
  memory: Brain,
  artifact: ChartColumn,
};

const SPOKEN: Record<ActivityRowStatus, string> = {
  done: 'Done',
  failed: 'Didn’t work',
  allowed: 'You allowed it',
  denied: 'Not allowed',
  waiting: 'Waiting for you',
  noted: 'Noted',
};

/**
 * Everything the assistant did, newest first, a day at a time (ADR 0028):
 * what, when, in which chat, and how it went. Each row opens the chat at
 * that moment. Read like a bank statement: calm, complete, nothing hidden.
 */
export function ActivityTimeline({ groups, onOpen, className, ...props }: ActivityTimelineProps) {
  return (
    <div className={cx(styles.timeline, className)} {...props}>
      {groups.map((group) => (
        <section key={group.label} className={styles.day} aria-label={group.label}>
          <h3 className={styles.dayLabel}>{group.label}</h3>
          <ul className={styles.rows}>
            {group.rows.map((row) => {
              const Icon = ICONS[row.kind];
              const mark =
                row.status === 'failed' || row.status === 'denied' ? (
                  <X aria-hidden />
                ) : row.status === 'waiting' ? (
                  <Clock aria-hidden />
                ) : row.status === 'noted' ? null : (
                  <Check aria-hidden />
                );
              return (
                <li key={row.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    data-kind={row.kind}
                    data-status={row.status}
                    onClick={() => onOpen?.(row)}
                  >
                    <span className={styles.icon} aria-hidden>
                      <Icon />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.title}>{row.title}</span>
                      <span className={styles.meta}>
                        {row.time} · {row.where}
                      </span>
                    </span>
                    <span className={styles.status} data-status={row.status}>
                      {mark}
                      <span className={styles.statusText}>{SPOKEN[row.status]}</span>
                    </span>
                  </button>
                  {row.action && <span className={styles.action}>{row.action}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
