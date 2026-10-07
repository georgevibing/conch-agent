/**
 * Where one story ends and the next begins. Decided one step at a time, from
 * the names, inputs and families of the steps before it only, never their
 * status (which changes as parallel calls finish), so a story once followed by
 * another is never cut again: the gateway titles stories as they close.
 */
import type { StoryStep } from '../activity-stories';
import { isNoiseStep, phaseKey } from './steps';

/** Runs this short are always one story. */
const TINY = 2;
/** A story of `work` this long ends where a new round of looking begins. */
const LONG_WORK = 15;
/** No story grows past this many meaningful steps. */
const LONGEST = 30;
/** How many changes join a check (fixing what it found, or change and check again) before they're new work. */
const EDITS_AFTER_CHECK = 4;

interface Cut {
  steps: StoryStep[];
  /** The phase it's in, set by its first meaningful step; `null` while it's only noise. */
  phase: string | null;
  meaningful: number;
  /** A check that also holds the work it checks. */
  hasWork: boolean;
  workSinceVerify: number;
  lastFamily?: string;
}

function startCut(): Cut {
  return {
    steps: [],
    phase: null,
    meaningful: 0,
    hasWork: false,
    workSinceVerify: 0,
  };
}

/** Whether `step` (at `index` in the run) carries on `cut`, and the phase `cut` is in after. */
function carriesOn(cut: Cut, step: StoryStep, index: number): { joins: boolean; phase?: string } {
  if (isNoiseStep(step)) return { joins: true };
  const key = phaseKey(step);
  const family = step.label.family;
  if (cut.phase === null) return { joins: true, phase: key };
  if (index < TINY) return { joins: true, phase: key === 'other' ? cut.phase : key };
  if (cut.meaningful >= LONGEST) return { joins: false };
  if (key === 'other') return { joins: true };
  if (cut.phase === 'other') return { joins: true, phase: key };
  if (key === cut.phase) {
    if (
      key === 'work' &&
      cut.meaningful >= LONG_WORK &&
      family === 'explore' &&
      cut.lastFamily === 'edit'
    ) {
      return { joins: false };
    }
    return { joins: true };
  }
  // A quick look and a change, then a check: one story of trying it.
  if (cut.phase === 'work' && key === 'verify' && cut.meaningful <= TINY) {
    return { joins: true, phase: 'verify' };
  }
  // Changes right after a check belong to it: fixing what it found, or change
  // and check again. A new round of looking starts new work. Never read from a
  // status: parallel calls finish out of order, and cuts must not move.
  if (
    cut.phase === 'verify' &&
    key === 'work' &&
    family === 'edit' &&
    cut.workSinceVerify < EDITS_AFTER_CHECK
  ) {
    return { joins: true };
  }
  return { joins: false };
}

function add(cut: Cut, step: StoryStep, phase: string | undefined): void {
  const wasPhase = cut.phase;
  cut.steps.push(step);
  if (phase !== undefined) cut.phase = phase;
  if (step.label.family === 'verify') cut.workSinceVerify = 0;
  if (isNoiseStep(step)) return;
  cut.meaningful += 1;
  cut.lastFamily = step.label.family;
  const key = phaseKey(step);
  if (key === 'work') {
    cut.hasWork = true;
    if (cut.phase === 'verify') cut.workSinceVerify += 1;
  }
  if (wasPhase === 'work' && cut.phase === 'verify') cut.hasWork = true;
}

/** One run of tool calls, cut into the steps of each story. */
export function cutSteps(steps: readonly StoryStep[]): StoryStep[][] {
  const cuts: Cut[] = [];
  let current: Cut | undefined;
  steps.forEach((step, index) => {
    if (current) {
      const { joins, phase } = carriesOn(current, step, index);
      if (joins) {
        add(current, step, phase);
        return;
      }
    }
    current = startCut();
    cuts.push(current);
    add(current, step, isNoiseStep(step) ? undefined : phaseKey(step));
  });
  return cuts.map((c) => c.steps);
}
