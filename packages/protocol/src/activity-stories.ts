/**
 * Runs of tool calls told as stories (ADR 0103): one line that says what
 * happened, its steps in plain words underneath, the raw calls under those.
 * Pure and shared, so the gateway (which titles stories) and the chat (which
 * draws them) always cut them the same way.
 */
import type { ActivityChip, ActivityEffect, ActivityFamily, ToolLabel } from './activity';
import type { ToolStatus } from './index';

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
}

/** Stub: replaced by the stories work. */
export function tellStories(steps: StoryStep[]): Story[] {
  void steps;
  return [];
}

/** Stub: what a whole turn changed, merged for its "What changed" list. */
export function turnEffects(steps: StoryStep[]): ActivityEffect[] {
  void steps;
  return [];
}
