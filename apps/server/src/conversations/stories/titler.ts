/**
 * Story headlines by a small model (ADR 0103). The rules tell each run of
 * tool calls as a story with a headline of their own; when a story ends with
 * enough in it and the rules' headline says little ("Used 4 tools"), a small
 * model writes a better one from the steps' words and a little of what they
 * found. It never holds anything up: at most two at a time, a few a turn,
 * twelve seconds each, the same steps answered once, and nothing at all when
 * there's no one to ask or nothing left to spend.
 */
import { createHash } from 'node:crypto';

import {
  describeTool,
  tellStories,
  type ConversationEvent,
  type ConversationEventInput,
  type ServerEvent,
  type Story,
  type StoryStep,
} from '@conch/protocol';

import { Limiter, Recent, type SmallModel, type SmallModelDeps } from './ask';
import { readHeadline, STORY_SYSTEM, storyPrompt, type PromptStep } from './prompt';

/** At most this many headlines a turn: a long turn's later stories keep the rules' words. */
export const TITLES_PER_TURN = 6;
export const TITLE_TIMEOUT_MS = 12_000;
/** Headlines asked at once, across every chat. */
export const TITLES_AT_ONCE = 2;
/** What one step's output is kept for, at most: the prompt takes far less. */
const OUTPUT_KEPT = 2_000;

/** A rules headline that says little: a count of steps, or "worked on" something. */
const GENERIC =
  /\b(?:\d+|a few|several|some|many) (?:steps|tools|tool calls|things|actions|calls)\b|^(?:worked|did some|used tools|took \d)/i;

export interface StoryTitlerDeps extends SmallModelDeps {
  /** Headlines by a small model are on (Settings: name things with a small model). */
  enabled(): Promise<boolean>;
  /** Chats nobody watches (a page fetching its data, an app's client) get none. */
  watched?(conversationId: string): Promise<boolean>;
  /** Write the headline into the chat. */
  note(
    conversationId: string,
    event: Extract<ConversationEventInput, { type: 'story.titled' }>,
  ): Promise<void>;
  /** How the steps are cut into stories: `tellStories`, the chat's own. */
  tell?: (steps: StoryStep[]) => Story[];
  timeoutMs?: number;
  perTurn?: number;
  atOnce?: number;
}

interface Turn {
  request: string;
  /** Steps since the assistant last said something: a reply between them ends their stories. */
  run: StoryStep[];
  /** The run's steps by id. */
  byId: Map<string, StoryStep>;
  /**
   * Where the run is told from (ADR 0103): the first step of a story of two or
   * more steps at or before the first one not yet closed. Cuts never move once
   * a story is followed by another, and from such a story on they come out
   * the same told alone (only a run's first two steps join whatever they are),
   * so each event tells only the open end of the run, not all of it again.
   */
  from: number;
  outputs: Map<string, string>;
  /** Stories already closed, by id: each is looked at once. */
  closed: Set<string>;
  asked: number;
}

/** Steps the person sees in a story: its repeats folded away. */
export function visibleSteps(story: Story): number {
  return Math.max(0, story.steps.length - story.repeats);
}

/** Worth a model's headline: enough in it, and the rules' words say little. */
export function wantsHeadline(story: Story): boolean {
  if (story.status === 'running') return false;
  const families = new Set(story.steps.map((step) => step.label.family));
  const visible = visibleSteps(story);
  if (visible < 2 || (visible < 3 && families.size < 2)) return false;
  return story.family === 'other' || families.size > 1 || GENERIC.test(story.headline);
}

/** The same steps, said the same way in the same chat, are asked about once. */
export function storyKey(conversationId: string, story: Story): string {
  const words = story.steps.map(({ label }) => [
    label.family,
    label.done,
    label.outcome ?? '',
    label.subject ?? '',
  ]);
  return createHash('sha256')
    .update(JSON.stringify([conversationId, words]))
    .digest('base64url');
}

export class StoryTitler {
  #turns = new Map<string, Turn>();
  #cache = new Recent<{ headline: string; outcome?: string } | null>(500);
  #limit: Limiter;

  constructor(private readonly deps: StoryTitlerDeps) {
    this.#limit = new Limiter(deps.atOnce ?? TITLES_AT_ONCE);
  }

  /** Follows every chat's log as it's written. */
  onEvent(event: ServerEvent): void {
    if (event.type === 'conversation.deleted') {
      this.#turns.delete(event.conversationId);
      return;
    }
    if (event.type !== 'conversation.event') return;
    try {
      this.#follow(event.event);
    } catch {
      // A headline is a nicety: nothing here may disturb the chat.
    }
  }

  #follow(e: ConversationEvent) {
    const id = e.conversationId;
    switch (e.type) {
      case 'user.message':
        this.#turns.set(id, {
          request: e.text,
          run: [],
          byId: new Map(),
          from: 0,
          outputs: new Map(),
          closed: new Set(),
          asked: 0,
        });
        return;
      case 'assistant.delta': {
        // Words between the steps end the run they follow.
        const turn = this.#turns.get(id);
        if (e.kind !== 'text' || !e.delta.trim() || !turn?.run.length) return;
        this.#close(id, turn, this.#tell(turn));
        turn.run = [];
        turn.byId.clear();
        turn.from = 0;
        return;
      }
      case 'tool.started': {
        const turn = this.#turn(id);
        const step: StoryStep = {
          id: e.toolUseId,
          name: e.name,
          input: e.input,
          status: 'running',
          label: e.label ?? describeTool(e.name, e.input),
          startedAt: e.at,
        };
        turn.run.push(step);
        turn.byId.set(step.id, step);
        this.#settle(id, turn);
        return;
      }
      case 'tool.finished': {
        const turn = this.#turns.get(id);
        const step = turn?.byId.get(e.toolUseId);
        if (!turn || !step) return;
        step.status = e.status;
        if (e.durationMs !== undefined) step.durationMs = e.durationMs;
        step.label =
          e.label ??
          describeTool(step.name, step.input, {
            status: e.status,
            ...(e.output !== undefined && { output: e.output }),
            ...(e.view && { viewKind: e.view.kind }),
          });
        if (e.output) turn.outputs.set(e.toolUseId, e.output.slice(-OUTPUT_KEPT));
        this.#settle(id, turn);
        return;
      }
      case 'turn.completed': {
        const turn = this.#turns.get(id);
        this.#turns.delete(id);
        if (turn?.run.length) this.#close(id, turn, this.#tell(turn));
        return;
      }
      default:
        return;
    }
  }

  #turn(id: string): Turn {
    let turn = this.#turns.get(id);
    if (!turn) {
      // A turn that began before Conch was watching (or with no message: a task's).
      turn = {
        request: '',
        run: [],
        byId: new Map(),
        from: 0,
        outputs: new Map(),
        closed: new Set(),
        asked: 0,
      };
      this.#turns.set(id, turn);
    }
    return turn;
  }

  /** The run's stories from `turn.from` on: the ones before it are closed and stay as they were. */
  #tell(turn: Turn): Story[] {
    try {
      return (this.deps.tell ?? tellStories)(turn.run.slice(turn.from).map((s) => ({ ...s })));
    } catch {
      return [];
    }
  }

  /** Stories no longer the last one, with every step done, have ended. */
  #settle(id: string, turn: Turn) {
    const stories = this.#tell(turn);
    this.#close(
      id,
      turn,
      stories.slice(0, -1).filter((story) => story.status !== 'running'),
    );
    // Tell from later next time: the latest story of two or more steps at or
    // before the first that's still open (the one told from, if none is).
    let at = turn.from;
    let anchor = turn.from;
    for (const story of stories) {
      if (story.steps.length >= 2) anchor = at;
      if (!turn.closed.has(story.id)) break;
      at += story.steps.length;
    }
    turn.from = anchor;
  }

  #close(id: string, turn: Turn, stories: Story[]) {
    for (const story of stories) {
      if (turn.closed.has(story.id)) continue;
      turn.closed.add(story.id);
      if (!wantsHeadline(story)) continue;
      if (turn.asked >= (this.deps.perTurn ?? TITLES_PER_TURN)) return;
      turn.asked++;
      const steps: PromptStep[] = story.steps.map((step) => ({
        label: step.label,
        failed: step.status === 'error',
        ...(turn.outputs.has(step.id) && { output: turn.outputs.get(step.id) }),
      }));
      void this.#title(id, story, turn.request, steps).catch(() => undefined);
    }
  }

  /** A headline for one story: remembered, or asked of the small model. Only a good one is written. */
  async #title(id: string, story: Story, request: string, steps: PromptStep[]): Promise<void> {
    if (!(await this.deps.enabled().catch(() => false))) return;
    if (this.deps.watched && !(await this.deps.watched(id).catch(() => false))) return;
    // Who may be asked is settled first, every time: a remembered answer
    // never stands in for a chat that may no longer go to a small model.
    const small = await this.deps.model(id).catch(() => undefined);
    if (!small) return;
    const key = storyKey(id, story);
    let found = this.#cache.get(key);
    if (found === undefined) {
      found = await this.#limit.run(() => this.#ask(small, story, request, steps));
      if (found === undefined) return;
      this.#cache.set(key, found);
    }
    if (!found) return;
    await this.deps.note(id, {
      type: 'story.titled',
      storyId: story.id,
      headline: found.headline,
      ...(found.outcome && { outcome: found.outcome }),
      source: 'model',
    });
  }

  /**
   * Undefined: nobody was asked (try again another time); null: the answer
   * wasn't good enough (the rules' words stand for these steps).
   */
  async #ask(
    small: SmallModel,
    story: Story,
    request: string,
    steps: PromptStep[],
  ): Promise<{ headline: string; outcome?: string } | null | undefined> {
    const allowed = await this.deps.allow(small.engine).catch(() => ({ ok: false as const }));
    if (!allowed.ok) return undefined;
    let reply;
    try {
      reply = await small.complete({
        system: STORY_SYSTEM,
        prompt: storyPrompt(request, steps),
        ...(small.model && { model: small.model }),
        maxTokens: 120,
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? TITLE_TIMEOUT_MS),
      });
    } catch {
      return undefined;
    }
    if (reply.usage) this.deps.spent(reply.usage, small.engine, small.model);
    const echoes = [
      story.headline,
      ...story.steps.flatMap(({ label }) => [label.done, label.doing]),
    ];
    return readHeadline(reply.text, echoes) ?? null;
  }
}
