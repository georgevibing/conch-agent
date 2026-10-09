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
import { count, quote } from './activity-describe/words';
import { cutSteps } from './activity-stories/cut';
import { mergeEffects, stepEffects } from './activity-stories/effects';
import {
  fit,
  HEADLINE_MAX,
  isTestsStep,
  tellHeadline,
  weightOf,
} from './activity-stories/headline';
import {
  changesThings,
  isFailed,
  isLive,
  isNoiseStep,
  isSettled,
  retryKey,
  sameKey,
  settleRuns,
} from './activity-stories/steps';
import { stuckReading } from './activity-stories/stuck';
import type { ToolApproval, ToolStatus } from './index';

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
  /** It asked first and didn't run: you said no, a rule did, or nobody answered. */
  declined?: boolean;
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
  /** `stuck` is only slow waiting (checked again and again, nothing new): said calmly, not as a warning. */
  stuckCalm?: boolean;
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

/** A check that holds its fixes is still a check: it starts with one, and nothing is sent off. */
function verifyLedOf(meaningful: readonly StoryStep[]): boolean {
  return (
    meaningful[0]?.label.family === 'verify' && !meaningful.some((s) => s.label.family === 'ship')
  );
}

/** The story's family: the one its headline leads with, else the weightiest of its steps. */
function familyOf(steps: readonly StoryStep[], lead: readonly StoryStep[]): ActivityFamily {
  if (lead[0]) return lead[0].label.family;
  let best: ActivityFamily = steps[0]?.label.family ?? 'other';
  for (const s of steps) if (weightOf(s.label.family) > weightOf(best)) best = s.label.family;
  return best;
}

function last<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as T;
    if (test(item)) return item;
  }
  return undefined;
}

/** "+12 −3", "4 lines": what one change came to, in lines added and removed. */
function linesOf(outcome: string | undefined): [number, number] | undefined {
  const n = (text: string | undefined) => Number((text ?? '0').replace(/,/g, ''));
  const lines = /^([\d,]+) lines?$/.exec(outcome ?? '');
  if (lines) return [n(lines[1]), 0];
  const change = /^(?:\+([\d,]+))?\s?(?:−([\d,]+))?$/.exec(outcome ?? '');
  return change && (change[1] || change[2]) ? [n(change[1]), n(change[2])] : undefined;
}

/** Changes to several files said together, "+14 −3", when each said its lines. */
function changesOutcome(edits: readonly StoryStep[]): string | undefined {
  const files = new Set(edits.map((s) => s.label.subject));
  if (files.size <= 1) return last(edits, (s) => !!s.label.outcome)?.label.outcome;
  let added = 0;
  let removed = 0;
  for (const s of edits) {
    const lines = linesOf(s.label.outcome);
    if (!lines) return undefined;
    added += lines[0];
    removed += lines[1];
  }
  if (!added && !removed) return undefined;
  if (!removed) return `+${count(added)}`;
  if (!added) return `−${count(removed)}`;
  return `+${count(added)} −${count(removed)}`;
}

/** What the commit said, from its effect: “fix the login”. */
function commitMessage(steps: readonly StoryStep[]): string | undefined {
  for (const s of [...steps].reverse())
    for (const e of s.label.effects ?? [])
      if (e.kind === 'commit') {
        const m = /“(.+)”/.exec(e.text);
        if (m?.[1]) return quote(m[1].replace(/…$/, ''), HEADLINE_MAX - 2);
      }
  return undefined;
}

/**
 * What the story came to, from the steps its headline names: what a check
 * found (the tests first), where a push went (else what the commit said), the
 * lines a change came to. A failed story says what went wrong.
 */
function outcomeOf(
  steps: readonly StoryStep[],
  visible: readonly StoryStep[],
  status: Story['status'],
  headline: { lead: readonly StoryStep[]; also?: readonly StoryStep[] },
): string | undefined {
  const has = (s: StoryStep) => !!s.label.outcome;
  const { lead } = headline;
  const family = lead[0]?.label.family;
  const named = [...lead, ...(headline.also ?? [])];
  let text: string | undefined;
  if (status === 'failed') {
    text = last(steps, (s) => isFailed(s) && has(s))?.label.outcome;
  } else if (named.some((s) => s.label.family === 'verify')) {
    // A check it names is what it came to: "Edited 3 files and ran the type check · No errors".
    const checks = named.filter((s) => s.label.family === 'verify' && has(s));
    text = (last(checks, isTestsStep) ?? checks[checks.length - 1])?.label.outcome;
  } else if (family === 'edit') {
    text = changesOutcome(lead);
  } else if (family === 'ship') {
    text = last(lead, has)?.label.outcome ?? commitMessage(steps);
  } else {
    // Only the lead's own: "41 files" from a listing isn't what "Read 3 files" came to.
    text =
      last(lead, has)?.label.outcome ??
      (visible.length === 1 ? visible[0]?.label.outcome : undefined);
  }
  return text ? fit(text, HEADLINE_MAX, false) : undefined;
}

function tell(cut: StoryStep[]): Story {
  // A command started and checked on until it ended reads as the run it was.
  const steps = settleRuns(cut);
  const first = steps[0] as StoryStep;
  const repeats = repeatsOf(steps);
  const quiet = steps.filter((s) => isNoiseStep(s) || repeats.has(s.id)).map((s) => s.id);
  const meaningful = steps.filter((s) => !isNoiseStep(s));
  const visible = meaningful.filter((s) => !repeats.has(s.id));
  const { note, recovered } = retriesOf(steps);
  const status = statusOf(steps, meaningful, recovered);
  const focus = last(steps, isLive);
  // A story of only checks on a running command says what those checks say.
  const words = visible.length > 0 ? visible : steps.slice(-1);
  const verifyLed = verifyLedOf(meaningful);
  const told = tellHeadline(words, 'done', { verifyLed });
  // Its family is what it's about as a whole, so it doesn't change with the step at hand.
  const family = familyOf(meaningful.length > 0 ? meaningful : steps, told.lead);
  const headline =
    status === 'running'
      ? tellHeadline(words, 'doing', { ...(focus && { focus }), verifyLed }).text
      : told.text;
  const outcome = outcomeOf(steps, visible, status, told);
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
  const stuck = stuckReading(steps);
  if (stuck) {
    story.stuck = stuck.text;
    if (stuck.tone === 'calm') story.stuckCalm = true;
  }
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
  /** It asked first, or a rule stopped it: how that went (ADR 0028). */
  approval?: ToolApproval;
}

/** Answers that mean a call never ran. */
const NEVER_RAN = new Set<ToolApproval>(['declined', 'refused', 'expired']);

/**
 * A story step from a tool call, with its words worked out when the call
 * doesn't carry them. A call that never ran (you said no) is said so by the
 * rules, "Didn’t run the tests", whatever words it carried while it waited,
 * and is over even if the tool hasn't said so yet.
 */
export function stepFromTool(call: ToolCallLike): StoryStep {
  const declined = call.approval !== undefined && NEVER_RAN.has(call.approval);
  const status: ToolStatus = declined && !isSettled(call) ? 'error' : call.status;
  const result =
    declined || isSettled(call)
      ? {
          status,
          ...(call.output !== undefined && { output: call.output }),
          ...(call.viewKind !== undefined && { viewKind: call.viewKind }),
          ...(declined && { approval: call.approval }),
        }
      : undefined;
  const step: StoryStep = {
    id: call.id,
    name: call.name,
    input: call.input,
    status,
    label: (!declined && call.label) || describeTool(call.name, call.input, result),
    startedAt: call.startedAt,
  };
  if (call.durationMs !== undefined) step.durationMs = call.durationMs;
  if (declined) step.declined = true;
  return step;
}
