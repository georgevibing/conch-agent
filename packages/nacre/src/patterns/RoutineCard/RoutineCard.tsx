import {
  CalendarClock,
  Check,
  Coins,
  Gauge,
  Laptop,
  Pause,
  Repeat,
  Sparkles,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import { AgentAvatar } from '../AgentAvatar/AgentAvatar';
import type { AgentFace } from '../AgentAvatar/presets';
import { runStatusMeta, RunStatusBadge } from '../Routines/RunStatusBadge';
import { formatWhenInline } from '../Routines/time';
import type { RunStatusValue } from '../Routines/types';
import styles from './RoutineCard.module.css';

export type RoutineCardStatus = 'draft' | 'active' | 'paused' | 'completed' | 'deleted';

export interface RoutineCardLastRun {
  status: RunStatusValue;
  at: number;
  outcome?: string;
}

/** What a routine costs, in Conch's own words (“About $1.20 a month”). */
export interface RoutineCardCost {
  text: string;
  /** How it's paid for: picks the icon. */
  billing?: 'free' | 'plan' | 'metered';
}

const costIcons = {
  free: <Laptop aria-hidden />,
  plan: <Gauge aria-hidden />,
  metered: <Coins aria-hidden />,
};

export interface RoutineCardProps extends Omit<ComponentProps<'article'>, 'title' | 'onToggle'> {
  title: string;
  summary: string;
  /** Plain-language schedule, e.g. "Weekdays at 7:30 AM", or what starts it: "When Anna Smith emails you". */
  scheduleText: string;
  /**
   * For a routine that starts when something happens (ADR 0056): said instead of
   * the next run, e.g. "Free until something happens".
   */
  waitingText?: string;
  /** Its source can't look right now, in a sentence (signed out, a folder gone). */
  problem?: string;
  status: RoutineCardStatus;
  nextRunAt?: number;
  lastRun?: RoutineCardLastRun;
  /** What it costs, shown beside its schedule. */
  cost?: RoutineCardCost;
  /**
   * Who does it (ADR 0101), small beside its schedule: only worth saying for
   * an agent of its own, not the default one.
   */
  agent?: { name: string; avatar?: AgentFace | string };
  icon?: ReactNode;
  /** `list` for the Routines page, `proposal` for the inline card Claude drafts in a chat. */
  variant?: 'list' | 'proposal';
  onOpen?: () => void;
  onToggle?: (active: boolean) => void;
  onActivate?: () => void;
  /**
   * The proposal's first button, when turning it on needs one more choice
   * first (“Choose who”). “Turn on” by default.
   */
  activateLabel?: string;
  onTryNow?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  /** An action is in flight (disables buttons, shows progress on the primary one). */
  busy?: boolean;
  /** Reference time for relative phrases (tests/stories). */
  now?: number;
  /** Formats times ("8:00 PM" / "20:00"); defaults to the reader's locale. */
  locale?: string;
  timeZone?: string;
}

const attention = new Set<RunStatusValue>(['needs-you', 'failed']);

function LastRunLine({
  run,
  now,
  locale,
  timeZone,
}: {
  run: RoutineCardLastRun;
  now?: number;
  locale?: string;
  timeZone?: string;
}) {
  const meta = runStatusMeta[run.status];
  const when = formatWhenInline(run.at, { now, locale, timeZone });
  const needsAttention = attention.has(run.status);
  return (
    <p className={styles.lastRun} data-status={run.status}>
      {needsAttention ? (
        <RunStatusBadge status={run.status} />
      ) : (
        <span className={styles.lastIcon} data-tone={meta.tone} aria-hidden>
          {meta.icon}
        </span>
      )}
      <span className={styles.lastText}>
        {!needsAttention && <span className="nc-visually-hidden">{meta.label}: </span>}
        {run.outcome ?? meta.description}
        <span className={styles.dim}> · {when}</span>
      </span>
    </p>
  );
}

/** A routine at a glance — on the Routines page, or proposed inline in a chat. */
export function RoutineCard({
  title,
  summary,
  scheduleText,
  waitingText,
  problem,
  status,
  nextRunAt,
  lastRun,
  cost,
  agent,
  icon,
  variant = 'list',
  onOpen,
  onToggle,
  onActivate,
  activateLabel = 'Turn on',
  onTryNow,
  onEdit,
  onDismiss,
  busy,
  now,
  locale,
  timeZone,
  className,
  ...props
}: RoutineCardProps) {
  const titleId = useId();
  const nextText = nextRunAt ? formatWhenInline(nextRunAt, { now, locale, timeZone }) : undefined;

  if (variant === 'proposal') {
    const settled = status !== 'draft';
    return (
      <article
        aria-labelledby={titleId}
        data-variant="proposal"
        data-status={status}
        className={cx(styles.proposal, className)}
        data-lustre={status === 'draft' ? '' : undefined}
        {...props}
      >
        <header className={styles.kicker}>
          {status === 'draft' && (
            <>
              <Sparkles aria-hidden /> New routine
            </>
          )}
          {status === 'active' && (
            <>
              <Check aria-hidden /> Routine on
            </>
          )}
          {status === 'paused' && (
            <>
              <Pause aria-hidden /> Routine paused
            </>
          )}
          {status === 'completed' && (
            <>
              <Check aria-hidden /> Routine finished
            </>
          )}
          {status === 'deleted' && (
            <>
              <X aria-hidden /> Not created
            </>
          )}
        </header>
        <div className={styles.proposalBody}>
          <span className={styles.iconTile} aria-hidden>
            {icon ?? <Repeat />}
          </span>
          <div className={styles.text}>
            <h3 id={titleId} className={styles.title}>
              {title}
            </h3>
            {summary && status !== 'deleted' && <p className={styles.summary}>{summary}</p>}
            {status !== 'deleted' && (
              <p className={styles.schedule}>
                {waitingText ? <Zap aria-hidden /> : <CalendarClock aria-hidden />}
                <span>
                  {scheduleText}
                  {waitingText && status !== 'paused' && (
                    <span className={styles.dim}> · {waitingText}</span>
                  )}
                  {!waitingText && nextText && status !== 'paused' && (
                    <span className={styles.dim}>
                      {' '}
                      · {status === 'draft' ? 'first run' : 'next'} {nextText}
                    </span>
                  )}
                </span>
              </p>
            )}
            {cost && status !== 'deleted' && (
              <p className={cx(styles.schedule, styles.costLine)} data-cost={cost.billing}>
                {costIcons[cost.billing ?? 'metered']}
                <span>{cost.text}</span>
              </p>
            )}
          </div>
          {settled && status !== 'deleted' && onOpen && (
            <Button size="sm" variant="ghost" onClick={onOpen} className={styles.inlineOpen}>
              Open
            </Button>
          )}
        </div>

        {!settled && (
          <div className={styles.actions}>
            <Button
              size="sm"
              onClick={onActivate}
              loading={busy}
              leadingIcon={activateLabel === 'Turn on' ? <Check /> : undefined}
            >
              {activateLabel}
            </Button>
            {onTryNow && (
              <Button size="sm" variant="surface" onClick={onTryNow} disabled={busy}>
                Try it now
              </Button>
            )}
            <span className={styles.spacer} />
            {onEdit && (
              <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy}>
                Edit
              </Button>
            )}
            {onDismiss && (
              <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
                Not now
              </Button>
            )}
          </div>
        )}
      </article>
    );
  }

  const active = status === 'active';
  const needsAttention = (lastRun && attention.has(lastRun.status)) || (active && problem);
  return (
    <article
      aria-labelledby={titleId}
      data-variant="list"
      data-status={status}
      data-attention={
        active && problem ? 'needs-you' : needsAttention ? lastRun?.status : undefined
      }
      data-lustre=""
      className={cx(styles.card, className)}
      {...props}
    >
      <span className={styles.iconTile} aria-hidden>
        {icon ?? <Repeat />}
      </span>
      <div className={styles.text}>
        <h3 className={styles.title}>
          <button type="button" id={titleId} className={styles.open} onClick={onOpen}>
            {title}
          </button>
        </h3>
        {summary && <p className={cx(styles.summary, styles.clamp)}>{summary}</p>}
        <p className={styles.meta}>
          <span className={styles.chip}>
            {waitingText ? <Zap aria-hidden /> : <CalendarClock aria-hidden />}
            {scheduleText}
          </span>
          {cost && (
            <span className={styles.chip} data-cost={cost.billing}>
              {costIcons[cost.billing ?? 'metered']}
              {cost.text}
            </span>
          )}
          {agent && (
            <span className={styles.agent}>
              <AgentAvatar name={agent.name} avatar={agent.avatar} size="xs" decorative />
              <span className="nc-visually-hidden">Answered by </span>
              {agent.name}
            </span>
          )}
          <span className={styles.dim}>
            {status === 'paused'
              ? 'Paused'
              : status === 'completed'
                ? 'Finished'
                : status === 'draft'
                  ? 'Not turned on yet'
                  : waitingText
                    ? waitingText
                    : nextText
                      ? `Next run ${nextText}`
                      : null}
          </span>
        </p>
        {active && problem && (
          <p className={styles.problem}>
            <TriangleAlert aria-hidden />
            <span>{problem}</span>
          </p>
        )}
        {lastRun && <LastRunLine run={lastRun} now={now} locale={locale} timeZone={timeZone} />}
      </div>
      {onToggle && status !== 'completed' && (
        <div className={styles.toggle}>
          <Switch
            checked={active}
            onCheckedChange={(on) => onToggle(on)}
            aria-label={active ? `Pause ${title}` : `Turn on ${title}`}
            disabled={busy}
          />
        </div>
      )}
    </article>
  );
}
