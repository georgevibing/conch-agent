/**
 * Agents taking turns in a chat (ADR 0112). A message that mentions agents
 * ("@Researcher find options, @Writer draft it") starts a round: the first
 * answers it, and when each reply ends the next one has the floor, as
 * `talk.ts` decides, until the round is done or reaches a bound. Your agents
 * answer as the chat itself (`ConversationManager.speak`: the same mode,
 * guard, holds and spending limits), and an outside agent is asked over A2A
 * with your words only, its answer kept as someone else's (`notePeer`).
 *
 * You're never locked out: writing in the chat ends the round once the reply
 * that's running finishes (your message then goes), Stop ends it at once,
 * and a restart forgets it (the chat simply stays with whoever spoke last).
 */
import type {
  Agent,
  ConversationEvent,
  OutsideAgent,
  RoundEnd,
  RoundSpeaker,
  ServerEvent,
} from '@conch/protocol';
import { mentionsIn, ROUND_LIMITS } from '@conch/protocol';

import type { ConversationManager } from '../conversations/manager';
import { newId } from '../lib/ids';
import { nextTurn, roomPrompt, turnPrompt, type RoundState } from './talk';

type SendInput = Parameters<ConversationManager['send']>[0];

/** What a round needs of the chats. */
export type RoundChats = Pick<
  ConversationManager,
  'send' | 'speak' | 'notePeer' | 'roundAsking' | 'endRound' | 'detail' | 'interrupt'
> & { events: { on(listener: (event: ServerEvent) => void): () => void } };

/** Outside agents (A2A), as a round reaches them. */
export interface RoundOutside {
  list(): Promise<OutsideAgent[]>;
  ask(
    id: string,
    input: { text: string; contextId?: string; signal: AbortSignal },
  ): Promise<{ text: string; contextId?: string }>;
}

export interface RoundDeps {
  chats: RoundChats;
  agents: { list(): Promise<{ agents: Agent[] }> };
  outside?: RoundOutside;
}

interface Round extends RoundState {
  id: string;
  conversationId: string;
  speakers: RoundSpeaker[];
  room: string;
  /** Your words that started it: all an outside agent is ever sent. */
  said: string;
  /** Who has the floor now, and from which event of the chat's log their turn began. */
  current?: { speaker: RoundSpeaker; fromSeq: number };
  /** Your message, sent while a reply ran: it goes once that reply ends, and ends the round. */
  waiting?: SendInput;
  /** An outside agent being asked: Stop ends the wait. */
  asking?: AbortController;
  /** What outside agents answered that none of your agents has been told yet. */
  heard: { name: string; text: string }[];
  ending?: boolean;
}

/** The text of the replies in these events, joined. */
function replyText(events: readonly ConversationEvent[]): string {
  return events
    .filter((e) => e.type === 'assistant.delta' && e.kind === 'text')
    .map((e) => (e.type === 'assistant.delta' ? e.delta : ''))
    .join('');
}

export class RoundService {
  readonly #rounds = new Map<string, Round>();
  /** Each outside agent's conversation with each chat, so it keeps its own thread (A2A `contextId`). */
  readonly #contexts = new Map<string, string>();
  readonly #off: () => void;

  constructor(private readonly deps: RoundDeps) {
    this.#off = deps.chats.events.on((event) => {
      if (event.type !== 'conversation.event' || event.event.type !== 'status') return;
      const status = event.event.status;
      if (status === 'running' || status === 'awaiting-permission') return;
      const round = this.#rounds.get(event.event.conversationId);
      if (round?.current && !round.current.speaker.outside) void this.#after(round);
    });
  }

  close(): void {
    this.#off();
    for (const round of this.#rounds.values()) round.asking?.abort();
    this.#rounds.clear();
  }

  /** The round going on in a chat, if any: for the page and the tests. */
  active(conversationId: string): { roundId: string; speaking?: string } | undefined {
    const round = this.#rounds.get(conversationId);
    return round && { roundId: round.id, speaking: round.current?.speaker.id };
  }

  /** Everyone who can be mentioned: your agents, then outside agents with names of their own. */
  async roster(): Promise<(RoundSpeaker & { role?: string })[]> {
    const { agents } = await this.deps.agents.list();
    const outside = (await this.deps.outside?.list().catch(() => [])) ?? [];
    const taken = new Set(agents.map((a) => a.name.toLowerCase()));
    return [
      ...agents.map((a) => ({ id: a.id, name: a.name, ...(a.role && { role: a.role }) })),
      ...outside
        .filter((o) => !taken.has(o.name.toLowerCase()))
        .map((o) => ({ id: o.id, name: o.name, outside: true })),
    ];
  }

  /**
   * A message from you, in place of `ConversationManager.send`: it starts a
   * round when it mentions agents, ends the one going on, and otherwise is
   * just sent.
   */
  async send(input: SendInput): Promise<void> {
    const id = input.conversationId;
    const going = id ? this.#rounds.get(id) : undefined;
    if (going) {
      const running = (await this.deps.chats.detail(going.conversationId)).conversation.status;
      // A reply is running: yours goes when it ends, and the round stops there.
      if (!input.steer && (running === 'running' || running === 'awaiting-permission')) {
        going.waiting = input;
        return;
      }
      await this.#end(going, 'you');
    }
    const roster = await this.roster();
    const named = mentionsIn(input.text, roster).slice(0, ROUND_LIMITS.speakers);
    if (!named.length || !input.text.trim()) {
      await this.deps.chats.send(input);
      return;
    }
    const speakers = named.map(({ id, name, outside }) => ({
      id,
      name,
      ...(outside && { outside }),
    }));
    const room = roomPrompt(named);
    const roundId = newId('rnd').slice(0, 40);
    const [first] = speakers as [RoundSpeaker, ...RoundSpeaker[]];
    const summary = await this.deps.chats.send({
      ...input,
      // A new chat starts with the first of your agents named.
      ...(!id && !first.outside && { agentId: first.id }),
      round: { roundId, speakers, room, ...(!first.outside && { first: first.id }) },
      ...(first.outside && { answer: false as const }),
    });
    const round: Round = {
      id: roundId,
      conversationId: summary.id,
      speakers,
      room,
      said: input.text,
      queue: speakers.slice(1).map((s) => s.id),
      spoken: [],
      spentUsd: 0,
      heard: [],
    };
    this.#rounds.set(summary.id, round);
    if (first.outside) {
      await this.#outsideTurn(round, first);
      return;
    }
    const detail = await this.deps.chats.detail(summary.id);
    const userSeq =
      detail.events.findLast((e) => e.type === 'user.message')?.seq ?? detail.events.length;
    round.current = { speaker: first, fromSeq: userSeq };
    round.spoken.push(first.id);
    // It finished before we were listening (a reply that failed at once).
    const status = detail.conversation.status;
    if (status !== 'running' && status !== 'awaiting-permission') await this.#after(round);
  }

  /** Stop the round in this chat now: the reply that's running and any outside agent being asked. */
  async stop(conversationId: string): Promise<boolean> {
    const round = this.#rounds.get(conversationId);
    if (!round) return false;
    round.asking?.abort();
    await this.#end(round, 'stopped');
    await this.deps.chats.interrupt(conversationId).catch(() => undefined);
    return true;
  }

  /** One of your agents finished its reply: who's next. */
  async #after(round: Round): Promise<void> {
    const current = round.current;
    if (!current || round.ending) return;
    round.current = undefined;
    const { events } = await this.deps.chats.detail(round.conversationId);
    const turn = events.filter((e) => e.seq > current.fromSeq);
    const completed = turn.findLast((e) => e.type === 'turn.completed');
    if (completed?.type === 'turn.completed' && completed.cost?.billing === 'metered')
      round.spentUsd += completed.cost.usd ?? 0;
    if (round.waiting) {
      const waiting = round.waiting;
      await this.#end(round, 'you');
      await this.send({ ...waiting, steer: false }).catch(() => undefined);
      return;
    }
    if (turn.some((e) => e.type === 'turn.capped')) return this.#end(round, 'spend');
    if (completed?.type !== 'turn.completed') return this.#end(round, 'failed');
    if (completed.outcome === 'interrupted') return this.#end(round, 'stopped');
    if (completed.outcome === 'error') return this.#end(round, 'failed');
    await this.#next(round, { speaker: current.speaker, text: replyText(turn) });
  }

  async #next(round: Round, reply: { speaker: RoundSpeaker; text: string }): Promise<void> {
    const roster = await this.roster();
    const next = nextTurn(round, reply, roster);
    if (next.kind === 'end') return this.#end(round, next.reason);
    if (next.speaker.outside) return this.#outsideTurn(round, next.speaker);
    const { events } = await this.deps.chats.detail(round.conversationId);
    round.current = { speaker: next.speaker, fromSeq: events.at(-1)?.seq ?? 0 };
    round.spoken.push(next.speaker.id);
    const started = await this.deps.chats.speak(round.conversationId, {
      agentId: next.speaker.id,
      prompt: turnPrompt(next.speaker.name, next.by, round.heard.splice(0)),
      round: { roundId: round.id, turn: round.spoken.length, ...(next.by && { by: next.by }) },
      room: round.room,
    });
    if (started === 'started') return;
    round.current = undefined;
    round.spoken.pop();
    // You wrote meanwhile: your message wins.
    if (started === 'busy') {
      const waiting = round.waiting;
      await this.#end(round, 'you');
      if (waiting) await this.send(waiting).catch(() => undefined);
      return;
    }
    await this.#end(round, started === 'capped' ? 'spend' : 'failed');
  }

  /** An outside agent has the floor: it's sent your words, and its answer is kept as theirs. */
  async #outsideTurn(round: Round, speaker: RoundSpeaker): Promise<void> {
    const outside = this.deps.outside;
    round.spoken.push(speaker.id);
    const key = `${round.conversationId} ${speaker.id}`;
    const abort = new AbortController();
    round.asking = abort;
    let text: string;
    let failed = false;
    try {
      await this.deps.chats.roundAsking(round.conversationId, round.id, speaker);
      if (!outside) throw new Error('Outside agents aren’t available here.');
      const answer = await outside.ask(speaker.id, {
        text: round.said,
        ...(this.#contexts.has(key) && { contextId: this.#contexts.get(key) }),
        signal: abort.signal,
      });
      if (answer.contextId) this.#contexts.set(key, answer.contextId);
      text = answer.text;
    } catch (error) {
      failed = true;
      text = (error as Error).message || `${speaker.name} didn’t answer.`;
    } finally {
      round.asking = undefined;
    }
    if (round.ending || abort.signal.aborted) return;
    await this.deps.chats.notePeer(round.conversationId, {
      roundId: round.id,
      outsideId: speaker.id,
      name: speaker.name,
      text,
      ...(failed && { failed: true }),
    });
    if (failed) return this.#end(round, 'failed');
    round.heard.push({ name: speaker.name, text });
    if (round.waiting) {
      const waiting = round.waiting;
      await this.#end(round, 'you');
      await this.send(waiting).catch(() => undefined);
      return;
    }
    await this.#next(round, { speaker, text });
  }

  async #end(round: Round, reason: RoundEnd): Promise<void> {
    if (round.ending) return;
    round.ending = true;
    round.asking?.abort();
    if (this.#rounds.get(round.conversationId) === round) this.#rounds.delete(round.conversationId);
    await this.deps.chats
      .endRound(round.conversationId, round.id, round.spoken.length, reason)
      .catch(() => undefined);
  }
}
