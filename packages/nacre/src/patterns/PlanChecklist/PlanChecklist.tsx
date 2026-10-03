import { ChevronRight, ListChecks } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { useId, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './PlanChecklist.module.css';

export type PlanStepState = 'pending' | 'active' | 'done';

export interface PlanChecklistStep {
  /** What the step does: “Run the tests”. While it's active, what it's doing: “Running the tests”. */
  title: string;
  status: PlanStepState;
}

const spoken: Record<PlanStepState, string> = {
  done: 'Done',
  active: 'Now',
  pending: 'Next',
};

/** “2 of 5”. */
export function planProgress(steps: readonly PlanChecklistStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.status === 'done').length, total: steps.length };
}

/**
 * Which steps a long plan shows: `limit` of them around where the work is
 * (the active step, else the next one, else the end), with a step done just
 * before it so you can see it tick. Short plans show everything.
 */
export function planWindow(
  steps: readonly PlanChecklistStep[],
  limit: number,
): { start: number; end: number } {
  if (steps.length <= limit) return { start: 0, end: steps.length };
  const active = steps.findIndex((s) => s.status === 'active');
  const next = steps.findIndex((s) => s.status === 'pending');
  const focus = active !== -1 ? active : next !== -1 ? next : steps.length - 1;
  const start = Math.max(0, Math.min(focus - 1, steps.length - limit));
  return { start, end: start + limit };
}

/** A step's marker: a hollow ring to come, a breathing ring now, a check drawn in when done. */
export function PlanStepMarker({
  status,
  fresh,
  className,
}: {
  status: PlanStepState;
  /** It's just been ticked off here: the check draws itself in. */
  fresh?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(styles.marker, className)}
      data-status={status}
      data-fresh={fresh || undefined}
      aria-hidden
    >
      {status === 'done' && (
        <svg viewBox="0 0 16 16" className={styles.check}>
          <path d="M4.5 8.4 7 10.8l4.6-5.3" pathLength={1} />
        </svg>
      )}
    </span>
  );
}

function Steps({
  steps,
  fresh,
  start = 0,
  end = steps.length,
  id,
}: {
  steps: readonly PlanChecklistStep[];
  fresh: ReadonlySet<number>;
  start?: number;
  end?: number;
  id?: string;
}) {
  return (
    <ol className={styles.steps} id={id} start={start + 1}>
      {steps.slice(start, end).map((step, n) => {
        const i = start + n;
        return (
          <li
            key={i}
            className={styles.step}
            data-status={step.status}
            aria-current={step.status === 'active' ? 'step' : undefined}
            style={{ '--pc-i': n } as CSSProperties}
          >
            <PlanStepMarker status={step.status} fresh={fresh.has(i)} />
            <span className={styles.title}>
              <span className="nc-visually-hidden">{spoken[step.status]}: </span>
              {step.title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The steps ticked off since the last update, by place: theirs is the check
 * that draws itself in. What was already done when the plan first showed (a
 * reload, history) just sits there.
 */
function useFresh(steps: readonly PlanChecklistStep[]): ReadonlySet<number> {
  const [seen, setSeen] = useState(() => ({ steps, fresh: new Set<number>() }));
  if (seen.steps !== steps) {
    const fresh = new Set<number>();
    steps.forEach((step, i) => {
      const before = seen.steps[i];
      if (step.status === 'done' && before && before.status !== 'done') fresh.add(i);
    });
    setSeen({ steps, fresh });
    return fresh;
  }
  return seen.fresh;
}

export interface PlanChecklistProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  steps: readonly PlanChecklistStep[];
  /**
   * The turn ended: the plan folds to one line (“Plan · 5 of 5 done”) that
   * opens on a press. Uncontrolled unless `open` is given.
   */
  folded?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Steps a long plan shows around where the work is, before “Show all”. */
  limit?: number;
  /** The heading: “Plan”. */
  title?: ReactNode;
}

/**
 * The assistant's plan for this reply, ticking itself off as it works (ADR
 * 0055). A calm card in the reply's flow: a heading with how far along it is,
 * a thin line that fills, and the steps — done ones checked and stepped back,
 * the one being done in full colour with a slow breath on its marker, the
 * rest waiting as hollow rings. A step that finishes draws its check in. A
 * long plan shows the steps around the work, with “Show all”. When the reply
 * ends, it folds to one quiet line that opens again on a press.
 */
export function PlanChecklist({
  steps,
  folded = false,
  open,
  defaultOpen = false,
  onOpenChange,
  limit = 6,
  title = 'Plan',
  className,
  ...props
}: PlanChecklistProps) {
  const listId = useId();
  const headingId = useId();
  const fresh = useFresh(steps);
  const [all, setAll] = useState(false);
  const { done, total } = planProgress(steps);
  const finished = total > 0 && done === total;
  const progress = `${done} of ${total}`;
  const line = (
    <span className={styles.line} aria-hidden>
      <span
        className={styles.fill}
        style={{ '--pc-progress': total ? done / total : 0 } as CSSProperties}
      />
    </span>
  );

  if (folded) {
    return (
      <Collapsible.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} asChild>
        <section
          className={cx(styles.root, className)}
          data-state-plan="folded"
          data-finished={finished || undefined}
          aria-labelledby={headingId}
          {...props}
        >
          <Collapsible.Trigger className={styles.fold} data-lustre="">
            <PlanStepMarker status={finished ? 'done' : 'pending'} className={styles.foldMarker} />
            <span id={headingId} className={styles.foldText}>
              <span className={styles.heading}>{title}</span> <span className={styles.dot}>·</span>{' '}
              <span className={styles.count}>{`${progress} done`}</span>
            </span>
            <ChevronRight aria-hidden className={styles.chevron} />
          </Collapsible.Trigger>
          <Collapsible.Content className={styles.content}>
            <div className={styles.body}>
              <Steps steps={steps} fresh={fresh} />
            </div>
          </Collapsible.Content>
        </section>
      </Collapsible.Root>
    );
  }

  const { start, end } = all ? { start: 0, end: total } : planWindow(steps, limit);
  const hidden = total - (end - start);
  return (
    <section
      className={cx(styles.root, className)}
      data-state-plan="working"
      data-finished={finished || undefined}
      aria-labelledby={headingId}
      {...props}
    >
      <header className={styles.header}>
        <ListChecks aria-hidden className={styles.icon} />
        <h3 id={headingId} className={styles.heading}>
          {title}
          <span className="nc-visually-hidden">, {`${progress} done`}</span>
        </h3>
        <span className={styles.count} aria-hidden>
          {progress}
        </span>
      </header>
      {line}
      <div className={styles.body}>
        {start > 0 && (
          <p className={styles.more} aria-hidden>
            {start === 1 ? '1 step before' : `${start} steps before`}
          </p>
        )}
        <Steps steps={steps} fresh={fresh} start={start} end={end} id={listId} />
        {(hidden > 0 || all) && total > limit && (
          <button
            type="button"
            className={styles.showAll}
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
          >
            {all ? 'Show less' : `Show all ${total}`}
          </button>
        )}
      </div>
    </section>
  );
}
