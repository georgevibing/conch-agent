/**
 * Runs of tool calls told as stories (ADR 0103): one line that says what
 * happened, its steps in plain words underneath, the raw calls under those.
 * Pure and shared, so the gateway (which titles stories) and the chat (which
 * draws them) always cut them the same way.
 *
 * A run is cut by phase of the work: looking and changing code, checking it,
 * sending it off, the web, each app. Steps that only look after another one
 * (reading a running command's output, the plan) join the story they're in.
 * Cuts are made one step at a time from the steps before, so a story once
 * followed by another never changes: only the last one grows.
 */
import type { ActivityChip, ActivityEffect, ActivityFamily, ToolLabel } from './activity';
import { describeTool } from './activity-describe';
import { cutSteps } from './activity-stories/cut';
import { mergeEffects, stepEffects } from './activity-stories/effects';
import { fit, HEADLINE_MAX, headlineOf, weightOf } from './activity-stories/headline';
import {
  changesThings,
  isFailed,
  isLive,
  isNoiseStep,
  isSettled,
  retryKey,
  sameKey,
} from './activity-stories/steps';
import { stuckOf } from './activity-stories/stuck';
import type { ToolStatus } from './index';

export { groupEffects, stepEffects, EFFECT_ORDER } from './activity-stories/effects';
export type { EffectGroup } from './activity-stories/effects';
export { phaseOf, isNoiseStep } from './activity-stories/steps';
export type { StoryPhase } from './activity-stories/steps';

/** One tool call, as a story sees it. */
export interface StoryStep {
  id: string;
  name: string;
  input: unknown;
  status: ToolStatus;
  label: ToolLabel;
  startedAt: number;
  durationMs?: number;
}

export interface Story {
  /** Its first step's id: never changes as the story grows. */
  id: string;
  family: ActivityFamily;
  steps: StoryStep[];
  status: 'running' | 'done' | 'failed';
  /** The rules' headline: "Running the tests" while it runs, "Ran the tests" once done. */
  headline: string;
  outcome?: string;
  /** Sites, files and pictures it touched, once each. */
  chips: ActivityChip[];
  /** What it changed, merged ("Edited 3 files"). */
  effects: ActivityEffect[];
  /** Steps that did exactly what an earlier one did (the same page fetched twice), folded away. */
  repeats: number;
  /** Said when it's going round in circles: "The same command failed 3 times". */
  stuck?: string;
  startedAt: number;
  /** From its first step's start to its last step's end, once done. */
  durationMs?: number;
  /**
   * Ids of steps not worth a line of their own: repeats, and checks on a
   * running command or the plan. They stay with the raw calls.
   */
  quiet?: string[];
  /** When something failed and then worked: "Worked on the second try". */
  note?: string;
}

const MAX_CHIPS = 12;

/** Steps that did exactly what an earlier one did and worked again, with nothing changed in between. */
function repeatsOf(steps: readonly StoryStep[]): Set<string> {
  const seen = new Set<string>();
  const repeats = new Set<string>();
  for (const step of steps) {
    if (isNoiseStep(step)) continue;
    if (changesThings(step)) seen.clear();
    // Failures stay in sight: trying again is worth a line.
    if (step.status !== 'success' || isFailed(step)) continue;
    const key = sameKey(step);
    if (seen.has(key)) repeats.add(step.id);
    else seen.add(key);
  }
  return repeats;
}

function chipsOf(steps: readonly StoryStep[]): ActivityChip[] {
  const chips = new Map<string, ActivityChip>();
  for (const step of steps) {
    for (const chip of step.label.chips ?? []) {
      const key = chip.href ?? `${chip.kind}:${chip.label}`;
      if (!chips.has(key)) chips.set(key, chip);
    }
  }
  return [...chips.values()].slice(0, MAX_CHIPS);
}

const ORDINAL = ['second', 'third', 'fourth', 'fifth'];

/** Failures put right later in the story: how many tries the worst one took, and whether a fix came between. */
function retriesOf(steps: readonly StoryStep[]): { note?: string; recovered: Set<string> } {
  const failures = new Map<string, StoryStep[]>();
  const recovered = new Set<string>();
  let tries = 0;
  let fixed = false;
  steps.forEach((step, i) => {
    if (isNoiseStep(step) || !isSettled(step)) return;
    const key = retryKey(step);
    if (isFailed(step)) {
      failures.set(key, [...(failures.get(key) ?? []), step]);
      return;
    }
    const failed = failures.get(key);
    if (!failed) return;
    failures.delete(key);
    for (const f of failed) recovered.add(f.id);
    if (failed.length >= tries) {
      tries = failed.length;
      const from = steps.indexOf(failed[0] as StoryStep);
      fixed = steps.slice(from + 1, i).some((s) => s.label.family === 'edit');
    }
  });
  if (tries === 0) return { recovered };
  const ordinal = ORDINAL[tries - 1];
  const note = fixed
    ? 'Worked after a fix'
    : ordinal
      ? `Worked on the ${ordinal} try`
      : `Worked after ${tries} failed tries`;
  return { note, recovered };
}

function statusOf(
  steps: readonly StoryStep[],
  meaningful: readonly StoryStep[],
  recovered: ReadonlySet<string>,
): Story['status'] {
  if (steps.some(isLive)) return 'running';
  const checks = steps.filter((s) => s.label.family === 'verify');
  const lastCheck = checks[checks.length - 1];
  if (lastCheck && isFailed(lastCheck)) return 'failed';
  const counted = meaningful.length > 0 ? meaningful : steps;
  if (counted.length > 0 && counted.every(isFailed)) return 'failed';
  // Sending it off went wrong and nothing put it right.
  const last = counted[counted.length - 1];
  if (last && last.label.family === 'ship' && isFailed(last) && !recovered.has(last.id)) {
    return 'failed';
  }
  return 'done';
}

function familyOf(steps: readonly StoryStep[], meaningful: readonly StoryStep[]): ActivityFamily {
  const from = meaningful.length > 0 ? meaningful : steps;
  let best: ActivityFamily = from[0]?.label.family ?? 'other';
  // A check that holds its fixes is still a check.
  if (best === 'verify' && !from.some((s) => s.label.family === 'ship')) return best;
  for (const s of from) if (weightOf(s.label.family) > weightOf(best)) best = s.label.family;
  return best;
}

function last<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as T;
    if (test(item)) return item;
  }
  return undefined;
}

function outcomeOf(
  steps: readonly StoryStep[],
  visible: readonly StoryStep[],
  status: Story['status'],
  family: ActivityFamily,
): string | undefined {
  const has = (s: StoryStep) => !!s.label.outcome;
  let step: StoryStep | undefined;
  if (status === 'failed') {
    step = last(steps, (s) => isFailed(s) && has(s));
  } else {
    step =
      last(steps, (s) => s.label.family === 'verify' && has(s)) ??
      last(steps, (s) => s.label.family === 'ship' && has(s)) ??
      (visible.length === 1 && visible[0] && has(visible[0]) ? visible[0] : undefined) ??
      last(visible, (s) => s.label.family === family && has(s));
  }
  return step?.label.outcome ? fit(step.label.outcome, HEADLINE_MAX, false) : undefined;
}

function tell(steps: StoryStep[]): Story {
  const first = steps[0] as StoryStep;
  const repeats = repeatsOf(steps);
  const quiet = steps.filter((s) => isNoiseStep(s) || repeats.has(s.id)).map((s) => s.id);
  const meaningful = steps.filter((s) => !isNoiseStep(s));
  const visible = meaningful.filter((s) => !repeats.has(s.id));
  const { note, recovered } = retriesOf(steps);
  const status = statusOf(steps, meaningful, recovered);
  const family = familyOf(steps, meaningful);
  const focus = last(steps, isLive);
  // A story of only checks on a running command says what those checks say.
  const words = visible.length > 0 ? visible : steps.slice(-1);
  const headline = headlineOf(words, status === 'running' ? 'doing' : 'done', focus);
  const outcome = outcomeOf(steps, visible, status, family);
  const story: Story = {
    id: first.id,
    family,
    steps,
    status,
    headline,
    chips: chipsOf(steps),
    effects: mergeEffects(stepEffects(steps)),
    repeats: repeats.size,
    startedAt: first.startedAt,
  };
  if (outcome) story.outcome = outcome;
  const stuck = stuckOf(steps);
  if (stuck) story.stuck = stuck;
  if (quiet.length > 0) story.quiet = quiet;
  if (note && status !== 'failed') story.note = note;
  if (status !== 'running') {
    const end = Math.max(...steps.map((s) => s.startedAt + (s.durationMs ?? 0)));
    story.durationMs = Math.max(0, end - first.startedAt);
  }
  return story;
}

/**
 * One run of tool calls (what lies between two pieces of the assistant's
 * prose), told as stories: usually one to three. Each story's id is its first
 * step's; for any prefix of `steps`, every story but the last comes out the
 * same, and the last only grows.
 */
export function tellStories(steps: StoryStep[]): Story[] {
  return cutSteps(steps).map(tell);
}

/** What a whole turn changed, merged for its "What changed" list. See `groupEffects` for the card. */
export function turnEffects(steps: StoryStep[]): ActivityEffect[] {
  return mergeEffects(stepEffects(steps));
}

/** How many steps a story shows, once repeats and checks on running commands are folded away. */
export function storyStepCount(story: Pick<Story, 'steps' | 'quiet'>): number {
  return story.steps.length - (story.quiet?.length ?? 0);
}

/** The steps a story shows a line for, in order. */
export function storyVisibleSteps(story: Pick<Story, 'steps' | 'quiet'>): StoryStep[] {
  const quiet = new Set(story.quiet);
  return story.steps.filter((s) => !quiet.has(s.id));
}

/** A tool call as the chat or the gateway holds it. */
export interface ToolCallLike {
  id: string;
  name: string;
  input: unknown;
  status: ToolStatus;
  output?: string;
  durationMs?: number;
  startedAt: number;
  /** Its words, when the server already wrote them. */
  label?: ToolLabel;
  /** The `kind` of the view it returned, for the words of what it found. */
  viewKind?: string;
}

/** A story step from a tool call, with its words worked out when the call doesn't carry them. */
export function stepFromTool(call: ToolCallLike): StoryStep {
  const result = isSettled(call)
    ? { status: call.status, output: call.output, viewKind: call.viewKind }
    : undefined;
  const step: StoryStep = {
    id: call.id,
    name: call.name,
    input: call.input,
    status: call.status,
    label: call.label ?? describeTool(call.name, call.input, result),
    startedAt: call.startedAt,
  };
  if (call.durationMs !== undefined) step.durationMs = call.durationMs;
  return step;
}
