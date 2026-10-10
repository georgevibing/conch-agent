import { approvalOf, foldHolds } from '@conch/protocol';
import type {
  AgentId,
  WaitNote,
  RoundEnd,
  RoundSpeaker,
  Memory,
  AppNeed,
  AppsModel,
  ArtifactKind,
  Attachment,
  ChangedFile,
  ConchAppOffer,
  ConchAppShareCard,
  PastChatSeen,
  TaintSource,
  VaultPermission,
  VaultRequest,
  BrowserHandoff,
  BrowserPermission,
  BrowserStep,
  ConversationEvent,
  ConversationStatus,
  Question,
  QuestionAnswer,
  SkillHold,
  EngineId,
  Offer,
  OfferOutcome,
  TaskKind,
  TaskStatus,
  ToolProgress,
  ToolApproval,
  ToolStatus,
  ToolView,
  TurnOptions,
  TurnPause,
  TurnProblem,
  PlanStep,
  SpendLimitKind,
  SpendModel,
  TurnCost,
  ContextFill,
  Usage,
  LearnedItem,
  MemoryHold,
  PermissionMode,
  NarrationSource,
  ToolLabel,
  WorkedAt,
  ScriptAsk,
  ScriptCall,
  ScriptRun,
} from '@conch/protocol';

import { latestReplies, type LatestReplies } from '../features/replies/latest';
import { foldPlan } from '../features/plans/fold';

/** Everything the transcript renders, folded from the append-only event log. */
/** What a chat last heard of a task it sent (`task` events): its card when the task is gone. */
export interface TaskNote {
  taskId: string;
  title: string;
  taskKind: TaskKind;
  state: TaskStatus;
  summary?: string;
  /** Another provider is doing it, by name. */
  by?: string;
}

export type TranscriptItem =
  | {
      kind: 'user';
      id: string;
      text: string;
      at: number;
      pending?: boolean;
      /** Files and long pastes sent with it. */
      attachments?: Attachment[];
    }
  | {
      kind: 'assistant';
      /** Unique per visual segment: `messageId` or `messageId#n`. */
      id: string;
      messageId: string;
      /** A later segment of the same turn (after tools) — rendered without a header. */
      continuation: boolean;
      text: string;
      thinking: string;
      done: boolean;
      startedAt: number;
      /** When the first visible text arrived — thinking ended. */
      textAt?: number;
      /** When something else (a tool, a prompt) interrupted the thinking. */
      thoughtEndedAt?: number;
      endedAt?: number;
    }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: unknown;
      status: ToolStatus;
      output?: string;
      durationMs?: number;
      startedAt: number;
      /** What it found, drawn under its row (ADR 0060). */
      view?: ToolView;
      /**
       * It in plain words (ADR 0103), as the gateway wrote it: `doing` words
       * while it runs, then the finished words with what it found. A chat
       * logged before labels has none; the chat works them out (`stepFromTool`).
       */
      label?: ToolLabel;
      /** It asked first, or a rule stopped it: how that went (from the decision, never its words). */
      approval?: ToolApproval;
      /** Nobody answered its question in this many minutes, so it didn't run (ADR 0108). */
      unanswered?: number;
      /** Where the command ran, when it wasn't this computer (ADR 0106). */
      where?: WorkedAt;
      /**
       * How far it has come while it runs (a picture being made): the latest
       * word, and when the first came (the request went out, past any approval).
       */
      progress?: Omit<ToolProgress, 'toolName' | 'toolUseId'> & { at: number; since: number };
    }
  | {
      kind: 'permission';
      id: string;
      toolName: string;
      /** The call it's about, when it has a row: the answer folds into that row. */
      toolUseId?: string;
      summary: string;
      /** The card's short title, and its quiet line of facts (ADR 0028). */
      title?: string;
      detail?: string;
      cost?: string;
      /** Why to look twice, short, each place named once. */
      caution?: string;
      input: unknown;
      decision?: 'allow' | 'allow-always' | 'deny' | 'expired';
      /** The browser asking about a site or a significant action. */
      browser?: BrowserPermission;
      /** Reading something from Passwords (ADR 0025). */
      vault?: VaultPermission;
      /** Asked because the chat read something untrusted (ADR 0028): why. No "always". */
      taint?: string;
      /** Asked for a reason "Always allow" can lift (what it read, the sealed box). */
      lasting?: boolean;
      /** The words on Always allow when it means every chat (ADR 0128). */
      always?: string;
      /** Shows what goes to other people, so it's asked each time: no "always". */
      once?: boolean;
      /** The person may change it before allowing it (an email's words): the answer carries it. */
      editable?: boolean;
      /** Asked from inside a script (ADR 0123): which run, and which of its calls. */
      script?: ScriptAsk;
    }
  | {
      /**
       * A script that calls tools (ADR 0123): the run as it stands, and the
       * calls it made, latest word for each. One story, however many calls.
       */
      kind: 'script';
      id: string;
      run: ScriptRun;
      calls: ScriptCall[];
    }
  | {
      /**
       * A question with answers to tap (ADR 0060): the reply waits for it.
       * `answer` is absent while it waits, `null` once skipped (or stopped).
       */
      kind: 'question';
      id: string;
      question: Question;
      answer?: QuestionAnswer | null;
      at: number;
    }
  | {
      /** Files the assistant created, changed or deleted, which can be put back (ADR 0030). */
      kind: 'files';
      id: string;
      toolUseId?: string;
      label: string;
      files: ChangedFile[];
      state: 'applied' | 'undone';
    }
  | {
      /** The chat read something from outside: sending and changing ask first from here (ADR 0028). */
      kind: 'taint';
      id: string;
      source: TaintSource;
      /** Read in another chat and carried here: the one a task came from, or a task's. */
      carried?: boolean;
    }
  | {
      /** Passwords needs you (unlock it, or type in a credential); later events with the same id replace it. */
      kind: 'vault-request';
      id: string;
      request: VaultRequest;
    }
  | {
      /** One browser step; a later event with the same id replaces it (running → done). */
      kind: 'browser';
      id: string;
      step: BrowserStep;
      at: number;
    }
  | { kind: 'handoff'; id: string; handoff: BrowserHandoff }
  | {
      kind: 'memory';
      id: string;
      memoryId: string;
      content: string;
      action: 'saved' | 'forgotten';
      /** When it was said: where its step sits among the run's (ADR 0103). */
      at?: number;
      /** Waits for an OK: learned where nobody could undo it (ADR 0032). */
      pending?: boolean;
      /** What you said since: kept it (or put back one it forgot), or undid it. */
      decided?: 'kept' | 'undone';
      /** One it forgot, whole, so Undo can put it back. */
      memory?: Memory;
      /** The memory check held it (ADR 0087): why, and where it came from. */
      held?: MemoryHold;
    }
  /**
   * What the chat taught Conch once it went quiet (ADR 0088): one folded line.
   * `decided` holds what you answered since, by record id.
   */
  | {
      kind: 'learned';
      id: string;
      items: LearnedItem[];
      decided: Record<string, 'undone' | 'kept' | 'dismissed' | 'gone'>;
    }
  | {
      /** It looked through your other chats (ADR 0059): for what, with a link to each place. */
      kind: 'looked';
      id: string;
      action: 'search' | 'read';
      query?: string;
      close?: boolean;
      chats: PastChatSeen[];
      at: number;
    }
  | {
      /** Something the assistant made (ADR 0034): a card that opens it beside the chat. */
      kind: 'artifact';
      id: string;
      artifactId: string;
      title: string;
      artifactKind: ArtifactKind;
      version: number;
      /** `edited`: you changed it by hand (ADR 0046). */
      action: 'created' | 'updated' | 'edited';
      note?: string;
      at: number;
    }
  | {
      kind: 'routine';
      id: string;
      routineId: string;
      action: 'proposed' | 'updated' | 'paused' | 'deleted';
      title: string;
    }
  | {
      /** A standing order the assistant suggested (ADR 0107): Keep it or Not now. */
      kind: 'standing-order';
      id: string;
      orderId: string;
      text: string;
    }
  | {
      /**
       * Tasks sent from this chat together (one batch, `Task.group`), or one on
       * its own: one card, kept current, in the order they started.
       */
      kind: 'task';
      id: string;
      group?: string;
      tasks: TaskNote[];
    }
  | {
      /** Something Conch waits for on the assistant's behalf (ADR 0125): one row, kept current. */
      kind: 'wait';
      id: string;
      wait: WaitNote;
    }
  | {
      kind: 'integration-issue';
      id: string;
      integrationId: string;
      name: string;
      catalogId?: string;
      state: 'needs-auth' | 'error';
      message: string;
    }
  | {
      /**
       * An offer to turn on what a request is missing, an app or a skill (ADR
       * 0060). Taken, it moves to where the chat carried on from.
       */
      kind: 'offer';
      /** The offer's id. */
      id: string;
      offer: Offer;
      /** How it ended, once it did. */
      resolution?: OfferOutcome;
      /**
       * From an older log (`integration.suggestion`, ADR 0021): the chat can't
       * carry on from it, so once connected it asks the question again.
       */
      legacy?: boolean;
      /** The message that brought it up. */
      askedIn?: string;
    }
  | {
      /**
       * An app the assistant made or found, offered to add (ADR 0061). The
       * newest event for its `offerId` replaces it where it is: added,
       * updated, declined, stale.
       */
      kind: 'conch-app-offer';
      /** The offer's id. */
      id: string;
      offer: ConchAppOffer;
      at: number;
    }
  | {
      /** "Put it on GitHub": the share buttons, for the person to press (ADR 0061). */
      kind: 'conch-app-share';
      id: string;
      share: ConchAppShareCard;
      at: number;
    }
  | {
      kind: 'skill';
      id: string;
      skillId: string;
      name: string;
      title: string;
      /** `carried`: work brought it from another chat (ADR 0047). */
      by: 'user' | 'assistant' | 'carried';
    }
  | {
      /** You stopped holding the chat to a skill's list (ADR 0047). */
      kind: 'skill-ended';
      id: string;
      title: string;
    }
  | {
      /** Waiting for the internet (ADR 0023); `sent` once it went by itself. */
      kind: 'held';
      id: string;
      at: number;
      /** How many messages wait together (they go as one). */
      count: number;
      sent?: boolean;
    }
  | {
      /**
       * The chat's model can't use what a message needs (ADR 0050): it waits
       * for a choice. `settled` says how it went once it did.
       */
      kind: 'needs-apps';
      id: string;
      needs: AppNeed[];
      model: { engine: EngineId; id: string; label: string };
      switchTo?: AppsModel;
      settled?: 'switched' | 'answered';
    }
  | {
      /**
       * A message (or a reply part way) met a spending limit (ADR 0079): it
       * waits for one tap. `settled` says how it went on; `moved-on` when a
       * newer message came instead.
       */
      kind: 'capped';
      id: string;
      limit: SpendLimitKind;
      spentUsd: number;
      limitUsd: number;
      raiseTo: number;
      switchTo?: SpendModel;
      during?: boolean;
      settled?: 'raised' | 'switched' | 'stopped' | 'moved-on';
    }
  | {
      /** A quiet word about money, said once when it matters (ADR 0079). */
      kind: 'spend-note';
      id: string;
      note: 'budget-near' | 'pricier' | 'stopped';
      message: string;
    }
  | {
      /**
       * Where the model's word-for-word memory of a long chat starts (ADR 0055):
       * what's above was folded into `summary`. Only the latest one is kept.
       */
      kind: 'summary';
      id: string;
      summary: string;
      engine: EngineId;
      model?: string;
      turns: number;
    }
  | {
      /**
       * `/clear`: from here the model reads nothing said above, whichever
       * provider answers. Gone again if it was undone (`context.restored`).
       */
      kind: 'cleared';
      id: string;
      seq: number;
    }
  | {
      /**
       * Another agent answers from here on (ADR 0101): a divider. `name` as it
       * was then; `from`, who answered before, on the chat's first one.
       */
      kind: 'agent';
      id: string;
      seq: number;
      agentId: AgentId;
      name: string;
      from?: { agentId: AgentId; name: string };
      /** Before anything was said: who the chat is with from its start, not a change (no divider). */
      opening: boolean;
      /** Handed the floor in a round (ADR 0112): by whom (absent: you asked). */
      round?: { roundId: string; turn: number; by?: string };
    }
  | {
      /**
       * Agents taking turns (ADR 0112): one card where the round began, kept
       * up to date as the floor passes (`passes`, by id), until it ends.
       */
      kind: 'round';
      id: string;
      seq: number;
      roundId: string;
      speakers: RoundSpeaker[];
      passes: string[];
      /** An outside agent being asked right now. */
      asking?: string;
      ended?: { reason: RoundEnd; turns: number };
      /** When anything last happened in it: a round that went quiet long ago ended with Conch. */
      at: number;
    }
  | {
      /** What an outside agent said (ADR 0112): someone else's words, shown as theirs. */
      kind: 'peer';
      id: string;
      seq: number;
      outsideId: string;
      name: string;
      text: string;
      failed?: boolean;
    }
  | {
      /** Where the chat's goal (`/goal`) was set, or cleared (no `goal`). */
      kind: 'goal-note';
      id: string;
      goal?: string;
    }
  | {
      /** Another provider answered for this chat's own: offline, or at a usage limit. */
      kind: 'routed';
      id: string;
      from: EngineId;
      to: EngineId;
      reason: 'offline' | 'limit';
      message: string;
      /** At a limit, the chat moved to `to` for good (ADR 0126). */
      stayed?: boolean;
      /** Switched back: this chat waits for `from` at this limit, until then (ADR 0126). */
      back?: { until?: number };
    }
  | {
      /** The assistant's plan for one turn (ADR 0060): kept current in place, folded once it ends. */
      kind: 'plan';
      id: string;
      steps: PlanStep[];
    }
  | {
      kind: 'turn-end';
      id: string;
      outcome: 'success' | 'interrupted' | 'error';
      error?: string;
      /** Why it failed, when Conch can tell: decides what the chat offers. */
      problem?: TurnProblem;
      /** It stopped to check in, not because it was done (ADR 0085): Carry on picks it up. */
      paused?: TurnPause;
      /**
       * Conch restarted mid-turn; `resumed`: it carries on by itself. `reason`:
       * paused on purpose at a safe point (its own `update`, a `restart` asked for).
       */
      restarted?: { resumed: boolean; reason?: 'update' | 'restart' };
      usage?: Usage;
      /** What it cost, the way its provider charges (ADR 0079). */
      cost?: TurnCost;
      /** How long it ran, start to end, when this page saw it start. */
      ranMs?: number;
      /** Which provider answered, and with which model. */
      engine?: EngineId;
      model?: string;
    };

export interface ConversationView {
  lastSeq: number;
  /**
   * Who answers from the latest `agent` event on (ADR 0101); unset until the
   * chat changes agent (then it's the chat's own, `ConversationSummary.agentId`).
   */
  speaker?: { agentId: AgentId; name: string };
  items: TranscriptItem[];
  status: ConversationStatus;
  title?: string;
  /** Start of the currently running turn (for elapsed timers). */
  turnStartedAt?: number;
  /** A live, transient notice from the engine (e.g. "retrying…"); clears when progress resumes. */
  notice?: { code: string; message: string };
  /** The conversation's model/effort/mode overrides, as last seen in the log. */
  options?: TurnOptions;
  /** The skills this chat is held to (ADR 0047), as the gateway reads them from the same log. */
  holds?: readonly SkillHold[];
  /** Replies to send next under the latest reply (ADR 0060); gone once anything newer arrives. */
  replies?: LatestReplies;
  /** What the running turn has used so far, as it goes (`turn.usage`); gone when it ends. */
  working?: Usage;
  /** How full the context is, as last heard: live while a turn runs, its last word after. */
  context?: ContextFill;
  /** The whole log so far is here (the gateway said so), not just what happened while watching. */
  loaded?: boolean;
  /** What the chat is for (`/goal`), as the gateway reads it from the same log. */
  goal?: string;
  /** The `/clear`s still in force (their seqs), oldest first: Undo takes back the newest. */
  clears?: readonly number[];
  /** In plan mode: the mode it had before (`null`: it followed your default), for `/plan off`. */
  beforePlan?: PermissionMode | null;
  /**
   * What the provider last said it's doing, for the running story's live line
   * (ADR 0103). Gone when the turn ends or a new message starts one.
   */
  narration?: Narration;
  /** Story headlines written once a story ended (ADR 0103), by the story's first tool call. */
  titles?: Readonly<Record<string, StoryHeadline>>;
}

/** The provider's latest note for the person watching (ADR 0103). */
export interface Narration {
  text: string;
  /** The tool call it's about, when it's about one. */
  toolUseId?: string;
  source: NarrationSource;
  at: number;
}

/** A story's headline from `story.titled`. */
export interface StoryHeadline {
  headline: string;
  outcome?: string;
  source: NarrationSource;
}

export const emptyView: ConversationView = { lastSeq: -1, items: [], status: 'idle' };

/** An offer from an older log has no id of its own: one per app per chat. */
export const legacyOfferId = (catalogId: string) => `legacy-${catalogId}`;

/**
 * Where a turn begins: a message of yours, or an offer you took (the chat
 * carries on with no new message, ADR 0060).
 */
export const isTurnStart = (item: TranscriptItem) =>
  item.kind === 'user' || (item.kind === 'offer' && item.resolution === 'accepted');

function addOffer(
  base: ConversationView,
  items: TranscriptItem[],
  { offer, legacy }: { offer: Offer; legacy?: boolean },
): ConversationView {
  if (
    items.some(
      (i) =>
        i.kind === 'offer' &&
        (i.id === offer.offerId ||
          (legacy && i.offer.kind === 'app' && i.offer.target === offer.target)),
    )
  )
    return base;
  const asked = items.findLast((i) => i.kind === 'user');
  return {
    ...base,
    items: [
      ...items,
      {
        kind: 'offer',
        id: offer.offerId,
        offer,
        ...(legacy && { legacy }),
        ...(asked && { askedIn: asked.id }),
      },
    ],
  };
}

function updateItem<K extends TranscriptItem['kind']>(
  items: TranscriptItem[],
  kind: K,
  id: string,
  fn: (item: Extract<TranscriptItem, { kind: K }>) => TranscriptItem,
): TranscriptItem[] | undefined {
  const index = items.findLastIndex((i) => i.kind === kind && i.id === id);
  if (index === -1) return undefined;
  const next = items.slice();
  next[index] = fn(items[index] as Extract<TranscriptItem, { kind: K }>);
  return next;
}

/** Thinking that's followed by a tool call ends there, for "Thought for Ns". */
function sealThinking(items: TranscriptItem[], at: number): TranscriptItem[] {
  const last = items.at(-1);
  if (last?.kind !== 'assistant' || last.textAt || last.thoughtEndedAt || !last.thinking)
    return items;
  return [...items.slice(0, -1), { ...last, thoughtEndedAt: at }];
}

/**
 * Pure fold of one event into a view. Events at or below `lastSeq` are ignored,
 * so replays after a reconnect are idempotent.
 */
export function reduce(view: ConversationView, event: ConversationEvent): ConversationView {
  if (event.seq <= view.lastSeq) return view;
  // Real progress (or the end of the turn) makes a stale "retrying…" notice irrelevant.
  const progressed =
    (event.type === 'assistant.delta' && event.kind === 'text') ||
    event.type === 'tool.started' ||
    event.type === 'turn.completed' ||
    event.type === 'user.message';
  const base = {
    ...view,
    lastSeq: event.seq,
    notice: progressed ? undefined : view.notice,
    replies: latestReplies(view.replies, event),
    ...((event.type === 'skill.used' || event.type === 'skill.hold.ended') && {
      holds: foldHolds(view.holds ?? [], event),
    }),
  };
  const items =
    event.type === 'tool.started' ||
    event.type === 'permission.requested' ||
    event.type === 'question' ||
    event.type === 'memory.saved'
      ? sealThinking(view.items, event.at)
      : view.items;

  switch (event.type) {
    case 'turn.usage':
      return {
        ...base,
        working: event.usage,
        ...(event.context && { context: event.context }),
      };
    case 'user.message': {
      const withoutPending = items.filter((i) => !(i.kind === 'user' && i.id === event.messageId));
      return {
        ...base,
        turnStartedAt: event.at,
        working: undefined,
        narration: undefined,
        items: [
          // A message waiting at a spending limit goes with this one, or is let go (ADR 0079).
          ...settleCapped(withoutPending, 'moved-on'),
          {
            kind: 'user',
            id: event.messageId,
            text: event.text,
            at: event.at,
            ...(event.attachments?.length && { attachments: event.attachments }),
          },
        ],
      };
    }
    case 'assistant.delta': {
      // Append to the last item if it's this message; otherwise (tools or
      // prompts arrived in between) start a new segment so order stays true.
      const last = items.at(-1);
      if (last?.kind === 'assistant' && last.messageId === event.messageId) {
        const next = items.slice();
        next[next.length - 1] = {
          ...last,
          text: event.kind === 'text' ? last.text + event.delta : last.text,
          thinking: event.kind === 'thinking' ? last.thinking + event.delta : last.thinking,
          textAt: last.textAt ?? (event.kind === 'text' ? event.at : undefined),
        };
        return { ...base, items: next };
      }
      const turnStart = items.findLastIndex(isTurnStart);
      const earlier = items.slice(turnStart + 1).filter((i) => i.kind === 'assistant');
      const segment = earlier.filter(
        (i) => i.kind === 'assistant' && i.messageId === event.messageId,
      ).length;
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'assistant',
            id: segment ? `${event.messageId}#${segment}` : event.messageId,
            messageId: event.messageId,
            continuation: earlier.length > 0,
            text: event.kind === 'text' ? event.delta : '',
            thinking: event.kind === 'thinking' ? event.delta : '',
            done: false,
            startedAt: event.at,
            textAt: event.kind === 'text' ? event.at : undefined,
          },
        ],
      };
    }
    case 'assistant.done': {
      let changed = false;
      const next = items.map((i) => {
        if (i.kind !== 'assistant' || i.messageId !== event.messageId || i.done) return i;
        changed = true;
        return { ...i, done: true, endedAt: event.at };
      });
      return changed ? { ...base, items: next } : base;
    }
    case 'tool.started':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'tool',
            id: event.toolUseId,
            name: event.name,
            input: event.input,
            status: 'running',
            startedAt: event.at,
            ...(event.label && { label: event.label }),
          },
        ],
      };
    case 'tool.finished': {
      const updated = updateItem(items, 'tool', event.toolUseId, (item) => ({
        ...item,
        status: event.status,
        output: event.output,
        durationMs: event.durationMs,
        ...(event.view && { view: event.view }),
        ...(event.where && { where: event.where }),
        // The finished words (with what it found) replace the running ones; without
        // them, the chat works them out from the result rather than keep `doing` words.
        label: event.label,
        ...(event.approval && { approval: event.approval }),
      }));
      return updated ? { ...base, items: updated } : base;
    }
    case 'tool.progress': {
      // Without an id it's the newest unfinished call of that tool (one at a time per chat).
      const bare = (name: string) => name.replace(/^mcp__[^_]+__/, '');
      const target = event.toolUseId
        ? items.findLastIndex((i) => i.kind === 'tool' && i.id === event.toolUseId)
        : items.findLastIndex(
            (i) =>
              i.kind === 'tool' &&
              (i.status === 'running' || i.status === 'pending') &&
              bare(i.name) === bare(event.toolName),
          );
      const item = items[target];
      if (item?.kind !== 'tool' || (item.status !== 'running' && item.status !== 'pending'))
        return base;
      const { at, progress, stage, estimated, preview, by, detail } = event;
      const word = { progress, stage, estimated, preview, by, detail };
      const next = items.slice();
      next[target] = {
        ...item,
        progress: {
          ...word,
          // Never going back, whatever order a replay brings.
          ...(word.progress !== undefined && {
            progress: Math.max(word.progress, item.progress?.progress ?? 0),
          }),
          // The latest rough picture wins; a word without one keeps the last.
          preview: word.preview ?? item.progress?.preview,
          by: word.by ?? item.progress?.by,
          // The step it's on: a word without one keeps the last.
          detail: word.detail ?? item.progress?.detail,
          at,
          since: item.progress?.since ?? at,
        },
      };
      return { ...base, items: next };
    }
    case 'permission.requested':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'permission',
            id: event.permissionId,
            toolName: event.toolName,
            ...(event.toolUseId && { toolUseId: event.toolUseId }),
            summary: event.summary,
            ...(event.title && { title: event.title }),
            ...(event.detail && { detail: event.detail }),
            ...(event.cost && { cost: event.cost }),
            ...(event.caution && { caution: event.caution }),
            input: event.input,
            browser: event.browser,
            ...(event.vault && { vault: event.vault }),
            ...(event.taint && { taint: event.taint }),
            ...((event.lasting || event.afterReading) && { lasting: true }),
            ...(event.always && { always: event.always }),
            ...(event.once && { once: true }),
            ...(event.editable && { editable: true }),
            ...(event.script && { script: event.script }),
          },
        ],
      };
    case 'script.run': {
      const { conversationId: _c, seq: _s, at: _a, type: _t, ...run } = event;
      const updated = updateItem(items, 'script', event.runId, (item) => ({
        ...item,
        // The script itself comes on the first and last word; the rest leave it out.
        run: { ...run, script: run.script ?? item.run.script },
      }));
      return {
        ...base,
        items: updated ?? [...items, { kind: 'script', id: event.runId, run, calls: [] }],
      };
    }
    case 'script.call': {
      const { conversationId: _c, seq: _s, at: _a, type: _t, ...call } = event;
      const updated = updateItem(items, 'script', event.runId, (item) => {
        const at = item.calls.findLastIndex((c) => c.callId === call.callId);
        const calls = item.calls.slice();
        if (at === -1) calls.push(call);
        else calls[at] = call;
        return { ...item, calls };
      });
      return updated ? { ...base, items: updated } : base;
    }
    case 'files.changed':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'files',
            id: event.changeSetId,
            ...(event.toolUseId && { toolUseId: event.toolUseId }),
            label: event.label,
            files: event.files,
            state: 'applied',
          },
        ],
      };
    case 'files.restored': {
      const updated = updateItem(items, 'files', event.changeSetId, (item) => ({
        ...item,
        state: event.direction === 'undo' ? 'undone' : 'applied',
      }));
      return updated ? { ...base, items: updated } : base;
    }
    case 'taint':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'taint',
            id: `taint-${event.seq}`,
            source: event.source,
            ...(event.carried && { carried: true }),
          },
        ],
      };
    case 'vault.request': {
      const updated = updateItem(items, 'vault-request', event.request.requestId, (item) => ({
        ...item,
        request: event.request,
      }));
      if (updated) return { ...base, items: updated };
      return {
        ...base,
        items: [
          ...items,
          { kind: 'vault-request', id: event.request.requestId, request: event.request },
        ],
      };
    }
    case 'permission.resolved': {
      let about: string | undefined;
      const updated = updateItem(items, 'permission', event.permissionId, (item) => {
        about = item.toolUseId;
        return { ...item, decision: event.decision };
      });
      const unanswered = event.decision === 'expired' ? event.unanswered : undefined;
      if (!updated) return base;
      // The answer belongs to the call it was about: its row says so from now on.
      const call =
        about &&
        updateItem(updated, 'tool', about, (item) => ({
          ...item,
          approval: approvalOf(event.decision),
          ...(unanswered && { unanswered }),
        }));
      return { ...base, items: call || updated };
    }
    case 'memory.saved': {
      const item = {
        kind: 'memory' as const,
        id: `mem-${event.seq}`,
        memoryId: event.memory.id,
        content: event.memory.content,
        action: 'saved' as const,
        at: event.at,
        ...(event.memory.pending && { pending: true }),
        ...(event.memory.held && { held: event.memory.held }),
      };
      // Held again after it was remembered (a plant in pieces, ADR 0087): the same line, now asking.
      const at = items.findIndex(
        (i) => i.kind === 'memory' && i.memoryId === event.memory.id && i.action === 'saved',
      );
      if (at !== -1 && event.memory.held)
        return { ...base, items: items.map((i, n) => (n === at ? { ...item, id: i.id } : i)) };
      return { ...base, items: [...items, item] };
    }
    case 'chats.looked':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'looked',
            id: event.lookId,
            action: event.action,
            ...(event.query !== undefined && { query: event.query }),
            ...(event.close && { close: true }),
            chats: event.chats,
            at: event.at,
          },
        ],
      };
    case 'memory.decided': {
      const decided = event.kept ? ('kept' as const) : ('undone' as const);
      let found = false;
      const updated = items.map((item) => {
        if (item.kind !== 'memory' || item.memoryId !== event.memoryId) return item;
        // Putting back one it forgot answers its "Forgot" line; it says nothing to an older one.
        if (item.action === 'forgotten' && !event.kept) return item;
        found = true;
        // Kept in your own words (Edit first): its step says what was kept.
        const words = event.edited && event.content !== undefined ? event.content : item.content;
        return { ...item, decided, pending: false, content: words };
      });
      return found ? { ...base, items: updated } : base;
    }
    // What the chat taught Conch once it went quiet (ADR 0088): one quiet line at its end.
    case 'learning.noted':
      return {
        ...base,
        items: [
          ...items,
          { kind: 'learned', id: `learned-${event.reviewId}`, items: event.items, decided: {} },
        ],
      };
    case 'learning.decided': {
      let found = false;
      const updated = items.map((item) => {
        if (item.kind !== 'learned' || !item.items.some((i) => i.entryId === event.entryId))
          return item;
        found = true;
        return { ...item, decided: { ...item.decided, [event.entryId]: event.state } };
      });
      return found ? { ...base, items: updated } : base;
    }
    case 'memory.forgotten':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'memory',
            id: `mem-${event.seq}`,
            memoryId: event.memoryId,
            content: event.content,
            action: 'forgotten',
            at: event.at,
            ...(event.memory && { memory: event.memory }),
          },
        ],
      };
    case 'status':
      // A waiting message that starts running went by itself: say so, quietly.
      return {
        ...base,
        status: event.status,
        items: event.status === 'running' ? settleNeeds(sendHeld(items), view.options) : items,
      };
    case 'turn.needs-apps':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'needs-apps',
            id: `needs-apps-${event.seq}`,
            needs: event.needs,
            model: event.model,
            ...(event.switchTo && { switchTo: event.switchTo }),
          },
        ],
      };
    case 'turn.held': {
      // One card, at the end, counting what waits: a failure that led here
      // (the provider couldn't be reached) is said by the card instead.
      const waiting = items.findLast((i) => i.kind === 'held' && !i.sent);
      const kept = items.filter(
        (i, n) =>
          i !== waiting &&
          !(n === items.length - 1 && i.kind === 'turn-end' && i.outcome === 'error' && i.problem),
      );
      const since = kept.findLastIndex((i) => i.kind === 'turn-end' || i.kind === 'assistant');
      const count = kept.slice(since + 1).filter((i) => i.kind === 'user').length;
      return {
        ...base,
        items: [
          ...kept,
          { kind: 'held', id: `held-${event.seq}`, at: event.at, count: Math.max(1, count) },
        ],
      };
    }
    case 'context.compacted': {
      // One line, where the model's memory starts now: the new one replaces any before it.
      const kept = items.filter((i) => i.kind !== 'summary');
      const at = event.before
        ? kept.findIndex((i) => i.kind === 'user' && i.id === event.before)
        : kept.findLastIndex((i) => i.kind === 'user');
      const line: TranscriptItem = {
        kind: 'summary',
        id: `summary-${event.seq}`,
        summary: event.summary,
        engine: event.engine,
        ...(event.model && { model: event.model }),
        turns: event.turns,
      };
      return {
        ...base,
        // Summarised: the old reading is gone; the next request says how full it is now.
        context: undefined,
        items: at === -1 ? [...kept, line] : [...kept.slice(0, at), line, ...kept.slice(at)],
      };
    }
    case 'agent': {
      // The round's card hears of each pass of the floor (ADR 0112).
      const round = event.round;
      const passed: TranscriptItem[] = round
        ? items.map((item) =>
            item.kind === 'round' && item.roundId === round.roundId
              ? {
                  ...item,
                  asking: undefined,
                  at: event.at,
                  passes:
                    item.passes.at(-1) === event.agentId
                      ? item.passes
                      : [...item.passes, event.agentId],
                }
              : item,
          )
        : items;
      return {
        ...base,
        speaker: { agentId: event.agentId, name: event.name },
        items: [
          ...passed,
          {
            kind: 'agent',
            id: `agent-${event.seq}`,
            seq: event.seq,
            agentId: event.agentId,
            name: event.name,
            ...(event.from && { from: event.from }),
            ...(round && { round }),
            opening: !items.some((i) => i.kind === 'user'),
          },
        ],
      };
    }
    case 'round': {
      if (event.state === 'started') {
        const first = event.speakers?.[0];
        return {
          ...base,
          items: [
            ...items,
            {
              kind: 'round',
              id: `round-${event.roundId}`,
              seq: event.seq,
              roundId: event.roundId,
              speakers: event.speakers ?? [],
              // Your agent answers your message at once; an outside one is asked first.
              passes: first && !first.outside ? [first.id] : [],
              at: event.at,
            },
          ],
        };
      }
      return {
        ...base,
        items: items.map((item) => {
          if (item.kind !== 'round' || item.roundId !== event.roundId) return item;
          if (event.state === 'asking') {
            const asked = event.speakers?.[0];
            if (!asked) return item;
            return {
              ...item,
              asking: asked.id,
              at: event.at,
              passes: [...item.passes, asked.id],
              speakers: item.speakers.some((s) => s.id === asked.id)
                ? item.speakers
                : [...item.speakers, asked],
            };
          }
          return {
            ...item,
            asking: undefined,
            at: event.at,
            ended: { reason: event.reason ?? 'done', turns: event.turns ?? item.passes.length },
          };
        }),
      };
    }
    case 'peer.message':
      return {
        ...base,
        items: [
          ...items.map((item) =>
            item.kind === 'round' && item.roundId === event.roundId
              ? { ...item, asking: undefined, at: event.at }
              : item,
          ),
          {
            kind: 'peer',
            id: `peer-${event.seq}`,
            seq: event.seq,
            outsideId: event.outsideId,
            name: event.name,
            text: event.text,
            ...(event.failed && { failed: true }),
          },
        ],
      };
    case 'context.cleared':
      return {
        ...base,
        // A fresh start: the old reading is gone; the next request says how full it is now.
        context: undefined,
        clears: [...(view.clears ?? []), event.seq],
        items: [...items, { kind: 'cleared', id: `cleared-${event.seq}`, seq: event.seq }],
      };
    case 'context.restored': {
      const clears = view.clears ?? [];
      if (clears.at(-1) !== event.clearedSeq) return base;
      return {
        ...base,
        clears: clears.slice(0, -1),
        items: items.filter((i) => !(i.kind === 'cleared' && i.seq === event.clearedSeq)),
      };
    }
    case 'goal':
      return {
        ...base,
        goal: event.goal ?? undefined,
        items: [
          ...items,
          {
            kind: 'goal-note',
            id: `goal-${event.seq}`,
            ...(event.goal && { goal: event.goal }),
          },
        ],
      };
    case 'turn.routed': {
      // The routed line says what happened: no waiting card, no failure card before it.
      const kept = items.filter(
        (i, n) =>
          !(i.kind === 'held' && !i.sent) &&
          !(n === items.length - 1 && i.kind === 'turn-end' && i.outcome === 'error' && i.problem),
      );
      return {
        ...base,
        items: [
          ...kept,
          {
            kind: 'routed',
            id: `routed-${event.seq}`,
            from: event.from,
            to: event.to,
            reason: event.reason,
            message: event.message,
            ...(event.stayed && { stayed: true }),
          },
        ],
      };
    }
    case 'limit.back': {
      // Switch back folds the line it was pressed on: the chat waits for its own provider now.
      const at = items.findLastIndex(
        (i) => i.kind === 'routed' && i.reason === 'limit' && i.from === event.engine,
      );
      const line = items[at];
      if (!line || line.kind !== 'routed') return base;
      return {
        ...base,
        items: items.with(at, {
          ...line,
          back: event.until !== undefined ? { until: event.until } : {},
        }),
      };
    }
    case 'turn.completed': {
      // Any assistant message still open is finished now.
      const closed = items.map((item) => {
        const i =
          event.outcome === 'success'
            ? item
            : stopBrowser(
                item,
                event.outcome === 'interrupted' ? 'Stopped.' : 'The browser step did not finish.',
              );
        return i.kind === 'assistant' && !i.done ? { ...i, done: true, endedAt: event.at } : i;
      });
      return {
        ...base,
        turnStartedAt: undefined,
        working: undefined,
        narration: undefined,
        context: event.context ?? view.context,
        items: [
          ...closed,
          {
            kind: 'turn-end',
            id: `end-${event.seq}`,
            outcome: event.outcome,
            error: event.error,
            ...(event.problem && { problem: event.problem }),
            ...(event.paused && { paused: event.paused }),
            ...(event.restarted && { restarted: event.restarted }),
            usage: event.usage,
            ...(event.cost && { cost: event.cost }),
            // How long the turn ran, for "Worked 12m" under its reply.
            ...(view.turnStartedAt !== undefined && { ranMs: event.at - view.turnStartedAt }),
            engine: event.engine,
            model: event.model,
          },
        ],
      };
    }
    case 'turn.capped':
      return {
        ...base,
        items: [
          // An older one still waiting was overtaken by this one.
          ...settleCapped(items, 'moved-on'),
          {
            kind: 'capped',
            id: `capped-${event.seq}`,
            limit: event.limit,
            spentUsd: event.spentUsd,
            limitUsd: event.limitUsd,
            raiseTo: event.raiseTo,
            ...(event.switchTo && { switchTo: event.switchTo }),
            ...(event.during && { during: true }),
          },
        ],
      };
    case 'turn.capped.settled':
      return { ...base, items: settleCapped(items, event.outcome) };
    case 'spend.notice':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'spend-note',
            id: `spend-${event.seq}`,
            note: event.kind,
            message: event.message,
          },
        ],
      };
    // What the assistant is doing, in words (ADR 0103): the newest note stands.
    case 'narration':
      return {
        ...base,
        narration: {
          text: event.text,
          ...(event.toolUseId && { toolUseId: event.toolUseId }),
          source: event.source,
          at: event.at,
        },
      };
    // A story's headline, often after its turn ended: kept for as long as the chat is.
    case 'story.titled':
      return {
        ...base,
        titles: {
          ...view.titles,
          [event.storyId]: {
            headline: event.headline,
            ...(event.outcome && { outcome: event.outcome }),
            source: event.source,
          },
        },
      };
    case 'title':
      return { ...base, title: event.title };
    case 'notice':
      return { ...base, notice: { code: event.code, message: event.message } };
    case 'options': {
      const was = view.options?.permissionMode;
      const now = event.options.permissionMode;
      return {
        ...base,
        options: event.options,
        // Into plan mode: what to go back to (`null`: your default). Out of it: forgotten.
        beforePlan: now !== 'plan' ? undefined : was === 'plan' ? view.beforePlan : (was ?? null),
      };
    }
    case 'integration.issue': {
      // One card per integration per turn is plenty.
      const turnStart = items.findLastIndex((i) => i.kind === 'user');
      const shown = items
        .slice(turnStart + 1)
        .some((i) => i.kind === 'integration-issue' && i.integrationId === event.integrationId);
      if (shown) return base;
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'integration-issue',
            id: `issue-${event.seq}`,
            integrationId: event.integrationId,
            name: event.name,
            catalogId: event.catalogId,
            state: event.state,
            message: event.message,
          },
        ],
      };
    }
    // The chat knows Conch (ADR 0060).
    case 'offer':
      return addOffer(base, items, { offer: event.offer });
    case 'offer.resolved': {
      const index = items.findLastIndex((i) => i.kind === 'offer' && i.id === event.offerId);
      const item = items[index];
      if (item?.kind !== 'offer' || item.resolution) return base;
      const resolved = { ...item, resolution: event.outcome };
      // Taken: the quiet line goes where the chat carries on from, and a new turn starts.
      if (event.outcome === 'accepted')
        return {
          ...base,
          turnStartedAt: event.at,
          items: [...items.slice(0, index), ...items.slice(index + 1), resolved],
        };
      const next = items.slice();
      next[index] = resolved;
      return { ...base, items: next };
    }
    // Older logs (ADR 0021) draw the same card.
    case 'integration.suggestion':
      return addOffer(base, items, {
        legacy: true,
        offer: {
          offerId: legacyOfferId(event.catalogId),
          kind: 'app',
          target: event.catalogId,
          name: event.name,
          description: event.description,
          ...(event.color && { color: event.color }),
          by: 'cue',
        },
      });
    case 'integration.suggestion.dismissed': {
      const updated = updateItem(items, 'offer', legacyOfferId(event.catalogId), (item) => ({
        ...item,
        resolution: item.resolution ?? 'dismissed',
      }));
      return updated ? { ...base, items: updated } : base;
    }
    case 'question':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'question',
            id: event.question.questionId,
            question: event.question,
            at: event.at,
          },
        ],
      };
    case 'question.answered': {
      const updated = updateItem(items, 'question', event.questionId, (item) => ({
        ...item,
        answer: event.answer,
      }));
      return updated ? { ...base, items: updated } : base;
    }
    // Folded into `replies` with every event (they go when anything newer comes).
    case 'replies':
      return base;
    case 'plan':
      return { ...base, items: foldPlan(items, event) };
    // Apps you make and add (ADR 0061): the newest word on a card wins, where it is.
    case 'conch-app.offer': {
      const updated = updateItem(items, 'conch-app-offer', event.offer.offerId, (item) => ({
        ...item,
        offer: event.offer,
      }));
      if (updated) return { ...base, items: updated };
      return {
        ...base,
        items: [
          ...items,
          { kind: 'conch-app-offer', id: event.offer.offerId, offer: event.offer, at: event.at },
        ],
      };
    }
    case 'conch-app.share':
      return {
        ...base,
        items: [
          ...items,
          { kind: 'conch-app-share', id: `share-${event.seq}`, share: event.share, at: event.at },
        ],
      };
    case 'skill.used':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'skill',
            id: `skill-${event.seq}`,
            skillId: event.skillId,
            name: event.name,
            title: event.title,
            by: event.by,
          },
        ],
      };
    case 'skill.hold.ended':
      return {
        ...base,
        items: [
          ...items,
          { kind: 'skill-ended', id: `skill-ended-${event.seq}`, title: event.title },
        ],
      };
    case 'browser.step': {
      const updated = updateItem(items, 'browser', event.step.stepId, (item) => ({
        ...item,
        step: event.step,
      }));
      if (updated) return { ...base, items: updated };
      return {
        ...base,
        items: [
          ...items,
          { kind: 'browser', id: event.step.stepId, step: event.step, at: event.at },
        ],
      };
    }
    case 'browser.handoff': {
      const updated = updateItem(items, 'handoff', event.handoff.handoffId, (item) => ({
        ...item,
        handoff: event.handoff,
      }));
      if (updated) return { ...base, items: updated };
      return {
        ...base,
        items: [...items, { kind: 'handoff', id: event.handoff.handoffId, handoff: event.handoff }],
      };
    }
    case 'artifact':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'artifact',
            id: `artifact-${event.seq}`,
            artifactId: event.artifactId,
            title: event.title,
            artifactKind: event.kind,
            version: event.version,
            action: event.action,
            ...(event.note && { note: event.note }),
            at: event.at,
          },
        ],
      };
    case 'task': {
      const note: TaskNote = {
        taskId: event.taskId,
        title: event.title,
        taskKind: event.kind,
        state: event.state,
        ...(event.summary && { summary: event.summary }),
        ...(event.by && { by: event.by }),
      };
      // Its batch's card when it has one, else its own: where it first appeared.
      const at = items.findIndex(
        (i) =>
          i.kind === 'task' &&
          ((event.group && i.group === event.group) ||
            i.tasks.some((t) => t.taskId === event.taskId)),
      );
      const card = items[at];
      if (!card || card.kind !== 'task')
        return {
          ...base,
          items: [
            ...items,
            {
              kind: 'task',
              id: `task-${event.group ?? event.taskId}`,
              ...(event.group && { group: event.group }),
              tasks: [note],
            },
          ],
        };
      const known = card.tasks.some((t) => t.taskId === event.taskId);
      const next = items.slice();
      next[at] = {
        ...card,
        tasks: known
          ? card.tasks.map((t) => (t.taskId === event.taskId ? note : t))
          : [...card.tasks, note],
      };
      return { ...base, items: next };
    }
    case 'wait': {
      // One row per wait, where it first appeared, kept current.
      const id = `wait-${event.wait.waitId}`;
      const at = items.findIndex((i) => i.kind === 'wait' && i.id === id);
      if (at < 0) return { ...base, items: [...items, { kind: 'wait', id, wait: event.wait }] };
      const next = items.slice();
      next[at] = { kind: 'wait', id, wait: event.wait };
      return { ...base, items: next };
    }
    case 'routine':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'routine',
            id: `routine-${event.seq}`,
            routineId: event.routineId,
            action: event.action,
            title: event.title,
          },
        ],
      };
    case 'standing.order':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'standing-order',
            id: `order-${event.seq}`,
            orderId: event.orderId,
            text: event.text,
          },
        ],
      };
  }
}

/**
 * A message that waited for a model that can use its apps went: with the
 * model offered (the chat switched to it first), or without.
 */
function settleNeeds(items: TranscriptItem[], options: TurnOptions | undefined): TranscriptItem[] {
  const index = items.findLastIndex((i) => i.kind === 'needs-apps' && !i.settled);
  if (index === -1) return items;
  const item = items[index] as Extract<TranscriptItem, { kind: 'needs-apps' }>;
  const switched =
    item.switchTo &&
    options?.engine === item.switchTo.engine &&
    options.model === item.switchTo.model;
  const next = items.slice();
  next[index] = { ...item, settled: switched ? 'switched' : 'answered' };
  return next;
}

/** The card at a spending limit that still waits, settled as the person chose. */
function settleCapped(
  items: TranscriptItem[],
  outcome: NonNullable<Extract<TranscriptItem, { kind: 'capped' }>['settled']>,
): TranscriptItem[] {
  const index = items.findLastIndex((i) => i.kind === 'capped' && !i.settled);
  if (index === -1) return items;
  const next = items.slice();
  next[index] = {
    ...(items[index] as Extract<TranscriptItem, { kind: 'capped' }>),
    settled: outcome,
  };
  return next;
}

/** The waiting card becomes "sent when you were back online". */
function sendHeld(items: TranscriptItem[]): TranscriptItem[] {
  const index = items.findLastIndex((i) => i.kind === 'held' && !i.sent);
  if (index === -1) return items;
  const next = items.slice();
  next[index] = { ...(items[index] as Extract<TranscriptItem, { kind: 'held' }>), sent: true };
  return next;
}

/** A message waiting for the internet, if the chat has one. */
export function heldMessage(view: ConversationView) {
  const last = view.items.findLast((i) => i.kind === 'held');
  return last?.kind === 'held' && !last.sent ? last : undefined;
}

/**
 * An approval answered here, drawn before the gateway's `permission.resolved`
 * (which says the same): the card folds to its line, and with nothing else
 * waiting on you the reply carries on.
 */
export function decided(
  view: ConversationView,
  permissionId: string,
  decision: 'allow' | 'allow-always' | 'deny',
): ConversationView {
  const items = updateItem(view.items, 'permission', permissionId, (item) =>
    item.decision ? item : { ...item, decision },
  );
  if (!items) return view;
  const next = { ...view, items };
  const stillWaiting = pendingPermission(next) || pendingQuestion(next);
  return view.status === 'awaiting-permission' && !stillWaiting
    ? { ...next, status: 'running' }
    : next;
}

/**
 * An answer the gateway didn't take (it wants you to confirm it's you first,
 * ADR 0108): the question waits again, as it was.
 */
export function undecided(view: ConversationView, permissionId: string): ConversationView {
  const items = updateItem(view.items, 'permission', permissionId, (item) => {
    const { decision: _, ...rest } = item;
    return rest;
  });
  if (!items) return view;
  return { ...view, items, status: 'awaiting-permission' };
}

function stopBrowser(item: TranscriptItem, label: string): TranscriptItem {
  if (item.kind === 'browser' && (item.step.status === 'running' || item.step.status === 'waiting'))
    return { ...item, step: { ...item.step, status: 'error', label } };
  if (item.kind === 'handoff' && item.handoff.state === 'waiting')
    return { ...item, handoff: { ...item.handoff, state: 'cancelled' } };
  return item;
}

/**
 * The chat as it will be once a Stop pressed at `at` lands, drawn straight
 * away: the reply ends where it is, a running tool says it stopped, a waiting
 * question or approval is put away, and the turn says "Stopped". Messages not
 * yet confirmed are part of it. The gateway's own events replace it as they
 * come, and say the same.
 */

export function stoppedView(
  view: ConversationView,
  at: number,
  pending: readonly {
    clientMessageId: string;
    text: string;
    at: number;
    attachments?: Attachment[];
  }[] = [],
): ConversationView {
  const items: TranscriptItem[] = [
    ...view.items.map((item): TranscriptItem => {
      if (item.kind === 'assistant' && !item.done) return { ...item, done: true, endedAt: at };
      if (item.kind === 'tool' && (item.status === 'running' || item.status === 'pending'))
        return { ...item, status: 'error', output: 'Stopped.', durationMs: at - item.startedAt };
      if (item.kind === 'permission' && !item.decision) return { ...item, decision: 'expired' };
      if (item.kind === 'question' && item.answer === undefined) return { ...item, answer: null };
      return stopBrowser(item, 'Stopped.');
    }),
    ...pending.map((p) => ({
      kind: 'user' as const,
      id: p.clientMessageId,
      text: p.text,
      at: p.at,
      ...(p.attachments?.length && { attachments: p.attachments }),
    })),
  ];
  const last = items.at(-1);
  const ended = last?.kind === 'turn-end' && !pending.length;
  return {
    ...view,
    status: 'idle',
    turnStartedAt: undefined,
    notice: undefined,
    narration: undefined,
    items: ended
      ? items
      : [...items, { kind: 'turn-end', id: 'end-stopping', outcome: 'interrupted' }],
  };
}

export function reduceAll(events: ConversationEvent[], view = emptyView): ConversationView {
  return events.reduce(reduce, view);
}

/** The text of the most recent user message (for "Try again"). */
export function lastUserText(view: ConversationView): string | undefined {
  return lastUserMessage(view)?.text;
}

/** The last message you sent, with what was attached to it (for Retry). */
export function lastUserMessage(
  view: ConversationView,
): { text: string; attachments: Attachment[] } | undefined {
  for (let i = view.items.length - 1; i >= 0; i--) {
    const item = view.items[i];
    if (item?.kind === 'user') return { text: item.text, attachments: item.attachments ?? [] };
  }
  return undefined;
}

/**
 * The `/clear` that Undo can still take back: the newest one in force, while
 * nothing has been sent since (the gateway's `undoableClear`, on the view).
 */
export function undoableClear(view: ConversationView): number | undefined {
  const at = view.clears?.at(-1);
  if (at === undefined) return undefined;
  const index = view.items.findIndex((i) => i.kind === 'cleared' && i.seq === at);
  if (index === -1) return undefined;
  return view.items.slice(index + 1).some((i) => i.kind === 'user') ? undefined : at;
}

/** A question waiting for your answer (ADR 0060), if the chat has one. */
export function pendingQuestion(view: ConversationView) {
  const last = view.items.findLast((i) => i.kind === 'question');
  return last?.kind === 'question' && last.answer === undefined ? last : undefined;
}

/** Is anything still waiting on the user? */
export function pendingPermission(view: ConversationView) {
  return view.items.find((i) => i.kind === 'permission' && !i.decision);
}
