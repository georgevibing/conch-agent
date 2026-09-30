import {
  Check,
  ChevronRight,
  CircleAlert,
  Minus,
  Sparkles,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import { ago } from '../Healed/HealedNotes';
import styles from './RepairPanel.module.css';

export type RepairState = 'checking' | 'ok' | 'fixed' | 'warning' | 'needs-you' | 'off';

export interface RepairItem {
  id: string;
  /** "Providers" */
  group: string;
  /** "Claude Code" */
  title: string;
  state: RepairState;
  /** One plain sentence. */
  message: string;
  /** The one thing to do about it (a button), when only a person can. */
  action?: ReactNode;
}

export interface RepairPanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  items: RepairItem[];
  /** A look or a repair is running; rows fill in as each part answers. */
  running: boolean;
  /** The current (or last) run is a repair, not a look. */
  repairing: boolean;
  /** When the last run finished (0: never). */
  checkedAt: number;
  onRepair: () => void;
  onCheck: () => void;
  /** Formats "when"; defaults to a relative time. */
  formatTime?: (at: number) => string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Within a group, what needs you comes first. */
const rank: Record<RepairState, number> = {
  'needs-you': 0,
  warning: 1,
  fixed: 2,
  checking: 3,
  ok: 4,
  off: 5,
};

const icon: Record<RepairState, ReactNode> = {
  checking: <Spinner size="xs" label={null} />,
  ok: <Check />,
  fixed: <Sparkles />,
  warning: <TriangleAlert />,
  'needs-you': <CircleAlert />,
  off: <Minus />,
};

const spoken: Record<RepairState, string> = {
  checking: 'Checking',
  ok: 'Working',
  fixed: 'Fixed',
  warning: 'Worth a look',
  'needs-you': 'Needs you',
  off: 'Off',
};

/**
 * Repair everything: how every part of Conch is doing, in one sentence, and
 * the one button that fixes what can be fixed. While all is well it's a single
 * calm line; what needs you opens by itself, each with its one button. Rows
 * fill in live as each part answers.
 */
export function RepairPanel({
  items,
  running,
  repairing,
  checkedAt,
  onRepair,
  onCheck,
  formatTime = (at) => ago(at),
  className,
  ...props
}: RepairPanelProps) {
  const listId = useId();
  const needsYou = items.filter((i) => i.state === 'needs-you').length;
  const worth = items.filter((i) => i.state === 'warning').length;
  const fixed = items.filter((i) => i.state === 'fixed').length;
  const tone = running ? 'running' : needsYou ? 'attention' : worth ? 'warning' : 'good';
  const [open, setOpen] = useState(false);
  // Something needs you: the list is open, whatever it was.
  const expanded = open || needsYou > 0 || worth > 0 || running;

  const title = running
    ? repairing
      ? 'Repairing…'
      : 'Looking at everything…'
    : needsYou
      ? `${plural(needsYou, 'thing needs', 'things need')} you`
      : worth
        ? `${plural(worth, 'thing is', 'things are')} worth a look`
        : fixed
          ? `Fixed ${plural(fixed, 'thing')} — everything’s working`
          : 'Everything’s working';
  const subtitle = running
    ? 'This takes a few seconds.'
    : checkedAt
      ? `Checked ${formatTime(checkedAt)} · ${plural(items.length, 'part')}`
      : 'Not checked yet.';

  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <section className={cx(styles.panel, className)} data-tone={tone} {...props}>
      <div className={styles.summary}>
        <span className={styles.orb} aria-hidden>
          {running ? (
            <Spinner size="sm" label={null} />
          ) : needsYou || worth ? (
            <CircleAlert />
          ) : fixed ? (
            <Sparkles />
          ) : (
            <Check />
          )}
        </span>
        <div className={styles.words} role="status" aria-live="polite">
          <p className={styles.title}>{title}</p>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        <div className={styles.buttons}>
          <Button variant="ghost" size="sm" onClick={onCheck} disabled={running}>
            Check again
          </Button>
          <Button
            size="sm"
            variant={needsYou || worth ? 'solid' : 'surface'}
            leadingIcon={<Wrench />}
            onClick={onRepair}
            loading={running && repairing}
            disabled={running}
          >
            Repair everything
          </Button>
        </div>
      </div>

      {items.length > 0 && !needsYou && !worth && !running && (
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight aria-hidden className={styles.chevron} />
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}

      {expanded && (
        <div id={listId} className={styles.groups}>
          {groups.map((group) => (
            <div key={group} className={styles.group}>
              <p className={styles.groupTitle}>{group}</p>
              <ul className={styles.rows}>
                {items
                  .filter((i) => i.group === group)
                  .sort((a, b) => rank[a.state] - rank[b.state])
                  .map((item) => (
                    <li key={item.id} className={styles.row} data-state={item.state}>
                      <span className={styles.icon} aria-hidden>
                        {icon[item.state]}
                      </span>
                      <span className={styles.name}>
                        <span className="nc-visually-hidden">{spoken[item.state]}: </span>
                        {item.title}
                      </span>
                      <span className={styles.message}>{item.message}</span>
                      {item.action && <span className={styles.action}>{item.action}</span>}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
