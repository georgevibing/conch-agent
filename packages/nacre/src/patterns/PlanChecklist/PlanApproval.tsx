import { Check, ChevronRight, ListChecks, Play, Undo2 } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { PlanStepMarker, type PlanChecklistStep } from './PlanChecklist';
import styles from './PlanApproval.module.css';

export type PlanApprovalState = 'asking' | 'started' | 'kept' | 'expired';

export interface PlanApprovalProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  /** The assistant's name: “Conch has a plan”. */
  name: string;
  /** The plan, as the assistant wrote it (rendered Markdown). */
  children?: ReactNode;
  /** Or its steps, when that's what there is. */
  steps?: readonly PlanChecklistStep[];
  /** `asking` until the person decides; then a quiet line that opens to the plan again. */
  state?: PlanApprovalState;
  /** Which button was just pressed, while the answer goes. */
  busy?: 'start' | 'keep';
  onStart?: () => void;
  /** Stay in plan mode and say what to change. */
  onKeepPlanning?: () => void;
  /** Said under the heading when the question needs a reason (the chat read something from outside). */
  note?: ReactNode;
  /** The Start button, for focusing it when the card arrives. */
  startRef?: Ref<HTMLButtonElement>;
}

const SETTLED: Record<Exclude<PlanApprovalState, 'asking'>, string> = {
  started: 'Started on the plan',
  kept: 'Kept planning',
  expired: 'The plan wasn’t started',
};

/** A long plan shows its start, fading out, with a button for the rest. */
function Written({ children, capped }: { children: ReactNode; capped: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [whole, setWhole] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !capped) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [capped]);
  const cut = capped && !whole;
  return (
    <>
      <div
        ref={ref}
        className={styles.plan}
        data-capped={cut || undefined}
        data-long={(cut && long) || undefined}
      >
        {children}
      </div>
      {capped && (long || whole) && (
        <button
          type="button"
          className={styles.whole}
          aria-expanded={whole}
          onClick={() => setWhole((v) => !v)}
        >
          {whole ? 'Show less' : 'Show the whole plan'}
        </button>
      )}
    </>
  );
}

function Plan({
  children,
  steps,
  capped = false,
}: Pick<PlanApprovalProps, 'children' | 'steps'> & { capped?: boolean }) {
  if (children) return <Written capped={capped}>{children}</Written>;
  if (!steps?.length) return null;
  return (
    <ol className={cx(styles.plan, styles.steps)}>
      {steps.map((step, i) => (
        <li key={i} className={styles.step}>
          <PlanStepMarker status="pending" />
          <span>{step.title}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Plan mode's one question (ADR 0055): the assistant has looked around and
 * written its plan, and nothing changes until the person says so. The plan
 * is drawn whole, in a card with **Start** and **Keep planning**; once
 * answered it folds to a quiet line that opens to the plan again.
 */
export function PlanApproval({
  name,
  children,
  steps,
  state = 'asking',
  busy,
  onStart,
  onKeepPlanning,
  note,
  startRef,
  className,
  ...props
}: PlanApprovalProps) {
  const headingId = useId();
  if (state !== 'asking') {
    return (
      <Collapsible.Root asChild>
        <section
          className={cx(styles.settled, className)}
          data-state-plan={state}
          aria-labelledby={headingId}
          {...props}
        >
          <Collapsible.Trigger className={styles.fold} data-lustre="">
            <span className={styles.settledIcon} aria-hidden>
              {state === 'started' ? <Check /> : state === 'kept' ? <Undo2 /> : <ListChecks />}
            </span>
            <span id={headingId} className={styles.foldText}>
              {SETTLED[state]}
            </span>
            <ChevronRight aria-hidden className={styles.chevron} />
          </Collapsible.Trigger>
          <Collapsible.Content className={styles.content}>
            <div className={styles.foldBody}>
              <Plan steps={steps}>{children}</Plan>
            </div>
          </Collapsible.Content>
        </section>
      </Collapsible.Root>
    );
  }
  return (
    <section
      className={cx(styles.card, className)}
      data-state-plan="asking"
      aria-labelledby={headingId}
      {...props}
    >
      <header className={styles.header}>
        <span className={styles.mark} aria-hidden>
          <ListChecks />
        </span>
        <div className={styles.words}>
          <h3 id={headingId} className={styles.title}>
            {name} has a plan
          </h3>
          <p className={styles.sub}>Nothing changes until you press Start.</p>
        </div>
      </header>
      {note}
      <Plan steps={steps} capped>
        {children}
      </Plan>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          leadingIcon={<Undo2 />}
          disabled={Boolean(busy)}
          loading={busy === 'keep'}
          onClick={onKeepPlanning}
        >
          Keep planning
        </Button>
        <Button
          ref={startRef}
          leadingIcon={<Play />}
          disabled={Boolean(busy)}
          loading={busy === 'start'}
          onClick={onStart}
        >
          Start
        </Button>
      </div>
    </section>
  );
}
