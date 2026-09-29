import { CalendarClock, Check, Pause, Repeat, Sparkles, X } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
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

export interface RoutineCardProps extends Omit<ComponentProps<'article'>, 'title' | 'onToggle'> {
  title: string;
  summary: string;
  /** Plain-language schedule, e.g. "Weekdays at 7:30 AM". */
  scheduleText: string;
  status: RoutineCardStatus;
  nextRunAt?: number;
  lastRun?: RoutineCardLastRun;
  icon?: ReactNode;
  /** `list` for the Routines page, `proposal` for the inline card Claude drafts in a chat. */
  variant?: 'list' | 'proposal';
  onOpen?: () => void;
  onToggle?: (active: boolean) => void;
  onActivate?: () => void;
  onTryNow?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  /** An action is in flight (disables buttons, shows progress on the primary one). */
  busy?: boolean;
  /** Reference time for relative phrases (tests/stories). */
  now?: number;
  timeZone?: string;
}

const attention = new Set<RunStatusValue>(['needs-you', 'failed']);

function LastRunLine({
  run,
  now,
  timeZone,
}: {
  run: RoutineCardLastRun;
  now?: number;
  timeZone?: string;
}) {
  const meta = runStatusMeta[run.status];
  const when = formatWhenInline(run.at, { now, timeZone });
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
  status,
  nextRunAt,
  lastRun,
  icon,
  variant = 'list',
  onOpen,
  onToggle,
  onActivate,
  onTryNow,
  onEdit,
  onDismiss,
  busy,
  now,
  timeZone,
  className,
  ...props
}: RoutineCardProps) {
  const titleId = useId();
  const nextText = nextRunAt ? formatWhenInline(nextRunAt, { now, timeZone }) : undefined;

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
                <CalendarClock aria-hidden />
                <span>
                  {scheduleText}
                  {nextText && status !== 'paused' && (
                    <span className={styles.dim}>
                      {' '}
                      · {status === 'draft' ? 'first run' : 'next'} {nextText}
                    </span>
                  )}
                </span>
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
            <Button size="sm" onClick={onActivate} loading={busy} leadingIcon={<Check />}>
              Turn on
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
  const needsAttention = lastRun && attention.has(lastRun.status);
  return (
    <article
      aria-labelledby={titleId}
      data-variant="list"
      data-status={status}
      data-attention={needsAttention ? lastRun.status : undefined}
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
            <CalendarClock aria-hidden />
            {scheduleText}
          </span>
          <span className={styles.dim}>
            {status === 'paused'
              ? 'Paused'
              : status === 'completed'
                ? 'Finished'
                : status === 'draft'
                  ? 'Not turned on yet'
                  : nextText
                    ? `Next run ${nextText}`
                    : null}
          </span>
        </p>
        {lastRun && <LastRunLine run={lastRun} now={now} timeZone={timeZone} />}
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
