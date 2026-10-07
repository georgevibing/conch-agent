import {
  Check,
  ChevronRight,
  CircleAlert,
  Info,
  Minus,
  Sparkles,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Collapsible } from '../../components/Collapsible';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import { ago } from '../Healed/HealedNotes';
import styles from './RepairPanel.module.css';

/**
 * `info` is news, not a problem (a new release), and `off` is a choice: neither
 * ever counts as something to fix. Only `warning` and `needs-you` do.
 */
export type RepairState = 'checking' | 'ok' | 'fixed' | 'info' | 'warning' | 'needs-you' | 'off';

export interface RepairItem {
  id: string;
  /** "Apps": items of one group fold together under one line. */
  group: string;
  /** "Claude Code" */
  title: string;
  state: RepairState;
  /** One plain sentence. */
  message: string;
  /** The one thing to do about it (a button). Shown beside it, whatever its state. */
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
  /**
   * The groups a person opened or closed themselves (`true`: open). Groups not
   * in it follow their state: open when something in them needs you. Leave it
   * out and the panel keeps it itself.
   */
  opened?: Record<string, boolean>;
  onOpenedChange?: (opened: Record<string, boolean>) => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What needs you comes first, in a group and among groups. */
const rank: Record<RepairState, number> = {
  'needs-you': 0,
  warning: 1,
  checking: 2,
  fixed: 3,
  info: 4,
  ok: 5,
  off: 6,
};

const icon: Record<RepairState, ReactNode> = {
  checking: <Spinner size="xs" label={null} />,
  ok: <Check />,
  fixed: <Sparkles />,
  info: <Info />,
  warning: <TriangleAlert />,
  'needs-you': <CircleAlert />,
  off: <Minus />,
};

const spoken: Record<RepairState, string> = {
  checking: 'Checking',
  ok: 'Working',
  fixed: 'Fixed',
  info: 'News',
  warning: 'To look at',
  'needs-you': 'Needs you',
  off: 'Off',
};

const isIssue = (state: RepairState) => state === 'needs-you' || state === 'warning';

interface Group {
  name: string;
  items: RepairItem[];
  /** The state its line wears: the one that matters most. */
  worst: RepairState;
  issues: number;
  summary: string;
}

function count(items: RepairItem[], state: RepairState) {
  return items.filter((i) => i.state === state).length;
}

/** A group's few words: what needs you, else how much is working. */
function summarise(items: RepairItem[]): string {
  const needsYou = count(items, 'needs-you');
  const warning = count(items, 'warning');
  const checking = count(items, 'checking');
  const fixed = count(items, 'fixed');
  const news = count(items, 'info');
  const off = count(items, 'off');
  const working = items.length - needsYou - warning - checking - fixed - news - off;
  const issues = [
    needsYou && (needsYou === 1 ? '1 needs you' : `${needsYou} need you`),
    warning && `${warning} to look at`,
  ].filter(Boolean);
  if (issues.length) return issues.join(' · ');
  if (checking) return 'Checking…';
  const well = [
    fixed && `${fixed} fixed`,
    working && `${working} working`,
    news && `${news} new`,
  ].filter(Boolean);
  if (well.length) return well.join(' · ');
  return off === 1 ? 'Off' : `${off} off`;
}

function grouped(items: RepairItem[]): Group[] {
  const names = [...new Set(items.map((i) => i.group))];
  return names
    .map((name, order) => {
      const mine = items
        .filter((i) => i.group === name)
        .sort((a, b) => rank[a.state] - rank[b.state]);
      const worst = mine[0]?.state ?? 'ok';
      const issues = mine.filter((i) => isIssue(i.state)).length;
      return { name, items: mine, worst, issues, summary: summarise(mine), order };
    })
    .sort((a, b) => Number(b.issues > 0) - Number(a.issues > 0) || a.order - b.order);
}

function GroupRow({
  group,
  open,
  onOpenChange,
}: {
  group: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={styles.group}>
      <Collapsible.Trigger asChild>
        <button type="button" id={`${id}-head`} className={styles.head}>
          <span className={styles.icon} data-state={group.worst} aria-hidden>
            {icon[group.worst]}
          </span>
          <span className={styles.groupName}>{group.name}</span>
          <span className={styles.groupSummary}>{group.summary}</span>
          <ChevronRight aria-hidden className={styles.chevron} />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content role="region" aria-labelledby={`${id}-head`}>
        <ul className={styles.rows}>
          {group.items.map((item) => (
            <li key={item.id} className={styles.row} data-state={item.state}>
              <span className={styles.icon} data-state={item.state} aria-hidden>
                {icon[item.state]}
              </span>
              <span className={styles.text}>
                <span className={styles.name}>
                  <span className="nc-visually-hidden">{spoken[item.state]}: </span>
                  {item.title}
                </span>
                <span className={styles.message}>{item.message}</span>
              </span>
              {item.action && <span className={styles.action}>{item.action}</span>}
            </li>
          ))}
        </ul>
      </Collapsible.Content>
    </Collapsible>
  );
}

/**
 * Repair everything: how every part of Conch is doing, in one line, and the
 * one button that fixes what can be fixed. Below it each group is one line —
 * its name, how it's doing and the mark that matters most — folded while all
 * is well and open when something in it needs you. Rows fill in live as each
 * part answers.
 */
export function RepairPanel({
  items,
  running,
  repairing,
  checkedAt,
  onRepair,
  onCheck,
  formatTime = (at) => ago(at),
  opened: openedProp,
  onOpenedChange,
  className,
  ...props
}: RepairPanelProps) {
  const [openedOwn, setOpenedOwn] = useState<Record<string, boolean>>({});
  const opened = openedProp ?? openedOwn;
  const needsYou = count(items, 'needs-you');
  const worth = count(items, 'warning');
  const issues = needsYou + worth;
  const fixed = count(items, 'fixed');
  const news = count(items, 'info');
  const tone = running ? 'running' : issues ? 'attention' : 'good';

  const title = running
    ? repairing
      ? 'Repairing…'
      : 'Looking at everything…'
    : needsYou
      ? `${plural(issues, 'thing needs', 'things need')} you`
      : worth
        ? `${plural(worth, 'thing', 'things')} to look at`
        : fixed
          ? `Fixed ${plural(fixed, 'thing')} — everything’s working`
          : 'Everything’s working';
  const subtitle = running
    ? 'This takes a few seconds.'
    : checkedAt
      ? `Checked ${formatTime(checkedAt)}${news ? ` · ${plural(news, 'piece', 'pieces')} of news` : ''}`
      : 'Not checked yet.';

  const groups = grouped(items);
  const toggle = (name: string, open: boolean) => {
    const next = { ...opened, [name]: open };
    if (!openedProp) setOpenedOwn(next);
    onOpenedChange?.(next);
  };

  return (
    <section className={cx(styles.panel, className)} data-tone={tone} {...props}>
      <div className={styles.summary}>
        <span className={styles.orb} aria-hidden>
          {running ? (
            <Spinner size="sm" label={null} />
          ) : issues ? (
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
            variant={issues && !running ? 'solid' : 'ghost'}
            leadingIcon={<Wrench />}
            onClick={onRepair}
            loading={running && repairing}
            disabled={running}
          >
            Repair everything
          </Button>
        </div>
      </div>

      {groups.length > 0 && (
        <div className={styles.groups}>
          {groups.map((group) => (
            <GroupRow
              key={group.name}
              group={group}
              open={opened[group.name] ?? group.issues > 0}
              onOpenChange={(open) => toggle(group.name, open)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
