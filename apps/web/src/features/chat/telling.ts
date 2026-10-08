/**
 * The chat's tool calls told as stories (ADR 0103): the cut, the words and
 * what a turn changed, worked out from the transcript's items. Pure, so the
 * transcript, the away digest and the tests read the same stories.
 */
import {
  groupEffects,
  stepFromTool,
  storyStepCount,
  storyVisibleSteps,
  tellStories,
  type ActivityEffect,
  type ChangedFile,
  type EffectGroup,
  type Story,
  type StoryStep,
  type ToolView,
} from '@conch/protocol';
import type { StoryStatus, StoryStepView } from '@conch/nacre';

import type { Narration, StoryHeadline, TranscriptItem } from '../../live/reducer';
import { rowState, withAnswer } from './approval';

type Tool = Extract<TranscriptItem, { kind: 'tool' }>;
type Files = Extract<TranscriptItem, { kind: 'files' }>;
type Permission = Extract<TranscriptItem, { kind: 'permission' }>;

/**
 * Each call's step, worked out once: items are replaced, never changed, so a
 * finished call isn't described again as the reply streams (an old chat's
 * calls have no words of their own and are read by the rules here).
 */
const steps = new WeakMap<Tool, StoryStep>();

export function stepOf(tool: Tool): StoryStep {
  let step = steps.get(tool);
  if (!step) {
    step = stepFromTool({ ...tool, ...(tool.view && { viewKind: tool.view.kind }) });
    steps.set(tool, step);
  }
  return step;
}

/**
 * One run of calls, told as stories. With the questions they asked, a call
 * you just said no to is told as not run ("Didn’t run the tests") even
 * before the gateway says so.
 */
export function storiesOf(
  tools: readonly Tool[],
  asked?: ReadonlyMap<string, Permission>,
): Story[] {
  if (!tools.length) return [];
  return tellStories(tools.map((t) => stepOf(asked ? withAnswer(t, asked.get(t.id)) : t)));
}

/**
 * What a tool found that's the answer itself (ADR 0060: the day's agenda, the
 * emails, the files): drawn in sight under its story, not folded inside it.
 * Sources stay with their step, and the story's chips show the sites.
 */
const STANDALONE = new Set<ToolView['kind']>([
  'agenda',
  'mail',
  'files',
  'messages',
  'downloads',
  'weather',
]);

export const standsAlone = (view: ToolView | undefined): view is ToolView =>
  view !== undefined && STANDALONE.has(view.kind);

/** A story's steps, as its timeline draws them: the answer to a question each step asked, too. */
export function stepViews(
  story: Story,
  tools: ReadonlyMap<string, Tool>,
  asked: ReadonlyMap<string, Permission>,
): StoryStepView[] {
  return storyVisibleSteps(story).map((step) => {
    const tool = tools.get(step.id);
    const live = step.status === 'running' || step.status === 'pending';
    const view: StoryStepView = {
      id: step.id,
      text: live ? step.label.doing : step.label.done,
      status: step.status,
      family: step.label.family,
      startedAt: step.startedAt,
    };
    if (step.label.outcome && !live) view.outcome = step.label.outcome;
    if (step.label.subject) view.subject = step.label.subject;
    if (step.durationMs !== undefined) view.durationMs = step.durationMs;
    if (step.label.failed) view.failed = true;
    if (tool) {
      const question = asked.get(step.id);
      const asking = Boolean(question && !question.decision);
      const row = rowState(withAnswer(tool, question), asking);
      // It asked and didn't run, or waits for you: that's what the step says, calmly.
      // Its words already say it didn't run (`stepFromTool`, from the answer).
      if (row.outcome) view.outcome = row.outcome;
      if (asking) view.status = 'pending';
      else if (row.status === 'declined' || (row.status === 'cancelled' && row.outcome)) {
        view.status = 'declined';
        delete view.failed;
      }
      const far = live ? progressOf(tool) : undefined;
      if (far && !asking) view.outcome = far;
    }
    return view;
  });
}

/** How far a long call has come, in a few words: "42%", "about 40%", "Finishing". */
export function progressOf(tool: Tool): string | undefined {
  const at = tool.progress;
  if (!at) return undefined;
  if (at.stage === 'finishing') return 'Finishing';
  if (at.progress !== undefined) {
    const pct = `${Math.round(at.progress * 100)}%`;
    return at.estimated ? `about ${pct}` : pct;
  }
  return at.stage === 'queued' ? 'Waiting its turn' : undefined;
}

/**
 * A story's state as its line says it (from what was decided, `approval`):
 * one whose every step was one you said no to (or a rule stopped) wasn't run,
 * neither done nor failed; one where only those went wrong is done.
 */
export function storyStatus(story: Story, views: readonly StoryStepView[]): StoryStatus {
  if (story.status === 'running') return 'running';
  if (views.length > 0 && views.every((v) => v.status === 'declined')) return 'declined';
  if (story.status !== 'failed') return story.status;
  const declined = views.some((v) => v.status === 'declined');
  const failed = views.some((v) => v.status === 'error' || v.failed);
  return declined && !failed ? 'done' : 'failed';
}

/** How long a provider's note stays the live line once a later step has started. */
const NOTE_KEEPS_MS = 10_000;
/** A note said just before the step it's about (a model thinking aloud, then acting). */
const NOTE_LEADS_MS = 5_000;

/**
 * What a running story's live line says: the provider's own note while it's
 * about this story and fresh, else the rules' words for the step at hand.
 */
export function liveOf(
  story: Story,
  narration: Narration | undefined,
  asked: ReadonlyMap<string, Permission>,
  tools?: ReadonlyMap<string, Tool>,
): { text: string; source: Narration['source'] } | undefined {
  if (story.status !== 'running') return undefined;
  const at = story.steps.findLast((s) => s.status === 'running' || s.status === 'pending');
  const question = at && asked.get(at.id);
  if (question && !question.decision) return { text: 'Waiting for you', source: 'rule' };
  if (narration) {
    const about = narration.toolUseId && story.steps.some((s) => s.id === narration.toolUseId);
    const fresh =
      narration.at >= story.startedAt - NOTE_LEADS_MS &&
      (!at || at.startedAt - narration.at < NOTE_KEEPS_MS);
    if (about || fresh) return { text: narration.text, source: narration.source };
  }
  if (!at) return undefined;
  const tool = tools?.get(at.id);
  const far = tool && progressOf(tool);
  return { text: far ? `${at.label.doing} · ${far}` : at.label.doing, source: 'rule' };
}

/** The words a story's line shows: the small model's headline once it's in, else the rules'. */
export function headlineOf(
  story: Story,
  title: StoryHeadline | undefined,
): { headline: string; outcome?: string; source: StoryHeadline['source'] } {
  // A headline is for a story that ended; one still growing says what it's doing.
  if (title && story.status !== 'running')
    return {
      headline: title.headline,
      // The model's words stand alone: the rules' outcome may be about another step.
      ...(title.outcome && { outcome: title.outcome }),
      source: title.source,
    };
  const outcome = story.outcome ?? (story.status === 'done' ? story.note : undefined);
  return { headline: story.headline, ...(outcome && { outcome }), source: 'rule' };
}

/** The steps a turn showed, for its tally: repeats and checks on running commands left out. */
export function stepsShown(stories: readonly Story[]): number {
  return stories.reduce((n, s) => n + storyStepCount(s), 0);
}

/** Calls that only look after another one (the quiet ones), under the step they follow. */
export function quietFollowers(story: Story): Map<string, string[]> {
  const quiet = new Set(story.quiet);
  const out = new Map<string, string[]>();
  let visible: string | undefined;
  for (const step of story.steps) {
    if (!quiet.has(step.id)) {
      visible = step.id;
      continue;
    }
    // Before any step with a line of its own (a story of only checks): they go with the first.
    const owner = visible ?? storyVisibleSteps(story)[0]?.id ?? story.steps[0]?.id;
    if (!owner || owner === step.id) continue;
    out.set(owner, [...(out.get(owner) ?? []), step.id]);
  }
  return out;
}

const base = (path: string) => path.split(/[\\/]/).pop() || path;

/** Two names for the same file: a call's full path and the change set's, read from the work folder. */
const samePath = (a: string, b: string) =>
  a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`) || a.endsWith(`\\${b}`);

/** A file's change in a turn, whatever number of change sets touched it. */
function fileWords(kinds: readonly ChangedFile['kind'][]): string {
  const last = kinds.at(-1);
  if (last === 'deleted') return kinds[0] === 'created' ? 'Created and removed' : 'Deleted';
  return kinds[0] === 'created' ? 'Created' : 'Changed';
}

/** Change sets said together under one Undo: one file changed by several calls goes back whole. */
export const undoIds = (key: string): string[] => key.split(' ').filter(Boolean);

/**
 * What a turn changed in the world (ADR 0103), for its "What changed" line:
 * what each step's words say it did, with the files from the turn's change
 * sets (ADR 0030) in place of the steps' guesses, so each file can be put back.
 */
export function turnChanges(
  tools: readonly Tool[],
  files: readonly Files[],
): { groups: EffectGroup[]; undone: Set<string> } {
  const byPath = new Map<string, { kinds: ChangedFile['kind'][]; sets: Files[] }>();
  for (const set of files)
    for (const file of set.files) {
      const was = byPath.get(file.path) ?? { kinds: [], sets: [] };
      was.kinds.push(file.kind);
      if (!was.sets.includes(set)) was.sets.push(set);
      byPath.set(file.path, was);
    }
  const tracked = new Set(files.flatMap((f) => (f.toolUseId ? [f.toolUseId] : [])));
  const paths = [...byPath.keys()];
  const effects: ActivityEffect[] = [];
  for (const tool of tools) {
    for (const effect of stepOf(tool).label.effects ?? []) {
      // What Undo kept is the truth about files; the words were a guess.
      if (
        effect.kind === 'file' &&
        (tracked.has(tool.id) ||
          (effect.target !== undefined && paths.some((p) => samePath(effect.target ?? '', p))))
      )
        continue;
      // Its target only where it adds something: not "main" under "Pushed to main".
      effects.push(
        effect.target && effect.text.includes(effect.target)
          ? { kind: effect.kind, text: effect.text, ...(effect.undo && { undo: effect.undo }) }
          : effect,
      );
    }
  }
  const undone = new Set<string>();
  for (const [path, { kinds, sets }] of byPath) {
    const key = sets.map((s) => s.id).join(' ');
    if (sets.every((s) => s.state === 'undone')) undone.add(key);
    const name = base(path);
    effects.push({
      kind: 'file',
      text: `${fileWords(kinds)} ${name}`,
      // Where it is, when its name alone doesn't say.
      ...(name !== path && { target: path }),
      undo: key,
    });
  }
  return { groups: groupEffects(effects), undone };
}
