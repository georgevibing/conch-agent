/**
 * Which replies to send next a turn ends with (ADR 0060 §5), if any. The
 * conversation manager asks once, as a turn finishes; everything it needs to
 * know is here, so the manager only hands over the turn.
 */
import { modelOf, type ConversationEvent, type ReplySuggestion } from '@conch/protocol';

import type { Engine, HostTool } from '../engines/types';
import { conchReplies } from './conch';
import { suggestRepliesTool } from './tools';

/** How long the end of a turn waits to learn whether its model can use tools. */
const CAPABILITIES_WAIT_MS = 1500;

/** What the turn ends with: one `replies` event's worth. */
export interface PickedReplies {
  replies: ReplySuggestion[];
  by: 'assistant' | 'conch';
}

/**
 * Something in this turn is still waiting for the person: a question, an
 * approval, an offer or a card they must act on. Then that's the one thing
 * asking for attention, and chips would be a second.
 */
export function waitingOnYou(turn: readonly ConversationEvent[]): boolean {
  const open = new Set<string>();
  for (const event of turn) {
    switch (event.type) {
      case 'offer':
        open.add(`offer:${event.offer.offerId}`);
        break;
      case 'offer.resolved':
        open.delete(`offer:${event.offerId}`);
        break;
      case 'integration.suggestion':
        open.add(`suggestion:${event.catalogId}`);
        break;
      case 'integration.suggestion.dismissed':
        open.delete(`suggestion:${event.catalogId}`);
        break;
      case 'question':
        open.add(`question:${event.question.questionId}`);
        break;
      case 'question.answered':
        open.delete(`question:${event.questionId}`);
        break;
      case 'permission.requested':
        open.add(`permission:${event.permissionId}`);
        break;
      case 'permission.resolved':
        open.delete(`permission:${event.permissionId}`);
        break;
      case 'vault.request':
        if (event.request.state === 'waiting') open.add(`vault:${event.request.requestId}`);
        else open.delete(`vault:${event.request.requestId}`);
        break;
      case 'browser.handoff':
        if (event.handoff.state === 'waiting') open.add(`handoff:${event.handoff.handoffId}`);
        else open.delete(`handoff:${event.handoff.handoffId}`);
        break;
      // A drafted routine waits to be turned on from its card.
      case 'routine':
        if (event.action === 'proposed') open.add(`routine:${event.routineId}`);
        break;
      // An app that stopped working has a card with its fix.
      case 'integration.issue':
        open.add(`issue:${event.integrationId}`);
        break;
      // A memory learned after reading something untrusted waits for an OK.
      case 'memory.saved':
        if (event.memory.pending) open.add(`memory:${event.memory.id}`);
        break;
      case 'turn.needs-apps':
      case 'turn.held':
        return true;
    }
  }
  return open.size > 0;
}

/** Everything the assistant wrote this turn, one message after another. */
export function replyText(turn: readonly ConversationEvent[]): string {
  const messages = new Map<string, string>();
  for (const event of turn)
    if (event.type === 'assistant.delta' && event.kind === 'text')
      messages.set(event.messageId, (messages.get(event.messageId) ?? '') + event.delta);
  return [...messages.values()].join('\n\n');
}

/**
 * The replies a finished turn ends with: the assistant's, when it offered
 * some and the chat hasn't read anything untrusted (the words would be
 * someone else's to choose); else Conch's own, when a rule fits the reply;
 * else none. Never for nobody (an unattended run), never after a turn that
 * didn't finish, and never while something else waits for the person.
 */
export function pickReplies(input: {
  outcome: 'success' | 'interrupted' | 'error';
  /** A routine, a background task, or a chat that came in from a chat app. */
  unattended: boolean;
  /** The last `suggest_replies` the assistant made this turn. */
  assistant?: readonly ReplySuggestion[];
  /** This turn's events so far. */
  turn: readonly ConversationEvent[];
  /** The chat has read something untrusted (ADR 0028). */
  tainted: boolean;
  /** The answering model can use Conch's tools. */
  tools: boolean;
}): PickedReplies | undefined {
  if (input.outcome !== 'success' || input.unattended || waitingOnYou(input.turn)) return undefined;
  if (input.assistant?.length && !input.tainted)
    return { replies: [...input.assistant], by: 'assistant' };
  const own = conchReplies(replyText(input.turn), { tools: input.tools });
  return own.length ? { replies: own, by: 'conch' } : undefined;
}

/**
 * One turn's replies to send next: the tool it offers the assistant, and what
 * it ends with. Unattended runs and models that can only chat get no tool
 * (nobody would see the chips, or it couldn't be called).
 */
export class TurnReplies {
  #assistant?: ReplySuggestion[];
  readonly tools: HostTool[];

  constructor(private readonly turn: { engine: Engine; unattended: boolean }) {
    this.tools =
      turn.unattended || turn.engine.hostTools === false
        ? []
        : [suggestRepliesTool((replies) => (this.#assistant = replies))];
  }

  /** What the turn ends with, if anything, given how it went. */
  async finish(input: {
    outcome: 'success' | 'interrupted' | 'error';
    turn: readonly ConversationEvent[];
    tainted: boolean;
    model?: string;
  }): Promise<PickedReplies | undefined> {
    if (input.outcome !== 'success' || this.turn.unattended) return undefined;
    return pickReplies({
      ...input,
      unattended: this.turn.unattended,
      ...(this.#assistant && { assistant: this.#assistant }),
      tools: await this.#tools(input.model),
    });
  }

  /** Whether the model that answered can use Conch's tools: its provider's and its own say. */
  async #tools(model: string | undefined): Promise<boolean> {
    const { engine } = this.turn;
    if (engine.hostTools === false) return false;
    // Almost always cached by now (the turn asked as it started); never held up for long.
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), CAPABILITIES_WAIT_MS);
      timer.unref?.();
    });
    const capabilities = await Promise.race([
      engine.capabilities().catch(() => undefined),
      late,
    ]).finally(() => clearTimeout(timer));
    // Unknown counts as able, as everywhere (`canUseApps`).
    if (!capabilities) return true;
    return capabilities.tools?.host !== false && modelOf(capabilities, model)?.tools !== false;
  }
}
