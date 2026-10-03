import { GuardNote, PlanApproval, PlanChecklist } from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';

import type { TranscriptItem } from '../../live/reducer';
import { Markdown } from '../chat/Markdown';
import styles from './Plans.module.css';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

/**
 * The assistant's plan for this reply (ADR 0055), ticking itself off as it
 * works. Once the turn ends it folds to one line, “Plan · 5 of 5 done”.
 */
export function PlanItem({ item, ended }: { item: Of<'plan'>; ended: boolean }) {
  return (
    <PlanChecklist
      data-anchor={item.id}
      steps={item.steps}
      folded={ended}
      className={styles.plan}
    />
  );
}

/** Plan mode's question: the tool that asks to leave it (Claude Code's `ExitPlanMode`). */
export const isPlanApproval = (item: TranscriptItem) =>
  item.kind === 'permission' && item.toolName === 'ExitPlanMode';

/** The plan as the assistant wrote it, when the question carries it. */
function planText(input: unknown): string | undefined {
  const plan = (input as { plan?: unknown } | null)?.plan;
  return typeof plan === 'string' && plan.trim() ? plan : undefined;
}

/**
 * Plan mode (ADR 0055): the plan to approve, drawn whole, with **Start** and
 * **Keep planning**. Keep planning hands the message box back, for saying
 * what to change.
 */
export function PlanApprovalItem({
  item,
  name,
  steps,
  onRespond,
  focusComposer,
}: {
  item: Of<'permission'>;
  name: string;
  /** This turn's plan, for when the question doesn't carry one. */
  steps?: Of<'plan'>['steps'];
  onRespond: (decision: 'allow' | 'deny') => void;
  focusComposer?: () => void;
}) {
  const [busy, setBusy] = useState<'start' | 'keep'>();
  const startRef = useRef<HTMLButtonElement>(null);
  const asking = !item.decision;
  useEffect(() => {
    // Arriving is the turn's own news: Start is where a keyboard wants to be.
    if (asking)
      startRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }, [asking]);
  const text = planText(item.input);
  const state =
    item.decision === 'allow' || item.decision === 'allow-always'
      ? 'started'
      : item.decision === 'deny'
        ? 'kept'
        : item.decision === 'expired'
          ? 'expired'
          : 'asking';
  return (
    <PlanApproval
      data-anchor={item.id}
      name={name}
      state={state}
      busy={asking ? busy : undefined}
      steps={text ? undefined : steps}
      startRef={startRef}
      note={item.taint && <GuardNote>{item.taint}</GuardNote>}
      onStart={() => {
        setBusy('start');
        onRespond('allow');
      }}
      onKeepPlanning={() => {
        setBusy('keep');
        onRespond('deny');
        focusComposer?.();
      }}
      className={styles.approval}
    >
      {text && <Markdown text={text} />}
    </PlanApproval>
  );
}
