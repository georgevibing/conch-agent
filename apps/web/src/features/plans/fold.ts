import type { PlanStep } from '@conch/protocol';

import type { TranscriptItem } from '../../live/reducer';

type PlanItem = Extract<TranscriptItem, { kind: 'plan' }>;

/** Where the turn running now began: after the last message of yours, or the last turn's end. */
function turnStart(items: readonly TranscriptItem[]): number {
  return items.findLastIndex((i) => i.kind === 'user' || i.kind === 'turn-end');
}

/**
 * The plan after one more `plan` event (ADR 0055): one card per turn, where
 * the plan first appeared, kept current in place. A later turn's plan is a
 * card of its own.
 */
export function foldPlan(
  items: TranscriptItem[],
  event: { seq: number; steps: PlanStep[] },
): TranscriptItem[] {
  const from = turnStart(items);
  const at = items.findLastIndex((i, n) => n > from && i.kind === 'plan');
  if (at === -1) return [...items, { kind: 'plan', id: `plan-${event.seq}`, steps: event.steps }];
  const next = items.slice();
  next[at] = { ...(items[at] as PlanItem), steps: event.steps };
  return next;
}

/** The plans whose turn has ended: each folds to one line. */
export function endedPlans(items: readonly TranscriptItem[]): Set<string> {
  const ended = new Set<string>();
  let open: string[] = [];
  for (const item of items) {
    if (item.kind === 'plan') open.push(item.id);
    else if (item.kind === 'turn-end') {
      open.forEach((id) => ended.add(id));
      open = [];
    }
  }
  return ended;
}
