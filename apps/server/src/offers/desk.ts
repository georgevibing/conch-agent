import type {
  ConversationEvent,
  Offer,
  OfferKind,
  SkillMode,
  SkillPermissions,
  TaintSource,
} from '@conch/protocol';

import type { IntegrationSuggestionInput } from '../conversations/manager';
import type { Engine } from '../engines/types';
import { newId } from '../lib/ids';
import { mapSection, type OfferMap } from './map';

/**
 * Why an offer wasn't shown (ADR 0060 §2). Each is a rule the chat keeps:
 * nothing it can't turn on, nothing muted, nothing twice, never a pile of
 * cards, nothing a page asked for, and nothing for nobody.
 */
export type OfferDrop =
  'not-in-map' | 'muted' | 'offered' | 'one-per-turn' | 'untrusted' | 'unattended';

/** A problem taking an offer, in words a person can read. */
export class OfferError extends Error {
  constructor(
    readonly code: 'not-found' | 'gone' | 'not-ready',
    message: string,
  ) {
    super(message);
  }
}

/** What carrying on starts with: the request again, and the skill it runs with. */
export interface CarryOn {
  /** The prompt for the new turn; absent when there's nothing to resume. */
  prompt?: string;
  /** A skill whose instructions the prompt carries (logged as `skill.used`). */
  skill?: { skillId: string; name: string; title: string; permissions: SkillPermissions };
}

export interface OfferDeskDeps {
  /** What could be turned on for this provider now (the map); `undefined` when it can't say. */
  map?: (engine: Engine) => Promise<OfferMap | undefined>;
  /** `preferences.mutedSuggestions`: catalog ids, and `skill:<id>`. */
  muted: () => Promise<readonly string[]>;
  /** The catalog apps the person's words are about (ADR 0021's cues). */
  suggest?: (
    text: string,
    engine: Engine,
    skip: ReadonlySet<string>,
  ) => Promise<{ offers: IntegrationSuggestionInput[]; unseen: string[] }>;
  /** The chat, as the desk needs to see it and move it on. */
  chat?: {
    events(id: string): Promise<readonly ConversationEvent[]>;
    taint(id: string): Promise<readonly TaintSource[]>;
    /** Nobody is there: a routine, a background task, a chat from a chat app. */
    unattended(id: string): Promise<boolean>;
    carryOn(id: string, offerId: string, turn: CarryOn): Promise<'started' | 'queued' | 'done'>;
    dismiss(id: string, offerId: string): Promise<void>;
  };
  /** Whether what was offered is on, now. */
  apps?: { connected(catalogId: string): Promise<boolean> };
  skills?: {
    modeOf(id: string): Promise<SkillMode | undefined>;
    turnOn(id: string): Promise<void>;
    once(id: string, request: string): Promise<CarryOn | undefined>;
  };
}

/** How a muted offer is written in `mutedSuggestions`. */
export const mutedKey = (kind: OfferKind, target: string) =>
  kind === 'skill' ? `skill:${target}` : target;

/**
 * Where this turn began: the person's last message, or the offer they took
 * (carrying on starts a turn with no new message). `-1` before any.
 */
export function turnStart(events: readonly ConversationEvent[]): number {
  return events.findLastIndex(
    (e) => e.type === 'user.message' || (e.type === 'offer.resolved' && e.outcome === 'accepted'),
  );
}

/** Offered already in this chat, whether or not it was put away (old logs too). */
export function offeredBefore(
  events: readonly ConversationEvent[],
  kind: OfferKind,
  target: string,
): boolean {
  return events.some(
    (e) =>
      (e.type === 'offer' && e.offer.kind === kind && e.offer.target === target) ||
      (kind === 'app' && e.type === 'integration.suggestion' && e.catalogId === target),
  );
}

/** Something was offered this turn already (cue or assistant): never a pile of cards. */
export function offeredThisTurn(events: readonly ConversationEvent[]): boolean {
  return events
    .slice(turnStart(events) + 1)
    .some((e) => e.type === 'offer' || e.type === 'integration.suggestion');
}

/** Where an offer stands, from the log. */
export function offerState(
  events: readonly ConversationEvent[],
  offerId: string,
): 'missing' | 'open' | 'accepted' | 'dismissed' | 'expired' {
  const made = events.find((e) => e.type === 'offer' && e.offer.offerId === offerId);
  if (!made) return 'missing';
  const ended = events.find((e) => e.type === 'offer.resolved' && e.offerId === offerId);
  return ended?.type === 'offer.resolved' ? ended.outcome : 'open';
}

/** Offers nobody answered yet: a newer message makes them `expired`. */
export function openOffers(events: readonly ConversationEvent[]): string[] {
  const ended = new Set(events.flatMap((e) => (e.type === 'offer.resolved' ? [e.offerId] : [])));
  return events.flatMap((e) =>
    e.type === 'offer' && !ended.has(e.offer.offerId) ? [e.offer.offerId] : [],
  );
}

/**
 * The request an offer made now would carry on with: the person's words,
 * as typed. Carrying on has no new message, so an offer made then carries
 * the request that started it. Never the assistant's words.
 */
export function requestOf(events: readonly ConversationEvent[]): string | undefined {
  const start = events[turnStart(events)];
  let text: string | undefined;
  if (start?.type === 'user.message') text = start.text;
  else if (start?.type === 'offer.resolved') {
    const made = events.find((e) => e.type === 'offer' && e.offer.offerId === start.offerId);
    text = made?.type === 'offer' ? made.offer.resume?.request : undefined;
  }
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, 4000) : undefined;
}

/** The assistant's `why`: one plain sentence, on one line, within the card's limit. */
function oneLine(text: string | undefined, max = 200): string | undefined {
  const clean = text?.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const cap = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/**
 * Every offer in a chat goes through here (ADR 0060): the ones Conch notices
 * in the person's words (`cue`) and the ones the assistant asks for
 * (`propose`). It also takes them: `accept` checks what was offered is on
 * now and carries the chat on; `dismiss` puts one away.
 */
export class OfferDesk {
  constructor(private readonly deps: OfferDeskDeps) {}

  /**
   * The map's section of the system text (ADR 0060 §1), for a chat someone
   * is in. Muted apps and skills are left out, as are routines, tasks and
   * chats from a chat app, which get no `offer` to act on it.
   */
  async section(engine: Engine, conversationId?: string): Promise<string> {
    if (conversationId && (await this.deps.chat?.unattended(conversationId).catch(() => true)))
      return '';
    const map = await this.deps.map?.(engine).catch(() => undefined);
    if (!map) return '';
    const muted = new Set(await this.deps.muted().catch((): readonly string[] => []));
    // What the person just named is listed first, so the budget never cuts it.
    const said = conversationId
      ? ((await this.deps.chat?.events(conversationId).catch(() => undefined))?.findLast(
          (e) => e.type === 'user.message',
        )?.text ?? '')
      : '';
    return mapSection(
      {
        apps: map.apps.filter((a) => !muted.has(mutedKey('app', a.id))),
        skills: map.skills.filter((s) => !muted.has(mutedKey('skill', s.id))),
      },
      undefined,
      said,
    );
  }

  /**
   * Apps the person's words named, for the turn starting now: at most one,
   * never one muted or offered before, and none when nobody's there or when
   * the chat is carrying on (those words were read already). `unseen` names
   * every app it was about that isn't connected, offered or not, so the
   * assistant never pretends to see it.
   */
  async cue(input: {
    events: readonly ConversationEvent[];
    engine: Engine;
    unattended: boolean;
  }): Promise<{ offers: Offer[]; unseen: string[] }> {
    const none = { offers: [], unseen: [] };
    const { suggest } = this.deps;
    if (!suggest) return none;
    const typed = input.events.findLast((e) => e.type === 'user.message')?.text;
    if (!typed?.trim()) return none;
    const muted = await this.deps.muted().catch((): readonly string[] => []);
    const offered = input.events.flatMap((e) =>
      e.type === 'offer' && e.offer.kind === 'app'
        ? [e.offer.target]
        : e.type === 'integration.suggestion'
          ? [e.catalogId]
          : [],
    );
    const found = await suggest(typed, input.engine, new Set([...muted, ...offered])).catch(
      () => none,
    );
    const start = input.events[turnStart(input.events)];
    const carrying = start?.type !== 'user.message';
    if (input.unattended || carrying || offeredThisTurn(input.events))
      return { offers: [], unseen: found.unseen };
    const first = found.offers[0];
    if (!first) return { offers: [], unseen: found.unseen };
    const request = requestOf(input.events);
    return {
      offers: [
        {
          offerId: newId('of'),
          kind: 'app',
          target: first.catalogId,
          name: cap(first.name, 80),
          description: cap(first.description, 300),
          ...(first.color && HEX.test(first.color) && { color: first.color }),
          by: 'cue',
          ...(request && { resume: { request } }),
        },
      ],
      unseen: found.unseen,
    };
  }

  /**
   * The assistant's `offer`: shown only when it's in the map for this
   * provider, not muted, not offered in this chat before, the first this
   * turn, the chat hasn't read anything untrusted, and someone's there.
   */
  async propose(input: {
    conversationId: string;
    engine: Engine;
    unattended?: boolean;
    kind: OfferKind;
    target: string;
    why?: string;
  }): Promise<{ offer: Offer } | { dropped: OfferDrop; name?: string }> {
    const chat = this.deps.chat;
    if (input.unattended || !chat || (await chat.unattended(input.conversationId)))
      return { dropped: 'unattended' };
    // A page must never be able to ask for an app to be connected (ADR 0028).
    if ((await chat.taint(input.conversationId)).length) return { dropped: 'untrusted' };
    const map = await this.deps.map?.(input.engine).catch(() => undefined);
    const found =
      input.kind === 'app'
        ? map?.apps.find((a) => a.id === input.target)
        : map?.skills.find((s) => s.id === input.target || s.name === input.target);
    if (!found) return { dropped: 'not-in-map' };
    const name = 'title' in found ? found.title : found.name;
    const target = found.id;
    const muted = await this.deps.muted().catch((): readonly string[] => []);
    if (muted.includes(mutedKey(input.kind, target))) return { dropped: 'muted', name };
    const events = await chat.events(input.conversationId);
    if (offeredBefore(events, input.kind, target)) return { dropped: 'offered', name };
    if (offeredThisTurn(events)) return { dropped: 'one-per-turn', name };
    const why = oneLine(input.why);
    const request = requestOf(events);
    const offer: Offer = {
      offerId: newId('of'),
      kind: input.kind,
      target,
      name: cap(name, 80),
      description: cap(found.description, 300),
      ...(why && { why }),
      ...('color' in found && found.color && HEX.test(found.color) && { color: found.color }),
      by: 'assistant',
      ...('mode' in found && { skillMode: found.mode }),
      ...(request && { resume: { request } }),
    };
    return { offer };
  }

  /**
   * The person took an offer (ADR 0060 §3): what was offered must be on now
   * (a skill is turned on here, when that's how it was taken), then the chat
   * carries on with the request once, however many devices press it.
   */
  async accept(
    conversationId: string,
    offerId: string,
    how: { skill?: 'on' | 'once' } = {},
  ): Promise<'started' | 'queued' | 'done'> {
    const chat = this.#chat();
    const events = await chat.events(conversationId);
    const made = events.find((e) => e.type === 'offer' && e.offer.offerId === offerId);
    if (made?.type !== 'offer')
      throw new OfferError('not-found', 'That wasn’t offered in this conversation.');
    const state = offerState(events, offerId);
    if (state === 'accepted') return 'done';
    if (state !== 'open')
      throw new OfferError(
        'gone',
        state === 'expired'
          ? 'The chat has moved on since. Ask again, and it can use it now.'
          : 'That offer was put away.',
      );
    const { offer } = made;
    const turn =
      offer.kind === 'app' ? await this.#app(offer) : await this.#skill(offer, how.skill);
    return chat.carryOn(conversationId, offerId, turn);
  }

  /** **Not now**: put away for this chat. */
  async dismiss(conversationId: string, offerId: string): Promise<void> {
    const chat = this.#chat();
    const events = await chat.events(conversationId);
    if (offerState(events, offerId) === 'missing')
      throw new OfferError('not-found', 'That wasn’t offered in this conversation.');
    await chat.dismiss(conversationId, offerId);
  }

  #chat(): NonNullable<OfferDeskDeps['chat']> {
    if (!this.deps.chat) throw new OfferError('not-found', 'That wasn’t offered here.');
    return this.deps.chat;
  }

  async #app(offer: Offer): Promise<CarryOn> {
    const on = await this.deps.apps?.connected(offer.target).catch(() => false);
    if (!on)
      throw new OfferError(
        'not-ready',
        `${offer.name} isn’t connected yet. Finish connecting it, and the chat carries on.`,
      );
    const request = offer.resume?.request;
    return request
      ? {
          prompt: `${offer.name} is connected now, so you can use it. Carry on with what I asked:\n\n${request}`,
        }
      : {};
  }

  async #skill(offer: Offer, how: 'on' | 'once' | undefined): Promise<CarryOn> {
    const skills = this.deps.skills;
    if (!skills) throw new OfferError('not-ready', 'Skills aren’t available here.');
    if (how === 'on') {
      try {
        await skills.turnOn(offer.target);
      } catch (error) {
        throw new OfferError(
          'not-ready',
          error instanceof Error && error.message
            ? error.message
            : `${offer.name} couldn’t be turned on.`,
        );
      }
    }
    const mode = await skills.modeOf(offer.target).catch(() => undefined);
    if (!mode || mode === 'off')
      throw new OfferError('not-ready', `The “${offer.name}” skill is off. Turn it on first.`);
    const request = offer.resume?.request;
    if (!request) return {};
    const expanded = await skills.once(offer.target, request);
    if (!expanded?.prompt) throw new OfferError('not-ready', `“${offer.name}” couldn’t be read.`);
    return {
      prompt:
        how === 'on'
          ? `I turned on the “${offer.name}” skill, so you can use it now.\n\n${expanded.prompt}`
          : expanded.prompt,
      ...(expanded.skill && { skill: expanded.skill }),
    };
  }
}
