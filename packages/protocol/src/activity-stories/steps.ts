/**
 * What a story needs to know about one step: its phase of the work, whether
 * it's only noise around another step, and when two steps did the same thing.
 */
import type { ActivityFamily, ToolLabel } from '../activity';
import type { StoryStep } from '../activity-stories';
import { APP_TOOL_WORDS } from '../app-tools';

/**
 * The part of the work a step belongs to, for cutting a run into stories:
 * looking and changing code is `work`, checking it is `verify`, sending it
 * off is `ship`, the web and the browser are `research`, apps are `connect`.
 */
export type StoryPhase =
  'work' | 'verify' | 'ship' | 'research' | 'connect' | 'make' | 'delegate' | 'plan' | 'other';

const PHASE: Record<ActivityFamily, StoryPhase> = {
  explore: 'work',
  edit: 'work',
  run: 'work',
  remember: 'work',
  verify: 'verify',
  ship: 'ship',
  research: 'research',
  browse: 'research',
  connect: 'connect',
  make: 'make',
  plan: 'plan',
  delegate: 'delegate',
  other: 'other',
};

/** The phase of the work a label belongs to. */
export function phaseOf(label: Pick<ToolLabel, 'family'>): StoryPhase {
  return PHASE[label.family];
}

/** A tool's own name, without the `mcp__server__` it came through, lower case. */
export function bareName(name: string): string {
  const parts = name.split('__');
  return (parts.length >= 3 ? parts.slice(2).join('__') : name).toLowerCase();
}

/**
 * Calls that only look after another one: reading a running command's output,
 * stopping it, updating the plan. They join the story they're in and never
 * start one of their own.
 */
const NOISE = new Set([
  'process_read',
  'process_write',
  'process_stop',
  'process_list',
  'bashoutput',
  'bash_output',
  'killshell',
  'killbash',
  'kill_shell',
  'taskoutput',
  'task_output',
  'todowrite',
  'todoread',
  'todo_write',
  'todo_read',
  'update_plan',
  'write_stdin',
]);

export function isNoiseStep(step: Pick<StoryStep, 'name' | 'label'>): boolean {
  return step.label.family === 'plan' || NOISE.has(bareName(step.name));
}

/** The app a `connect` step used: its app chip, Conch's own app, or the server it came through. */
export function appOf(step: Pick<StoryStep, 'name' | 'label'>): string {
  const chip = step.label.chips?.find((c) => c.kind === 'app');
  if (chip) return chip.label.toLowerCase();
  const own = (APP_TOOL_WORDS as Record<string, { app: string } | undefined>)[step.name];
  if (own) return own.app;
  const parts = step.name.split('__');
  if (parts.length >= 3 && parts[1]) return parts[1].toLowerCase();
  return (step.name.split(/[_.:-]/)[0] ?? step.name).toLowerCase();
}

/** The phase, with the app for `connect`: each app tells its own story. */
export function phaseKey(step: Pick<StoryStep, 'name' | 'label'>): string {
  const phase = phaseOf(step.label);
  return phase === 'connect' ? `connect:${appOf(step)}` : phase;
}

export function isSettled(step: Pick<StoryStep, 'status'>): boolean {
  return step.status === 'success' || step.status === 'error';
}

export function isLive(step: Pick<StoryStep, 'status'>): boolean {
  return step.status === 'running' || step.status === 'pending';
}

/** Went wrong: an error, or a result worth calling a failure (tests that failed). */
export function isFailed(step: Pick<StoryStep, 'status' | 'label'>): boolean {
  return step.status === 'error' || (step.status === 'success' && step.label.failed === true);
}

/** JSON with its keys sorted, so the same input always reads the same. */
export function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[cycle]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v).sort()) out[key] = walk((v as Record<string, unknown>)[key]);
    return out;
  };
  try {
    return JSON.stringify(walk(value)) ?? 'undefined';
  } catch {
    return String(value);
  }
}

/** The same tool with the same input: the same thing done again. */
export function sameKey(step: Pick<StoryStep, 'name' | 'input'>): string {
  return `${step.name}\u0000${stableJson(step.input)}`;
}

/** What a retry is a retry of: the same tool on the same subject. */
export function retryKey(step: Pick<StoryStep, 'name' | 'input' | 'label'>): string {
  return step.label.subject ? `${step.name}\u0000${step.label.subject}` : sameKey(step);
}

/** A step that changes things: a later look at the same thing isn't a repeat. */
export function changesThings(step: Pick<StoryStep, 'label'>): boolean {
  const f = step.label.family;
  return f === 'edit' || f === 'ship' || f === 'make' || (step.label.effects?.length ?? 0) > 0;
}
