/**
 * Quiet learning (ADR 0088): once a chat you were in goes quiet, Conch reads
 * your words in it, keeps what's worth keeping, and says so at the end of
 * that chat — one quiet line, Undo on each thing, Why? on where it came
 * from. What came after reading something from outside, or with nobody
 * watching, waits for your OK. Nothing learned deletes a memory, and what you
 * take back is never learned again.
 *
 * - `sweep()` looks every few minutes for chats that went quiet with new
 *   words from you, two at a time at most;
 * - `review()` reads one: signals by code, then (only when there's something
 *   to learn) the cheapest model of the provider that answered, then the
 *   gate, then the record;
 * - `answer()` is Keep, Undo and Forget, from the chat or the Memory page.
 */
import type {
  ConversationEvent,
  ConversationEventInput,
  ConversationSummary,
  EngineId,
  LearnedEntry,
  LearnedItem,
  LearningSignal,
  LearningStatus,
  LearningTrigger,
  Memory,
  Usage,
} from '@conch/protocol';

import { describeTaint, heldTaints } from '../conversations/taint';
import type { Completion, CompletionInput, Engine } from '../engines/types';
import { newId } from '../lib/ids';
import type { Heal } from '../lib/recover';
import type { Embedder } from '../memory/embed';
import type { MemoryStore } from '../memory/store';
import { overlap } from '../memory/tidy';
import { turnsOf } from '../skills/learn';
import { nearTheQuestion } from './near';
import { neverMatch } from './never';
import { gate, type GateContext } from './policy';
import { parseReview, REVIEW_SYSTEM, reviewPrompt, type Change } from './review';
import { signalsOf, type ChatSignals } from './signals';
import type { LearningSpend } from './spend';
import { LearningStore } from './store';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A chat must have been quiet this long. */
export const IDLE_MS = 10 * MINUTE;
/** How often to look for chats that went quiet. */
export const SWEEP_MS = 5 * MINUTE;
/** Only chats touched this recently. */
const RECENT_MS = 7 * DAY;
/** Chats looked at per sweep. */
const PER_SWEEP = 2;
/** A model answer is given up on after this long. */
const REVIEW_TIMEOUT_MS = 60_000;
/** Memories close to what was said, read with the chat. */
const RELATED = 15;
/** Things not to learn again, read with the chat. */
const NEAR_NEVER = 10;
/** Signals that make a look worth a model, words about something lasting aside. */
const WORTH_ASKING: ReadonlySet<LearningSignal> = new Set([
  'correction',
  'rephrase',
  'frustration',
]);

export interface LearningModel {
  /** The provider asked (what it costs is counted against it). */
  engine: Engine;
  model?: string;
  complete(input: CompletionInput): Promise<Completion>;
}

type Origin = ConversationSummary['origin'];

export interface QuietLearningDeps {
  home: string;
  memory: MemoryStore;
  /** Memory search (ADR 0032): what's close to what was said. */
  search: (query: string, limit: number) => Promise<{ memory: Memory }[]>;
  spend: LearningSpend;
  /** Your chats, newest first. */
  chats: () => Promise<ConversationSummary[]>;
  /** One chat's log. */
  events: (conversationId: string) => Promise<ConversationEvent[]>;
  /**
   * The cheapest model of the provider that answered the chat (it has seen it
   * already), else one on this computer; nothing else is asked.
   */
  model: (engine: EngineId | undefined) => Promise<LearningModel | undefined>;
  settings: () => Promise<{ autoMemory: boolean }>;
  /** Past the month's budget for chats (ADR 0079): learning waits too. */
  overBudget?: () => Promise<boolean>;
  /** Writes into the chat's own log: what it learned, and what you decided. */
  note: (
    conversationId: string,
    event: Extract<
      ConversationEventInput,
      { type: 'learning.noted' | 'learning.decided' | 'memory.decided' }
    >,
  ) => Promise<void>;
  /** Something was learned or decided: whoever shows it fetches again. */
  changed?: () => void;
  /** Conch's model for meaning, for the never-list. */
  meaning?: () => Promise<Embedder | undefined>;
  /** Takes saved passwords out of text (ADR 0025). */
  redact?: (text: string) => string;
  /** What a look cost, for the usage ledger. */
  onSpend?: (usage: Usage, engine: Engine) => void;
  heal?: Heal;
  now?: () => number;
  idleMs?: number;
  sweepMs?: number;
}

export type ReviewResult =
  | { learned: LearnedEntry[] }
  | {
      why:
        | 'off'
        | 'quiet'
        | 'not-yours'
        | 'someone-else'
        | 'nothing-new'
        | 'nothing-to-learn'
        | 'no-model'
        | 'budget'
        | 'cap'
        | 'plan-room'
        | 'unreadable'
        | 'gone';
    };

/** What every change in one look is judged against. */
interface Look {
  said: string[];
  untrusted?: string;
  watched: boolean;
  memories: Map<string, Memory>;
  /** Live and waiting memories, and what this look learned so far. */
  known: Memory[];
  never: Awaited<ReturnType<LearningStore['never']>>;
  meaning?: Embedder;
  appliedToday: number;
  appliedThisLook: number;
}

/** Not a chat a person had: a routine's run, a task, a page fetching its data, a guest (ADR 0075). */
function notYours(origin: Origin): boolean {
  if (!origin) return false;
  if (origin.kind === 'routine' || origin.kind === 'task' || origin.kind === 'artifact')
    return true;
  return origin.kind === 'channel' && origin.guest === true;
}

/** The provider that answered last. */
function answeredBy(events: readonly ConversationEvent[]): EngineId | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.type === 'turn.completed' && e.engine) return e.engine;
  }
  return undefined;
}

export class QuietLearning {
  readonly store: LearningStore;
  #queue: Promise<unknown> = Promise.resolve();
  #timer?: NodeJS.Timeout;
  #sweeping = false;
  /** The last look found no model to ask. */
  #noModel = false;

  constructor(private readonly deps: QuietLearningDeps) {
    this.store = new LearningStore({
      home: deps.home,
      ...(deps.heal && { heal: deps.heal }),
      ...(deps.now && { now: deps.now }),
    });
  }

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  // ── When ───────────────────────────────────────────────────────────────

  start() {
    this.#timer = setInterval(
      () => void this.sweep().catch(() => undefined),
      this.deps.sweepMs ?? SWEEP_MS,
    );
    this.#timer.unref?.();
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
  }

  /** Chats that went quiet with new words from you: a couple at a time. */
  async sweep(): Promise<number> {
    if (this.#sweeping) return 0;
    this.#sweeping = true;
    try {
      if (!(await this.deps.settings()).autoMemory) return 0;
      const now = this.#now;
      const idle = this.deps.idleMs ?? IDLE_MS;
      const quiet = new Set(await this.store.quiet());
      let looked = 0;
      for (const chat of await this.deps.chats()) {
        if (looked >= PER_SWEEP) break;
        if (now - chat.updatedAt > RECENT_MS) break;
        if (now - chat.updatedAt < idle) continue;
        if (chat.status === 'running' || chat.status === 'awaiting-permission') continue;
        if (quiet.has(chat.id) || notYours(chat.origin)) continue;
        const state = await this.store.chat(chat.id);
        // Nothing happened since a look last finished.
        if (state.upTo !== undefined && state.upTo >= chat.updatedAt) continue;
        // A look that waited for money or a model is tried again an hour on.
        if (state.tried !== undefined && now - state.tried < HOUR) continue;
        looked++;
        await this.review(chat.id, { trigger: 'idle' });
      }
      return looked;
    } finally {
      this.#sweeping = false;
    }
  }

  /** One look at a chat, after any already running (one at a time). */
  review(
    conversationId: string,
    options: { trigger: LearningTrigger; beforeSeq?: number },
  ): Promise<ReviewResult> {
    const next = this.#queue
      .catch(() => undefined)
      .then(() => this.#finish(conversationId, options));
    this.#queue = next;
    return next;
  }

  /**
   * A look, and what the sweep needs to know after it: unless it waits for
   * money or a model (or an answer it may yet read), the chat as it stands
   * now has been read.
   */
  async #finish(
    id: string,
    options: { trigger: LearningTrigger; beforeSeq?: number },
  ): Promise<ReviewResult> {
    const result = await this.#review(id, options);
    const waits =
      'why' in result &&
      (result.why === 'no-model' ||
        result.why === 'budget' ||
        result.why === 'cap' ||
        result.why === 'plan-room' ||
        (result.why === 'unreadable' && (await this.store.chat(id)).unread));
    // A compaction read only the start: the rest is still to read.
    if (!waits && options.beforeSeq === undefined) {
      const chat = (await this.deps.chats()).find((c) => c.id === id);
      if (chat) await this.store.setChat(id, { upTo: chat.updatedAt });
    }
    return result;
  }

  // ── One look ───────────────────────────────────────────────────────────

  async #review(
    id: string,
    options: { trigger: LearningTrigger; beforeSeq?: number },
  ): Promise<ReviewResult> {
    const { deps, store } = this;
    if (!(await deps.settings()).autoMemory) return { why: 'off' };
    const state = await store.chat(id);
    if (state.quiet) return { why: 'quiet' };
    const chat = (await deps.chats()).find((c) => c.id === id);
    if (!chat) return { why: 'gone' };
    if (notYours(chat.origin)) return { why: 'not-yours' };
    const events = await deps.events(id).catch(() => [] as ConversationEvent[]);
    const before = options.beforeSeq ?? Number.POSITIVE_INFINITY;
    const lastSeq = events.reduce((max, e) => (e.seq < before ? Math.max(max, e.seq) : max), -1);
    const done = (why: Extract<ReviewResult, { why: unknown }>['why']) =>
      store
        .setChat(id, {
          reviewed: Math.max(lastSeq, state.reviewed ?? -1),
          unread: 0,
          tried: undefined,
        })
        .then(() => ({ why }) as ReviewResult);
    const taint = heldTaints(events);
    // Someone else's words aren't yours to learn from (ADR 0032).
    if (taint.some((t) => t.kind === 'person')) return done('someone-else');
    const afterSeq = state.reviewed ?? -1;
    if (lastSeq <= afterSeq) return { why: 'nothing-new' };
    const signals = signalsOf(events, { afterSeq, beforeSeq: before });
    if (!signals.said.length && !signals.environment.length) return done('nothing-new');

    const context = await this.#context(
      chat,
      signals,
      taint.length ? describeTaint(taint) : undefined,
    );
    const learned: LearnedEntry[] = [];
    const items: LearnedItem[] = [];
    const from = {
      conversationId: id,
      chatTitle: chat.title.slice(0, 200),
      signals: signals.signals,
      trigger: options.trigger,
    };

    // Facts about this computer: written by code, one a look.
    const fact = signals.environment[0];
    if (fact) {
      const change: Change = { op: 'add', kind: 'fact', text: fact.text, quote: '', basis: 'said' };
      const entry = await this.#keep(change, await this.#facts(change, context), {
        ...from,
        quotes: [fact.quote],
        about: 'environment',
      });
      if (entry) this.#took(entry, learned, items, context);
    }

    // Nothing lasting said and nothing corrected: no model is asked, and it costs nothing.
    const worth = signals.durable || signals.signals.some((s) => WORTH_ASKING.has(s));
    if (!worth) {
      await this.#close(id, chat, learned, items);
      const skipped = await done('nothing-to-learn');
      return learned.length ? { learned } : skipped;
    }

    // A model reads it: the provider that answered, within what learning may spend.
    const model = await deps
      .model(answeredBy(events) ?? chat.options.engine)
      .catch(() => undefined);
    this.#noModel = !model;
    if (!model) {
      await store.setChat(id, { tried: this.#now });
      await this.#close(id, chat, learned, items);
      return { why: 'no-model' };
    }
    if (await deps.overBudget?.().catch(() => false)) {
      await store.setChat(id, { tried: this.#now });
      return { why: 'budget' };
    }
    const allowed = await deps.spend.allow(model.engine);
    if (!allowed.ok) {
      await store.setChat(id, { tried: this.#now });
      await this.#close(id, chat, learned, items);
      return { why: allowed.reason };
    }

    const changes = await this.#ask(model, signals, events, afterSeq, before);
    if (!changes) {
      const unread = (state.unread ?? 0) + 1;
      // Twice unreadable: those words are passed over.
      if (unread >= 2) return done('unreadable');
      await store.setChat(id, { unread, tried: this.#now });
      return { why: 'unreadable' };
    }
    const modelFrom = {
      engine: model.engine.id,
      ...(model.model && { model: model.model.slice(0, 200) }),
    };
    for (const change of changes) {
      const entry = await this.#keep(change, await this.#facts(change, context), {
        ...from,
        quotes: change.quote ? [change.quote.slice(0, 240)] : [],
        model: modelFrom,
      });
      if (entry) this.#took(entry, learned, items, context);
    }
    await store.setChat(id, { reviewed: Math.max(lastSeq, afterSeq), unread: 0, tried: undefined });
    await this.#close(id, chat, learned, items);
    return { learned };
  }

  /** What every change in this look is judged against. */
  async #context(
    chat: ConversationSummary,
    signals: ChatSignals,
    untrusted: string | undefined,
  ): Promise<Look> {
    const live = await this.deps.memory.list();
    const meaning = await this.deps.meaning?.().catch(() => undefined);
    return {
      said: signals.said.map((s) => s.text),
      ...(untrusted && { untrusted }),
      // Someone sees the chat: not a chat app, not another app through Conch.
      watched: !chat.origin,
      memories: new Map(live.map((m) => [m.id, m])),
      known: [...live],
      never: await this.store.never(),
      ...(meaning && { meaning }),
      appliedToday: await this.store.appliedToday(),
      appliedThisLook: 0,
    };
  }

  /** The gate's view of one change: the never-list and what's already known, looked up. */
  async #facts(change: Change, context: Look): Promise<GateContext> {
    const refused = Boolean(await neverMatch(change.text, context.never, context.meaning));
    const duplicate =
      change.op === 'add'
        ? context.known.find(
            (m) =>
              m.content.trim().toLowerCase() === change.text.trim().toLowerCase() ||
              overlap(m.content, change.text) >= 0.7,
          )
        : undefined;
    return {
      said: context.said,
      ...(context.untrusted && { untrusted: context.untrusted }),
      watched: context.watched,
      memories: context.memories,
      refused,
      ...(duplicate && { duplicate }),
      appliedThisLook: context.appliedThisLook,
      appliedToday: context.appliedToday,
      ...(this.deps.redact && { redact: this.deps.redact }),
    };
  }

  /** Apply or keep waiting one change, by the gate; the record says how it went. */
  async #keep(
    change: Change,
    ctx: GateContext,
    from: LearnedEntry['from'] & { about?: 'environment' | 'pitfall' },
  ): Promise<LearnedEntry | undefined> {
    const { about, ...source } = from;
    const verdict = gate(change, ctx, { observed: about === 'environment' });
    if (verdict.verdict === 'drop') return undefined;
    if (verdict.verdict === 'seen') {
      const known = await this.store.byMemory(verdict.memory.id);
      if (known) await this.store.update(known.id, (e) => ({ ...e, seen: e.seen + 1 }));
      return undefined;
    }
    const id = newId('le');
    const conversationId = source.conversationId;
    const waits = verdict.verdict === 'wait' ? verdict.waits : undefined;
    const kind = change.op === 'add' ? change.kind : (ctx.memories.get(change.id)?.kind ?? 'fact');
    const base = {
      content: change.text,
      kind,
      source: 'agent' as const,
      ...(conversationId && { conversationId }),
      ...(about && { about }),
      learned: id,
    };
    const why = change.op === 'supersede' ? change.why : '';
    if (change.op === 'add') {
      // Something that waits is a memory waiting for your OK, like any other (ADR 0032).
      const after = await this.deps.memory.add({
        ...base,
        ...(waits && { pending: true, untrusted: waits }),
      });
      return this.store.record({
        id,
        at: this.#now,
        change: 'added',
        after,
        why,
        from: source,
        ...(waits && { waits }),
        state: waits ? 'waiting' : 'applied',
        seen: 1,
      });
    }
    const target = ctx.memories.get(change.id);
    if (!target) return undefined;
    if (waits) {
      // Nothing changes until you say so: the record holds what would.
      const now = this.#now;
      const proposed: Memory = { id: newId('m'), ...base, createdAt: now, updatedAt: now };
      return this.store.record({
        id,
        at: now,
        change: 'superseded',
        before: target,
        after: proposed,
        why,
        from: source,
        waits,
        state: 'waiting',
        seen: 1,
      });
    }
    const moved = await this.deps.memory.supersede(target.id, base);
    if (!moved) return undefined;
    return this.store.record({
      id,
      at: this.#now,
      change: 'superseded',
      before: moved.before,
      after: moved.after,
      why,
      from: source,
      state: 'applied',
      seen: 1,
    });
  }

  #took(entry: LearnedEntry, learned: LearnedEntry[], items: LearnedItem[], context: Look) {
    learned.push(entry);
    if (entry.state === 'applied') context.appliedThisLook++;
    // What's learned now counts for the rest of this look.
    context.known.push(entry.after);
    items.push({
      entryId: entry.id,
      text: entry.after.content,
      change: entry.change,
      state: entry.state === 'waiting' ? 'waiting' : 'applied',
      ...(entry.before && { was: entry.before.content }),
      ...(entry.waits && { waits: entry.waits }),
    });
  }

  /** The look is over: the chat says what it learned (where someone can see it), and it's counted. */
  async #close(
    id: string,
    chat: ConversationSummary,
    learned: LearnedEntry[],
    items: LearnedItem[],
  ) {
    if (!learned.length) return;
    await this.store.countApplied(learned.filter((e) => e.state === 'applied').length);
    if (!chat.origin && items.length)
      await this.deps
        .note(id, { type: 'learning.noted', reviewId: newId('lr'), items: items.slice(0, 5) })
        .catch(() => undefined);
    this.deps.changed?.();
  }

  /** Ask the model; once more with the provider's own default when the cheap one fails. */
  async #ask(
    model: LearningModel,
    signals: ChatSignals,
    events: readonly ConversationEvent[],
    afterSeq: number,
    beforeSeq: number,
  ): Promise<Change[] | undefined> {
    const stretch = events.filter((e) => e.seq > afterSeq && e.seq < beforeSeq);
    const steps = turnsOf(stretch).flatMap((t) => t.steps.map((s) => s.label));
    const words = signals.said
      .map((s) => s.text)
      .join('\n')
      .slice(0, 2_000);
    // What matches what was said, then the newest: "I moved to Lisbon" shares no word
    // with "Lives in Berlin", and the review can only replace what it's shown.
    const found = (await this.deps.search(words, RELATED).catch(() => [])).map((r) => r.memory);
    const newest = (await this.deps.memory.list()).filter((m) => !m.pending);
    const memories = [...new Map([...found, ...newest].map((m) => [m.id, m])).values()].slice(
      0,
      RELATED,
    );
    const never = (await this.store.never())
      .map((n) => ({ n, o: overlap(n.text, words) }))
      .filter((x) => x.o > 0)
      .sort((a, b) => b.o - a.o)
      .slice(0, NEAR_NEVER)
      .map((x) => x.n.text);
    const prompt = reviewPrompt({
      said: signals.said.map((s) => ({ text: s.text, ...(s.signal && { signal: s.signal }) })),
      steps,
      memories,
      never,
    });
    for (const choice of model.model ? [model.model, undefined] : [undefined]) {
      try {
        const reply = await model.complete({
          system: REVIEW_SYSTEM,
          prompt,
          ...(choice && { model: choice }),
          signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
        });
        if (reply.usage) {
          await this.deps.spend.record(reply.usage, model.engine, choice).catch(() => 0);
          this.deps.onSpend?.(reply.usage, model.engine);
        }
        return parseReview(reply.text);
      } catch {
        // The provider's own default model, once, before giving up.
      }
    }
    return undefined;
  }

  // ── Your answers ───────────────────────────────────────────────────────

  /** Keep, Undo or Forget one thing learned. */
  async answer(
    entryId: string,
    answer: 'keep' | 'undo' | 'dismiss',
  ): Promise<LearnedEntry | undefined> {
    const entry = await this.store.entry(entryId);
    if (!entry) return undefined;
    const { memory } = this.deps;
    let state = entry.state;
    let after = entry.after;
    if (entry.state === 'applied' || entry.state === 'kept') {
      if (answer === 'keep') state = 'kept';
      else {
        const live = await memory.get(entry.after.id);
        if (!live) state = 'gone';
        else {
          if (entry.change === 'superseded' && entry.before)
            await memory.unsupersede(entry.after.id, entry.before);
          else await memory.remove(entry.after.id);
          await this.store.addNever(entry.after.content, 'undo');
          state = 'undone';
        }
      }
    } else if (entry.state === 'waiting') {
      if (answer === 'keep') {
        if (entry.change === 'added') {
          const kept = await memory.keep(entry.after.id);
          state = kept ? 'kept' : 'gone';
          if (kept) after = kept;
        } else {
          const moved = entry.before
            ? await memory.supersede(entry.before.id, {
                content: entry.after.content,
                kind: entry.after.kind,
                source: 'agent',
                ...(entry.after.conversationId && { conversationId: entry.after.conversationId }),
                ...(entry.after.about && { about: entry.after.about }),
                learned: entry.id,
              })
            : undefined;
          state = moved ? 'kept' : 'gone';
          if (moved) after = moved.after;
        }
      } else {
        if (entry.change === 'added') await memory.remove(entry.after.id);
        await this.store.addNever(entry.after.content, 'dismissed');
        state = 'dismissed';
      }
    } else return entry;
    // Waiting is over, whichever way it went.
    const next = await this.store.update(entry.id, ({ waits: _waits, ...e }) => ({
      ...e,
      state,
      after,
    }));
    const chat = entry.from.conversationId;
    if (chat && (state === 'undone' || state === 'kept' || state === 'dismissed'))
      await this.deps
        .note(
          chat,
          // What the assistant remembered in the chat shows as a "Remembered" pill there.
          entry.from.trigger === 'tool'
            ? { type: 'memory.decided', memoryId: entry.after.id, kept: state === 'kept' }
            : { type: 'learning.decided', entryId: entry.id, state },
        )
        .catch(() => undefined);
    this.deps.changed?.();
    return next;
  }

  /**
   * A person forgot a memory (the Memory page, or Undo on "Remembered"):
   * when Conch wrote it, it isn't learned again, and the record says so.
   */
  async forgotten(memory: Memory): Promise<void> {
    if (memory.source === 'user') return;
    await this.store.addNever(memory.content, 'forgot');
    const entry = await this.store.byMemory(memory.id);
    if (
      entry &&
      (entry.state === 'applied' || entry.state === 'kept' || entry.state === 'waiting')
    ) {
      await this.store.update(entry.id, (e) => ({ ...e, state: 'undone' }));
      if (entry.from.conversationId)
        await this.deps
          .note(entry.from.conversationId, {
            type: 'learning.decided',
            entryId: entry.id,
            state: 'undone',
          })
          .catch(() => undefined);
    }
    this.deps.changed?.();
  }

  /**
   * A person kept a memory that waited, or put one back: its record says so,
   * and words they put back themselves come off the never-list.
   */
  async kept(memory: Memory): Promise<void> {
    if (await this.store.forgive(memory.content)) this.deps.changed?.();
    const entry = await this.store.byMemory(memory.id);
    if (entry?.state !== 'waiting') return;
    await this.store.update(entry.id, ({ waits: _waits, ...e }) => ({
      ...e,
      state: 'kept',
      after: memory,
    }));
    if (entry.from.conversationId)
      await this.deps
        .note(entry.from.conversationId, {
          type: 'learning.decided',
          entryId: entry.id,
          state: 'kept',
        })
        .catch(() => undefined);
    this.deps.changed?.();
  }

  /** The assistant remembered something in a chat (`remember`): the record holds it too. */
  async remembered(memory: Memory, chat?: { id: string; title?: string }): Promise<void> {
    if (memory.source !== 'agent' || (await this.store.byMemory(memory.id))) return;
    await this.store.record({
      at: this.#now,
      change: 'added',
      after: memory,
      why: '',
      from: {
        ...(chat && { conversationId: chat.id }),
        ...(chat?.title && { chatTitle: chat.title.slice(0, 200) }),
        quotes: [],
        signals: [],
        trigger: 'tool',
      },
      ...(memory.pending && memory.untrusted && { waits: memory.untrusted }),
      state: memory.pending ? 'waiting' : 'applied',
      seen: 1,
    });
    this.deps.changed?.();
  }

  // ── What a turn is told ────────────────────────────────────────────────

  /** The few preferences that bear on this message, to go just before it (ADR 0088 § 7). */
  nearby(said: string): Promise<string | undefined> {
    return nearTheQuestion(said, this.deps.search);
  }

  /** Whether the person took this back once: `remember` waits for them then. */
  async refuses(content: string): Promise<boolean> {
    const meaning = await this.deps.meaning?.().catch(() => undefined);
    return Boolean(await neverMatch(content, await this.store.never(), meaning));
  }

  // ── Chats you don't want learned from ──────────────────────────────────

  async quiet(conversationId: string, quiet: boolean): Promise<void> {
    await this.store.setChat(conversationId, { quiet });
    this.deps.changed?.();
  }

  async isQuiet(conversationId: string): Promise<boolean> {
    return Boolean((await this.store.chat(conversationId)).quiet);
  }

  // ── What the Memory page shows ─────────────────────────────────────────

  async status(): Promise<LearningStatus> {
    const [{ autoMemory }, entries, never, past, spending, quiet, seen] = await Promise.all([
      this.deps.settings(),
      this.store.entries(),
      this.store.never(),
      this.deps.memory.listPast().catch(() => []),
      this.deps.spend.state(),
      this.store.quiet(),
      this.store.recapSeen(),
    ]);
    const since = Math.max(this.#now - 7 * DAY, seen ?? 0);
    const week = entries.filter(
      (e) => e.at > since && (e.state === 'applied' || e.state === 'kept'),
    );
    return {
      on: autoMemory,
      entries: entries.slice(0, 50),
      waiting: entries.filter((e) => e.state === 'waiting').length,
      never,
      past: past.slice(0, 50),
      ...(week.length && {
        recap: {
          since,
          count: week.length,
          items: week.slice(0, 3).map((e) => e.after.content.slice(0, 300)),
        },
      }),
      spending,
      ...(spending.paused
        ? { paused: { reason: 'cap' as const, until: spending.paused.until } }
        : this.#noModel && { paused: { reason: 'no-model' as const } }),
      quiet,
    };
  }

  /** "Got it" on the week's recap. */
  async seeRecap(): Promise<void> {
    await this.store.seeRecap(this.#now);
    this.deps.changed?.();
  }

  async removeNever(id: string): Promise<boolean> {
    const removed = await this.store.removeNever(id);
    if (removed) this.deps.changed?.();
    return removed;
  }
}
