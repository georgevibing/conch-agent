import { foldHolds } from '@conch/protocol';
import type {
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
  ToolStatus,
  ToolView,
  TurnOptions,
  TurnPause,
  TurnProblem,
  PlanStep,
  Usage,
} from '@conch/protocol';

import { latestReplies, type LatestReplies } from '../features/replies/latest';
import { foldPlan } from '../features/plans/fold';

/** Everything the transcript renders, folded from the append-only event log. */
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
    }
  | {
      kind: 'permission';
      id: string;
      toolName: string;
      summary: string;
      input: unknown;
      decision?: 'allow' | 'allow-always' | 'deny' | 'expired';
      /** The browser asking about a site or a significant action. */
      browser?: BrowserPermission;
      /** Reading something from Passwords (ADR 0025). */
      vault?: VaultPermission;
      /** Asked because the chat read something untrusted (ADR 0028): why. No "always". */
      taint?: string;
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
      /** Waits for an OK: learned in a chat that read something untrusted (ADR 0032). */
      pending?: boolean;
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
      /** A task sent from this chat, or a helper working on part of it: one card, kept current. */
      kind: 'task';
      id: string;
      taskId: string;
      title: string;
      taskKind: TaskKind;
      state: TaskStatus;
      summary?: string;
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
      /** Another provider answered for this chat's own: offline, or at a usage limit. */
      kind: 'routed';
      id: string;
      from: EngineId;
      to: EngineId;
      reason: 'offline' | 'limit';
      message: string;
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
      /** It stopped to check in, not because it was done (ADR 0072): Carry on picks it up. */
      paused?: TurnPause;
      usage?: Usage;
      /** Which provider answered, and with which model. */
      engine?: EngineId;
      model?: string;
    };

export interface ConversationView {
  lastSeq: number;
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
    case 'user.message': {
      const withoutPending = items.filter((i) => !(i.kind === 'user' && i.id === event.messageId));
      return {
        ...base,
        turnStartedAt: event.at,
        items: [
          ...withoutPending,
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
      }));
      return updated ? { ...base, items: updated } : base;
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
            summary: event.summary,
            input: event.input,
            browser: event.browser,
            ...(event.vault && { vault: event.vault }),
            ...(event.taint && { taint: event.taint }),
          },
        ],
      };
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
        items: [...items, { kind: 'taint', id: `taint-${event.seq}`, source: event.source }],
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
      const updated = updateItem(items, 'permission', event.permissionId, (item) => ({
        ...item,
        decision: event.decision,
      }));
      return updated ? { ...base, items: updated } : base;
    }
    case 'memory.saved':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'memory',
            id: `mem-${event.seq}`,
            memoryId: event.memory.id,
            content: event.memory.content,
            action: 'saved',
            ...(event.memory.pending && { pending: true }),
          },
        ],
      };
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
        items: at === -1 ? [...kept, line] : [...kept.slice(0, at), line, ...kept.slice(at)],
      };
    }
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
          },
        ],
      };
    }
    case 'turn.completed': {
      // Any assistant message still open is finished now.
      const closed = items.map((i) =>
        i.kind === 'assistant' && !i.done ? { ...i, done: true, endedAt: event.at } : i,
      );
      return {
        ...base,
        turnStartedAt: undefined,
        items: [
          ...closed,
          {
            kind: 'turn-end',
            id: `end-${event.seq}`,
            outcome: event.outcome,
            error: event.error,
            ...(event.problem && { problem: event.problem }),
            ...(event.paused && { paused: event.paused }),
            usage: event.usage,
            engine: event.engine,
            model: event.model,
          },
        ],
      };
    }
    case 'title':
      return { ...base, title: event.title };
    case 'notice':
      return { ...base, notice: { code: event.code, message: event.message } };
    case 'options':
      return { ...base, options: event.options };
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
      const card = {
        kind: 'task' as const,
        id: `task-${event.taskId}`,
        taskId: event.taskId,
        title: event.title,
        taskKind: event.kind,
        state: event.state,
        ...(event.summary && { summary: event.summary }),
      };
      const at = items.findIndex((i) => i.kind === 'task' && i.taskId === event.taskId);
      if (at === -1) return { ...base, items: [...items, card] };
      const next = items.slice();
      next[at] = card;
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
      return item;
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

/** A question waiting for your answer (ADR 0060), if the chat has one. */
export function pendingQuestion(view: ConversationView) {
  const last = view.items.findLast((i) => i.kind === 'question');
  return last?.kind === 'question' && last.answer === undefined ? last : undefined;
}

/** Is anything still waiting on the user? */
export function pendingPermission(view: ConversationView) {
  return view.items.find((i) => i.kind === 'permission' && !i.decision);
}
