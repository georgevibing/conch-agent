import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  type Channel,
  type ChannelCatalogEntry,
  type ChannelCheck,
  type ChannelHealth,
  type ChannelKind,
  type ChannelList,
  type ChannelSecrets,
  type ChannelState,
  type CheckChannelBody,
  type ConversationEvent,
  type RoutineRun,
  type ServerEvent,
  type UpdateChannelBody,
  DISCORD_TOKEN,
  SLACK_APP_TOKEN,
  SLACK_BOT_TOKEN,
  TELEGRAM_TOKEN,
} from '@conch/protocol';

import type { AttachmentStore } from '../attachments/store';
import { ConversationError, type ConversationManager } from '../conversations/manager';
import type { PermissionDecision } from '../engines/types';
import { newId } from '../lib/ids';
import type { SettingsStore } from '../settings/store';
import type { ChannelStore, StoredChannel } from './store';
import {
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelMessage,
  type ChannelPress,
  type ChannelUser,
  type SentRef,
} from './types';

/** A hello link works this long. */
export const PAIRING_MS = 10 * 60_000;
/** Someone who isn't let in hears back at most this often. */
const REPLY_TO_STRANGERS_MS = 30 * 60_000;
/** Requests kept at once; the oldest go first. */
const MAX_REQUESTS = 20;
/** "typing…" lasts about 5 s on Telegram and 10 s on Discord; renew it before then. */
const TYPING_EVERY_MS = 4_500;
/** Messages sent this close together are read as one (a photo album, a thought typed in pieces). */
export const GATHER_MS = 700;
/** Streaming drafts: at most one update a second, and a keep-alive before Telegram's 30 s preview ends. */
const DRAFT_EVERY_MS = 1_000;
const DRAFT_KEEPALIVE_MS = 20_000;
/** An outage this long earns a "reconnected on its own" note. */
const NOTEWORTHY_OUTAGE_MS = 60_000;

export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    tagline: 'The easiest. Make a bot, paste its key, say hello.',
    color: '#26A5E4',
    minutes: 2,
    available: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    tagline: 'Message your assistant privately, from any device.',
    color: '#5865F2',
    minutes: 4,
    available: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    tagline: 'A private DM with your assistant, in your workspace.',
    color: '#4A154B',
    minutes: 4,
    available: true,
  },
  { id: 'whatsapp', name: 'WhatsApp', tagline: 'Coming soon.', color: '#25D366', available: false },
  { id: 'signal', name: 'Signal', tagline: 'Coming soon.', color: '#3A76F0', available: false },
  { id: 'imessage', name: 'iMessage', tagline: 'Coming soon.', color: '#34DA50', available: false },
  {
    id: 'microsoftteams',
    name: 'Microsoft Teams',
    tagline: 'Coming soon.',
    color: '#6264A7',
    available: false,
  },
  { id: 'matrix', name: 'Matrix', tagline: 'Coming soon.', color: '#0DBD8B', available: false },
];

export const CHANNEL_NAMES: Record<ChannelKind, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
};

export class ChannelServiceError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'unavailable',
    message: string,
    readonly field?: 'token' | 'botToken' | 'appToken',
  ) {
    super(message);
  }
}

/** Slack's two keys, checked one at a time while the other is still being fetched. */
export interface SlackCheck {
  checkSlack(parts: { botToken?: string; appToken?: string }): Promise<ChannelCheck>;
}

interface LiveChannel {
  adapter: ChannelAdapter;
  connection: ChannelConnection;
  health: ChannelHealth;
  /** When it went from online to not, for the "reconnected on its own" note. */
  downSince?: number;
}

/** One turn Conch is relaying back to a chat. */
interface Relay {
  channelId: string;
  chatId: string;
  personId: string;
  /** Known once the message is in a conversation. */
  conversationId?: string;
  /** The message that started it (Slack marks it as seen). */
  source?: SentRef;
  /** Assistant text so far, per message. */
  texts: Map<string, string>;
  typing?: NodeJS.Timeout;
  /** Streaming the answer as a draft (Telegram): which draft, what it says, when it last went. */
  draft?: { id: number; text: string; sentAt: number; timer?: NodeJS.Timeout };
  /** Messages sent while it was busy: they go next, together. */
  queued: { text: string; attachments: string[] }[];
  /** Said "I'll get to that" already this turn. */
  toldQueued?: boolean;
  /** Sends go one after another, in order. */
  chain: Promise<unknown>;
}

/** A question asked in a chat with buttons, until it's answered. */
interface Ask {
  channelId: string;
  chatId: string;
  conversationId: string;
  permissionId: string;
  summary: string;
  refs: SentRef[];
}

const hash = (code: string) => createHash('sha256').update(code).digest();

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** Find the key in whatever was pasted (BotFather's whole message is fine). */
export function normalizeSecrets(secrets: ChannelSecrets): ChannelSecrets {
  const pick = (value: string, pattern: RegExp) => pattern.exec(value)?.[1] ?? value.trim();
  if (secrets.kind === 'telegram')
    return { kind: 'telegram', token: pick(secrets.token, TELEGRAM_TOKEN) };
  if (secrets.kind === 'discord')
    return { kind: 'discord', token: pick(secrets.token, DISCORD_TOKEN) };
  // Pasted into each other's boxes? Put them right.
  const both = `${secrets.botToken} ${secrets.appToken}`;
  const bot = SLACK_BOT_TOKEN.exec(both)?.[1];
  const app = SLACK_APP_TOKEN.exec(both)?.[1];
  return {
    kind: 'slack',
    botToken: bot ?? secrets.botToken.trim(),
    appToken: app ?? secrets.appToken.trim(),
  };
}

/**
 * Channels end to end (ADR 0018): the bots you connected, who may talk to
 * them, and relaying what they say to Conch conversations and back.
 *
 * Everything a person sends becomes an ordinary conversation with the default
 * provider, so every provider works here. Approvals come to the chat as
 * buttons. People who aren't let in get one polite answer and show up as a
 * request on the Channels page; letting anyone in is a person's decision in
 * Conch, never the bot's or the agent's.
 */
export class ChannelService {
  #live = new Map<string, LiveChannel>();
  #pairings = new Map<string, { hash: Buffer; expiresAt: number; link?: string }>();
  #relays = new Map<string, Relay>();
  /**
   * Each person's turn in progress, from the moment it's decided until it's
   * done: anything they send meanwhile joins its queue instead of racing it.
   */
  #inflight = new Map<string, Relay>();
  /** A relay waiting for its conversation to be created, by the message that creates it. */
  #pending = new Map<string, Relay>();
  /** Questions asked with buttons, by channel and permission (a routine's can go to several). */
  #asks = new Map<string, Ask>();
  /** Button keys → the question they answer (Telegram allows 64 bytes of button data). */
  #buttons = new Map<string, string>();
  #answered = new Map<string, number>();
  /** Messages being gathered before they go to a conversation, per person. */
  #epochs = new Map<string, number>();
  #gathering = new Map<string, { messages: ChannelMessage[]; timer: NodeJS.Timeout }>();
  #notified = new Map<string, string>();
  #started = false;

  constructor(
    private readonly deps: {
      store: ChannelStore;
      conversations: ConversationManager;
      attachments: AttachmentStore;
      settings: SettingsStore;
      adapter: (secrets: ChannelSecrets) => ChannelAdapter;
      /** Slack's keys, checked apart. */
      slack?: (parts: { botToken?: string; appToken?: string }) => SlackCheck;
      emit: (event: ServerEvent) => void;
      onHeal: (message: string) => void;
      /** A routine's name, for its results. */
      routineTitle?: (routineId: string) => Promise<string | undefined>;
      now?: () => number;
      log?: (message: string) => void;
    },
  ) {}

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  #log(message: string) {
    (this.deps.log ?? ((m: string) => console.error(`[channels] ${m}`)))(message);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async start() {
    if (this.#started) return;
    this.#started = true;
    for (const channel of await this.deps.store.all()) {
      const secrets = await this.deps.store.secrets(channel.id);
      if (!secrets) {
        this.#live.delete(channel.id);
        continue;
      }
      this.#connect(channel, secrets);
    }
  }

  stop() {
    this.#started = false;
    for (const live of this.#live.values()) live.connection.close();
    this.#live.clear();
    for (const relay of this.#relays.values()) clearInterval(relay.typing);
    this.#relays.clear();
  }

  // ── Queries ────────────────────────────────────────────────────────────

  async list(): Promise<ChannelList> {
    const channels = await this.deps.store.all();
    return { channels: channels.map((c) => this.#view(c)), catalog: CHANNEL_CATALOG };
  }

  async get(id: string): Promise<Channel> {
    return this.#view(await this.#require(id));
  }

  #view(stored: StoredChannel): Channel {
    const live = this.#live.get(stored.id);
    const pairing = this.#pairings.get(stored.id);
    const active = pairing && pairing.expiresAt > this.#now ? pairing : undefined;
    const health: ChannelHealth = !stored.enabled
      ? { state: 'off' }
      : (live?.health ?? {
          state: 'needs-token',
          message: 'Conch lost this bot’s key. Paste it again to reconnect.',
        });
    return {
      id: stored.id,
      kind: stored.kind,
      enabled: stored.enabled,
      createdAt: stored.createdAt,
      bot: stored.bot,
      people: stored.people,
      requests: stored.requests,
      blocked: stored.blocked.length,
      settings: stored.settings,
      health,
      ...(active && {
        pairing: { expiresAt: active.expiresAt, ...(active.link && { link: active.link }) },
      }),
      ...(stored.lastMessageAt && { lastMessageAt: stored.lastMessageAt }),
    };
  }

  async #require(id: string): Promise<StoredChannel> {
    const stored = await this.deps.store.get(id);
    if (!stored) throw new ChannelServiceError('not-found', 'That channel isn’t connected.');
    return stored;
  }

  async #emit(id: string) {
    try {
      const stored = await this.deps.store.get(id);
      if (stored) this.deps.emit({ type: 'channel.changed', channel: this.#view(stored) });
    } catch (error) {
      this.#log(`update: ${explain(error)}`);
    }
  }

  /** Fire and forget, but never let a failure stop Conch (an unhandled rejection would). */
  #quietly(work: Promise<unknown>, what: string) {
    void work.catch((error: unknown) => this.#log(`${what}: ${explain(error)}`));
  }

  /** What the security checkup needs: each channel that's on, and who besides you may use it. */
  async checkupCopy(): Promise<{ app: string; bot: string; others: string[] }[]> {
    return (await this.deps.store.all())
      .filter((c) => c.enabled && c.people.length > 0)
      .map((c) => ({
        app: CHANNEL_NAMES[c.kind],
        bot: c.bot.username ? `@${c.bot.username}` : c.bot.name,
        others: c.people.slice(1).map((p) => p.name),
      }));
  }

  // ── Connecting ─────────────────────────────────────────────────────────

  /** Is this key good, and whose bot is it? Nothing is saved. */
  async check(body: CheckChannelBody): Promise<ChannelCheck> {
    if (body.kind === 'slack') {
      const parts = {
        ...(body.botToken && { botToken: body.botToken }),
        ...(body.appToken && { appToken: body.appToken }),
      };
      if (!this.deps.slack) return { ok: false, message: 'Slack isn’t available here yet.' };
      const both = `${parts.botToken ?? ''} ${parts.appToken ?? ''}`;
      return this.deps
        .slack({
          botToken: SLACK_BOT_TOKEN.exec(both)?.[1] ?? parts.botToken,
          appToken: SLACK_APP_TOKEN.exec(both)?.[1] ?? parts.appToken,
        })
        .checkSlack(parts);
    }
    const secrets = normalizeSecrets(body);
    try {
      const bot = await this.deps.adapter(secrets).identify(AbortSignal.timeout(20_000));
      return { ok: true, bot, checked: ['token'] };
    } catch (error) {
      return { ok: false, field: 'token', message: explain(error) };
    }
  }

  /** Connect a bot: check the key, keep it, connect, tidy its profile, and open a hello link. */
  async create(input: ChannelSecrets): Promise<Channel> {
    const secrets = normalizeSecrets(input);
    const adapter = this.deps.adapter(secrets);
    let bot;
    try {
      bot = await adapter.identify(AbortSignal.timeout(20_000));
    } catch (error) {
      const field = error instanceof ChannelError ? error.detail?.field : undefined;
      throw new ChannelServiceError('invalid', explain(error), field);
    }
    // The same bot again (a new key, or connected twice): update it instead of adding another.
    const same = (await this.deps.store.all()).find(
      (c) => c.kind === secrets.kind && c.bot.id === bot.id,
    );
    let stored: StoredChannel;
    if (same) {
      await this.deps.store.setSecrets(same.id, secrets);
      stored =
        (await this.deps.store.update(same.id, (c) => ({ ...c, bot, enabled: true }))) ?? same;
    } else {
      stored = await this.deps.store.add(
        {
          id: newId('ch'),
          kind: secrets.kind,
          enabled: true,
          createdAt: this.#now,
          bot,
          people: [],
          requests: [],
          blocked: [],
          settings: { notifyRoutines: true },
          chats: {},
        },
        secrets,
      );
    }
    this.#connect(stored, secrets);
    this.#quietly(this.#prepare(adapter, stored.id), 'profile');
    if (!stored.people.length) this.#openPairing(stored);
    const view = this.#view(stored);
    this.deps.emit({ type: 'channel.changed', channel: view });
    return view;
  }

  async #prepare(adapter: ChannelAdapter, id: string) {
    const settings = await this.deps.settings.get();
    await adapter
      .prepare?.({
        assistant: settings.persona.name,
        ...(settings.profile.name && { owner: firstName(settings.profile.name) }),
      })
      .catch(() => undefined);
    // It may have a new picture now: show it.
    await this.#refreshBot(id);
  }

  async update(id: string, patch: UpdateChannelBody): Promise<Channel> {
    const stored = await this.deps.store.update(id, (c) => ({
      ...c,
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      ...(patch.settings && { settings: { ...c.settings, ...patch.settings } }),
    }));
    if (!stored) throw new ChannelServiceError('not-found', 'That channel isn’t connected.');
    if (patch.enabled !== undefined) {
      const secrets = await this.deps.store.secrets(id);
      if (patch.enabled && secrets) this.#connect(stored, secrets);
      else this.#disconnect(id);
    }
    await this.#emit(id);
    return this.#view(stored);
  }

  /** A new key for the same bot, after the old one was reset. */
  async replaceToken(id: string, input: ChannelSecrets): Promise<Channel> {
    const current = await this.#require(id);
    const secrets = normalizeSecrets(input);
    if (secrets.kind !== current.kind)
      throw new ChannelServiceError('invalid', `That’s a key for ${CHANNEL_NAMES[secrets.kind]}.`);
    let bot;
    try {
      bot = await this.deps.adapter(secrets).identify(AbortSignal.timeout(20_000));
    } catch (error) {
      const field = error instanceof ChannelError ? error.detail?.field : undefined;
      throw new ChannelServiceError('invalid', explain(error), field);
    }
    if (bot.id !== current.bot.id)
      throw new ChannelServiceError(
        'invalid',
        `That key belongs to another bot${bot.username ? ` (@${bot.username})` : ''}. To use it, connect it as a new channel.`,
        secrets.kind === 'slack' ? 'botToken' : 'token',
      );
    await this.deps.store.setSecrets(id, secrets);
    const stored =
      (await this.deps.store.update(id, (c) => ({ ...c, bot, enabled: true }))) ?? current;
    this.#connect(stored, secrets);
    this.deps.onHeal(`${CHANNEL_NAMES[stored.kind]} is connected again with the new key.`);
    await this.#emit(id);
    return this.#view(stored);
  }

  async remove(id: string): Promise<void> {
    await this.#require(id);
    this.#disconnect(id);
    this.#pairings.delete(id);
    for (const [key, relay] of this.#relays) {
      if (relay.channelId !== id) continue;
      clearInterval(relay.typing);
      this.#relays.delete(key);
    }
    await this.deps.store.remove(id);
    this.deps.emit({ type: 'channel.deleted', channelId: id });
  }

  /**
   * Reconnect now, trying every fix: refresh who the bot is, then connect
   * again. A channel you turned off stays off: turning it on is its own,
   * checked, request.
   */
  async repair(id: string): Promise<Channel> {
    const stored = await this.#require(id);
    if (!stored.enabled) return this.#view(stored);
    const secrets = await this.deps.store.secrets(id);
    if (!secrets) {
      this.#setHealth(id, 'needs-token', {
        message: 'Conch lost this bot’s key. Paste it again to reconnect.',
      });
      return this.#view(stored);
    }
    let current = stored;
    try {
      const bot = await this.deps.adapter(secrets).identify(AbortSignal.timeout(20_000));
      current = (await this.deps.store.update(id, (c) => ({ ...c, bot }))) ?? stored;
    } catch (error) {
      if (error instanceof ChannelError && error.code === 'auth') {
        this.#disconnect(id);
        this.#live.set(id, this.#deadLive(stored, secrets, explain(error)));
        await this.#emit(id);
        return this.#view(current);
      }
    }
    this.#connect(current, secrets);
    await this.#emit(id);
    return this.#view(current);
  }

  /** A live entry for a channel whose key was refused: nothing runs until a new key comes. */
  #deadLive(stored: StoredChannel, secrets: ChannelSecrets, message: string): LiveChannel {
    const adapter = this.deps.adapter(secrets);
    return {
      adapter,
      connection: {
        send: () => Promise.reject(new ChannelError('auth', message)),
        edit: () => Promise.reject(new ChannelError('auth', message)),
        typing: () => Promise.resolve(),
        download: () => Promise.reject(new ChannelError('auth', message)),
        directChat: (userId) => Promise.resolve(userId),
        close: () => undefined,
      },
      health: { state: 'needs-token', message, since: this.#now },
    };
  }

  #connect(stored: StoredChannel, secrets: ChannelSecrets) {
    this.#disconnect(stored.id);
    if (!stored.enabled) return;
    const id = stored.id;
    const adapter = this.deps.adapter(secrets);
    const live: LiveChannel = {
      adapter,
      health: { state: 'connecting', since: this.#now },
      connection: undefined as unknown as ChannelConnection,
    };
    this.#live.set(id, live);
    live.connection = adapter.connect({
      message: (message) =>
        void this.#onMessage(id, message).catch((error: unknown) =>
          this.#log(`message on ${stored.kind}: ${explain(error)}`),
        ),
      press: (press) =>
        void this.#onPress(id, press).catch((error: unknown) =>
          this.#log(`button on ${stored.kind}: ${explain(error)}`),
        ),
      state: (state, detail) => this.#setHealth(id, state, detail),
      stop: (chatId) => this.#quietly(this.#stopFromApp(id, chatId), 'stop'),
      healed: (message) => this.deps.onHeal(message),
      joined: () => this.#quietly(this.#refreshBot(id), 'refresh'),
    });
  }

  #disconnect(id: string) {
    const live = this.#live.get(id);
    live?.connection.close();
    this.#live.delete(id);
  }

  async #refreshBot(id: string) {
    const secrets = await this.deps.store.secrets(id);
    if (!secrets) return;
    const bot = await this.deps
      .adapter(secrets)
      .identify(AbortSignal.timeout(20_000))
      .catch(() => undefined);
    if (!bot) return;
    await this.deps.store.update(id, (c) => ({ ...c, bot }));
    await this.#emit(id);
  }

  #setHealth(id: string, state: ChannelState, detail?: { message?: string; retryAt?: number }) {
    const live = this.#live.get(id);
    if (!live) return;
    const was = live.health;
    const now = this.#now;
    if (state === 'online' && live.downSince !== undefined) {
      const minutes = Math.round((now - live.downSince) / 60_000);
      if (now - live.downSince >= NOTEWORTHY_OUTAGE_MS)
        void this.deps.store
          .get(id)
          .catch(() => undefined)
          .then((c) => {
            if (c)
              this.deps.onHeal(
                `${CHANNEL_NAMES[c.kind]} was out of reach for ${minutes <= 1 ? 'a minute' : `${minutes} minutes`}; Conch reconnected on its own.`,
              );
          });
      live.downSince = undefined;
    }
    if (was.state === 'online' && state !== 'online') live.downSince = now;
    live.health = {
      state,
      ...(detail?.message && { message: detail.message }),
      ...(detail?.retryAt && { retryAt: detail.retryAt }),
      since: was.state === state ? (was.since ?? now) : now,
    };
    if (was.state === state && was.message === detail?.message) return;
    void this.#emit(id);
  }

  // ── Saying hello ───────────────────────────────────────────────────────

  /** A new hello link (Telegram) or a new window to say hello in (Discord, Slack). */
  async pair(id: string): Promise<Channel> {
    const stored = await this.#require(id);
    this.#openPairing(stored);
    await this.#emit(id);
    return this.#view(stored);
  }

  #openPairing(stored: StoredChannel) {
    const code = randomBytes(12).toString('base64url');
    const link =
      stored.kind === 'telegram' && stored.bot.username
        ? `https://t.me/${stored.bot.username}?start=${code}`
        : stored.bot.chatUrl;
    this.#pairings.set(stored.id, {
      hash: hash(code),
      expiresAt: this.#now + PAIRING_MS,
      ...(link && { link }),
    });
  }

  /** Whether `code` is this channel's hello code; it works once. */
  #redeem(id: string, code: string): boolean {
    const pairing = this.#pairings.get(id);
    if (!pairing) return false;
    if (pairing.expiresAt <= this.#now) {
      this.#pairings.delete(id);
      return false;
    }
    const ok = timingSafeEqual(hash(code), pairing.hash);
    if (ok) this.#pairings.delete(id);
    return ok;
  }

  /** Let someone in (a request you allowed, or the owner saying hello). */
  async #admit(id: string, user: ChannelUser, chatId?: string) {
    let owner = false;
    const stored = await this.deps.store.update(id, (c) => {
      owner = c.people.length === 0;
      return {
        ...c,
        requests: c.requests.filter((r) => r.id !== user.id),
        blocked: c.blocked.filter((b) => b !== user.id),
        people: c.people.some((p) => p.id === user.id)
          ? c.people
          : [
              ...c.people,
              {
                id: user.id,
                name: user.name,
                ...(user.username && { username: user.username }),
                since: this.#now,
                lastSeenAt: this.#now,
              },
            ],
      };
    });
    if (!stored) return;
    if (owner) this.#pairings.delete(id);
    // They're in now, whatever happens to the welcome: say so on the page first.
    await this.#emit(id);
    const live = this.#live.get(id);
    if (!live) return;
    try {
      const settings = await this.deps.settings.get();
      const assistant = settings.persona.name;
      const chat = chatId ?? (await live.connection.directChat(user.id));
      const ownerName = stored.people[0]?.name;
      await live.connection.send(
        chat,
        owner
          ? `Hi ${firstName(user.name)}! 👋 I’m **${assistant}**, and I’m connected to Conch on your computer.\n\n` +
              'Ask me anything — I can work with your files, the web and your apps, just like in Conch. ' +
              'Before I do anything important, I’ll ask you here.\n\n' +
              '/new starts a fresh conversation · /stop stops me'
          : `Hi ${firstName(user.name)}! 👋 ${ownerName ? firstName(ownerName) : 'The owner'} let you in. I’m **${assistant}**: ask me anything.`,
      );
    } catch (error) {
      this.#log(`welcome: ${explain(error)}`);
    }
  }

  /** Answer a request from the page: let them in, turn them away for good, or just clear it. */
  async answer(
    id: string,
    personId: string,
    answer: 'allow' | 'block' | 'dismiss',
  ): Promise<Channel> {
    const stored = await this.#require(id);
    const request = stored.requests.find((r) => r.id === personId);
    if (answer === 'allow') {
      if (!request)
        throw new ChannelServiceError('not-found', 'That request isn’t there any more.');
      await this.#admit(id, request);
    } else {
      await this.deps.store.update(id, (c) => ({
        ...c,
        requests: c.requests.filter((r) => r.id !== personId),
        blocked:
          answer === 'block' && !c.blocked.includes(personId)
            ? [...c.blocked, personId]
            : c.blocked,
      }));
      await this.#emit(id);
    }
    return this.#view(await this.#require(id));
  }

  /** Stop someone from talking to your assistant here. */
  async removePerson(id: string, personId: string): Promise<Channel> {
    await this.#require(id);
    // What they sent and what's running for them stops with them.
    this.#dropGathered(id, personId);
    const relay = this.#inflight.get(`${id}:${personId}`);
    if (relay) {
      relay.queued.length = 0;
      if (relay.conversationId)
        await this.deps.conversations.interrupt(relay.conversationId).catch(() => undefined);
    }
    const stored = await this.deps.store.update(id, (c) => {
      const { [personId]: _, ...chats } = c.chats;
      return { ...c, people: c.people.filter((p) => p.id !== personId), chats };
    });
    await this.#emit(id);
    return this.#view(stored ?? (await this.#require(id)));
  }

  /** Send a hello to the owner, to see that it all works. */
  async test(id: string): Promise<void> {
    const stored = await this.#require(id);
    const live = this.#live.get(id);
    const owner = stored.people[0];
    if (!live || !owner)
      throw new ChannelServiceError('unavailable', 'Say hello to your bot first, then try again.');
    try {
      const chat = await live.connection.directChat(owner.id);
      await live.connection.send(
        chat,
        '👋 This is a test from Conch. If you can read this, it all works.',
      );
    } catch (error) {
      throw new ChannelServiceError('unavailable', explain(error));
    }
  }

  // ── Messages in ────────────────────────────────────────────────────────

  async #onMessage(id: string, message: ChannelMessage) {
    const stored = await this.deps.store.get(id);
    const live = this.#live.get(id);
    if (!stored?.enabled || !live) return;
    // Private chats only: in a group, anyone could speak for you. Rather than
    // seem broken, say so there (at most every half hour per group).
    if (!message.direct) {
      const key = `${id}:group:${message.chatId}`;
      if (!this.#mayAnswer(key)) return;
      const where = stored.bot.username ? ` Message @${stored.bot.username} directly.` : '';
      await live.connection
        .send(
          message.chatId,
          `I only talk in private chats, so nobody can speak for anyone else.${where}`,
        )
        .catch(() => undefined);
      return;
    }
    if (stored.blocked.includes(message.user.id)) return;
    const text = message.text.trim();

    const hello = /^\/start(?:@\w+)?\s+([\w-]{8,64})\s*$/.exec(text);
    if (hello?.[1] && this.#redeem(id, hello[1])) {
      await this.#admit(id, message.user, message.chatId);
      return;
    }

    const person = stored.people.find((p) => p.id === message.user.id);
    if (!person) {
      await this.#request(stored, live, message);
      return;
    }
    await this.deps.store.update(id, (c) => ({
      ...c,
      lastMessageAt: this.#now,
      people: c.people.map((p) =>
        p.id === person.id ? { ...p, name: message.user.name, lastSeenAt: this.#now } : p,
      ),
    }));
    void this.#emit(id);

    const command = /^\/(start|new|stop|help)(?:@\w+)?\s*$/i.exec(text)?.[1]?.toLowerCase();
    if (command) {
      await this.#command(stored, live, message, command);
      return;
    }
    this.#gather(id, message);
  }

  /** Wait a moment for more (the rest of an album, the next line), then send it all as one message. */
  #gather(id: string, message: ChannelMessage) {
    const key = `${id}:${message.user.id}`;
    const pending = this.#gathering.get(key);
    if (pending) clearTimeout(pending.timer);
    const messages = [...(pending?.messages ?? []), message];
    const timer = setTimeout(() => {
      this.#gathering.delete(key);
      void this.#flushGathered(id, messages).catch((error: unknown) =>
        this.#log(`message: ${explain(error)}`),
      );
    }, GATHER_MS);
    timer.unref?.();
    this.#gathering.set(key, { messages, timer });
  }

  async #flushGathered(id: string, messages: ChannelMessage[]) {
    const stored = await this.deps.store.get(id);
    const live = this.#live.get(id);
    const last = messages.at(-1);
    if (!stored?.enabled || !live || !last) return;
    // Let go while it waited? Then it doesn't go.
    if (!stored.people.some((p) => p.id === last.user.id)) return;
    await this.#toConversation(stored, live, {
      ...last,
      text: messages
        .map((m) => m.text.trim())
        .filter(Boolean)
        .join('\n\n'),
      files: messages.flatMap((m) => m.files),
    });
  }

  /** The person pressed Stop under the streaming answer. */
  async #stopFromApp(id: string, chatId: string) {
    for (const [conversationId, relay] of this.#relays) {
      if (relay.channelId !== id || relay.chatId !== chatId) continue;
      relay.queued.length = 0;
      await this.deps.conversations.interrupt(conversationId).catch(() => undefined);
    }
  }

  async #command(
    stored: StoredChannel,
    live: LiveChannel,
    message: ChannelMessage,
    command: string,
  ) {
    const say = (text: string) => live.connection.send(message.chatId, text);
    const conversationId = stored.chats[message.user.id];
    const assistant = (await this.deps.settings.get()).persona.name;
    if (command === 'new') {
      this.#fresh(stored.id, message.user.id);
      await this.deps.store.update(stored.id, (c) => {
        const { [message.user.id]: _, ...chats } = c.chats;
        return { ...c, chats };
      });
      await say('Fresh start. What’s next?');
    } else if (command === 'stop') {
      const relay = this.#inflight.get(`${stored.id}:${message.user.id}`);
      this.#dropGathered(stored.id, message.user.id);
      if (relay) {
        relay.queued.length = 0;
        const running = relay.conversationId ?? conversationId;
        if (running) await this.deps.conversations.interrupt(running).catch(() => undefined);
        await say('Stopped.');
      } else await say('I’m not doing anything right now.');
    } else if (command === 'help' || command === 'start') {
      await say(
        `I’m **${assistant}**, your assistant on Conch. Ask me anything, or send a photo or a file.\n\n` +
          '• /new — start a fresh conversation\n' +
          '• /stop — stop what I’m doing\n' +
          '• /your-skill — use one of your skills by name\n\n' +
          'Everything we say here is also in Conch on your computer.',
      );
    }
  }

  /**
   * Whether to answer someone (or a group) not let in: once every half hour at
   * most. Old entries are dropped, so a flood of strangers can't fill memory.
   */
  #mayAnswer(key: string): boolean {
    const now = this.#now;
    const last = this.#answered.get(key);
    if (last !== undefined && now - last < REPLY_TO_STRANGERS_MS) return false;
    if (this.#answered.size > 1000)
      for (const [k, at] of this.#answered)
        if (now - at >= REPLY_TO_STRANGERS_MS) this.#answered.delete(k);
    this.#answered.set(key, now);
    return true;
  }

  /** Bumped by /new, so a conversation still being created doesn't become the current one again. */
  #epoch(id: string, personId: string) {
    return this.#epochs.get(`${id}:${personId}`) ?? 0;
  }

  #fresh(id: string, personId: string) {
    this.#epochs.set(`${id}:${personId}`, this.#epoch(id, personId) + 1);
  }

  #dropGathered(id: string, userId: string) {
    const key = `${id}:${userId}`;
    clearTimeout(this.#gathering.get(key)?.timer);
    this.#gathering.delete(key);
  }

  async #request(stored: StoredChannel, live: LiveChannel, message: ChannelMessage) {
    const preview =
      message.text.trim().slice(0, 200) || (message.files.length ? '(sent a file)' : '');
    await this.deps.store.update(stored.id, (c) => {
      const existing = c.requests.find((r) => r.id === message.user.id);
      const request = {
        id: message.user.id,
        name: message.user.name,
        ...(message.user.username && { username: message.user.username }),
        preview: preview || existing?.preview || '',
        at: this.#now,
        count: (existing?.count ?? 0) + 1,
      };
      const others = c.requests.filter((r) => r.id !== message.user.id);
      return { ...c, requests: [...others, request].slice(-MAX_REQUESTS) };
    });
    await this.#emit(stored.id);
    const key = `${stored.id}:${message.user.id}`;
    if (!this.#mayAnswer(key)) return;
    const hello = firstName(message.user.name);
    await live.connection
      .send(
        message.chatId,
        stored.people.length === 0
          ? `Hi ${hello}! To finish connecting, go back to Conch on your computer and press **That’s me**.`
          : `Hi ${hello}! I’m a private assistant, so I only talk with people I know. I’ve passed on that you’d like to talk.`,
      )
      .catch(() => undefined);
  }

  /** A message from someone let in: into their conversation, and the answer back. */
  async #toConversation(stored: StoredChannel, live: LiveChannel, message: ChannelMessage) {
    const attachments: string[] = [];
    for (const file of message.files) {
      try {
        const got = await live.connection.download(file);
        const saved = await this.deps.attachments.save({
          name: got.name,
          bytes: got.bytes,
          ...(got.mimeType && { claimedType: got.mimeType }),
        });
        attachments.push(saved.id);
      } catch (error) {
        await live.connection
          .send(message.chatId, `I couldn’t take ${file.name}: ${explain(error)}`)
          .catch(() => undefined);
      }
    }
    const text = message.text.trim();
    if (!text && !attachments.length) return;

    // Decided now, after the downloads: a turn that started meanwhile takes this as its next message.
    if (this.#queueBehind(stored.id, message.user.id, message.chatId, text, attachments, live))
      return;
    await this.#send(stored, message.chatId, message.user.id, text, attachments, {
      chatId: message.chatId,
      messageId: message.messageId,
    });
  }

  /** If the person has a turn in progress, add this to what goes next. */
  #queueBehind(
    channelId: string,
    personId: string,
    chatId: string,
    text: string,
    attachments: string[],
    live: LiveChannel,
  ): boolean {
    const running = this.#inflight.get(`${channelId}:${personId}`);
    if (!running) return false;
    running.queued.push({ text, attachments });
    if (!running.toldQueued) {
      running.toldQueued = true;
      void live.connection
        .send(chatId, 'Got it — I’ll look at that as soon as I’ve finished this.')
        .catch(() => undefined);
    }
    return true;
  }

  /** The turn is over (or never started): the next message may start one. */
  #release(relay: Relay) {
    const key = `${relay.channelId}:${relay.personId}`;
    if (this.#inflight.get(key) === relay) this.#inflight.delete(key);
    if (relay.conversationId && this.#relays.get(relay.conversationId) === relay)
      this.#relays.delete(relay.conversationId);
    this.#stopTyping(relay);
  }

  async #send(
    stored: StoredChannel,
    chatId: string,
    personId: string,
    text: string,
    attachments: string[],
    source?: SentRef,
  ) {
    const live = this.#live.get(stored.id);
    if (!live) return;
    // Claimed before the first await, so nothing sent meanwhile can start a second turn.
    if (this.#queueBehind(stored.id, personId, chatId, text, attachments, live)) return;
    const relay: Relay = {
      channelId: stored.id,
      chatId,
      personId,
      ...(source && { source }),
      texts: new Map(),
      queued: [],
      chain: Promise.resolve(),
    };
    this.#inflight.set(`${stored.id}:${personId}`, relay);
    const epoch = this.#epoch(stored.id, personId);
    const current = await this.deps.store.get(stored.id);
    // Let go while this was on its way? Then it doesn't go.
    if (!current?.people.some((p) => p.id === personId)) {
      this.#release(relay);
      return;
    }
    let conversationId = current.chats[personId];
    for (let attempt = 0; attempt < 2; attempt++) {
      const clientMessageId = newId('u');
      if (conversationId) {
        relay.conversationId = conversationId;
        if (!this.#relays.has(conversationId)) this.#relays.set(conversationId, relay);
      } else this.#pending.set(clientMessageId, relay);
      try {
        // Someone you let in isn't you: what they write is read like a web page (ADR 0028).
        const person = current.people.find((p) => p.id === personId);
        const fromOwner = current.people[0]?.id === personId;
        const summary = await this.deps.conversations.send({
          ...(conversationId && { conversationId }),
          clientMessageId,
          text,
          ...(attachments.length && { attachments }),
          ...(!fromOwner && {
            untrusted: {
              kind: 'person' as const,
              label: `${person?.name ?? 'someone'} on ${CHANNEL_NAMES[stored.kind]}`,
            },
          }),
          ...(!conversationId && {
            origin: { kind: 'channel' as const, channelId: stored.id, channel: stored.kind },
          }),
        });
        this.#pending.delete(clientMessageId);
        relay.conversationId = summary.id;
        this.#relays.set(summary.id, relay);
        // Remember it as their current conversation, unless they asked for a fresh one meanwhile.
        if (summary.id !== conversationId && this.#epoch(stored.id, personId) === epoch) {
          await this.deps.store.update(stored.id, (c) => ({
            ...c,
            chats: { ...c.chats, [personId]: summary.id },
          }));
        }
        this.#startTyping(relay);
        if (source) void live.connection.seen?.(source, true).catch(() => undefined);
        return;
      } catch (error) {
        this.#pending.delete(clientMessageId);
        if (conversationId && this.#relays.get(conversationId) === relay)
          this.#relays.delete(conversationId);
        relay.conversationId = undefined;
        // The conversation was deleted in Conch: start a new one.
        if (error instanceof ConversationError && error.code === 'not-found' && attempt === 0) {
          conversationId = undefined;
          continue;
        }
        this.#release(relay);
        const assistant = (await this.deps.settings.get()).persona.name;
        const why =
          error instanceof ConversationError && error.code === 'engine-unavailable'
            ? `${assistant} can’t answer right now: ${error.message} Open Conch on your computer to fix it.`
            : error instanceof ConversationError && error.code === 'busy'
              ? 'I’m still finishing something in Conch. Try again in a moment.'
              : `Something went wrong: ${explain(error)}`;
        await live.connection.send(chatId, why).catch(() => undefined);
        return;
      }
    }
  }

  /**
   * Show that it's working: a streaming draft where the app has them (it reads
   * "Thinking…" until words arrive, with a Stop button), else typing… renewed
   * before it fades.
   */
  #startTyping(relay: Relay) {
    const live = this.#live.get(relay.channelId);
    if (!live || relay.typing) return;
    const typing = () => void live.connection.typing(relay.chatId).catch(() => undefined);
    if (live.connection.draft) {
      relay.draft ??= { id: 1 + Math.floor(Math.random() * 1e9), text: '', sentAt: 0 };
      relay.typing = setInterval(
        () => this.#quietly(this.#pushDraft(relay), 'draft'),
        DRAFT_KEEPALIVE_MS,
      );
      void this.#pushDraft(relay)
        .catch(() => false)
        .then((ok) => {
          if (ok || !relay.typing) return;
          // This Telegram won't stream: typing… instead.
          clearInterval(relay.typing);
          relay.draft = undefined;
          typing();
          relay.typing = setInterval(typing, TYPING_EVERY_MS);
          relay.typing.unref?.();
        });
    } else {
      typing();
      relay.typing = setInterval(typing, TYPING_EVERY_MS);
    }
    relay.typing.unref?.();
  }

  #stopTyping(relay: Relay) {
    clearInterval(relay.typing);
    relay.typing = undefined;
    if (relay.draft) clearTimeout(relay.draft.timer);
  }

  async #pushDraft(relay: Relay): Promise<boolean> {
    const live = this.#live.get(relay.channelId);
    const draft = relay.draft;
    if (!live?.connection.draft || !draft) return false;
    clearTimeout(draft.timer);
    draft.timer = undefined;
    draft.sentAt = Date.now();
    return live.connection.draft(relay.chatId, draft.id, draft.text.trim());
  }

  /** New words: update the draft, at most once a second. */
  #scheduleDraft(relay: Relay) {
    const draft = relay.draft;
    if (!draft || draft.timer) return;
    const wait = Math.max(0, draft.sentAt + DRAFT_EVERY_MS - Date.now());
    draft.timer = setTimeout(() => this.#quietly(this.#pushDraft(relay), 'draft'), wait);
    draft.timer.unref?.();
  }

  /** Queue a send after the ones before it, so answers arrive in order. */
  #say(relay: Relay, markdown: string, buttons?: Parameters<ChannelConnection['send']>[2]) {
    const live = this.#live.get(relay.channelId);
    if (!live) return Promise.resolve([] as SentRef[]);
    const next = relay.chain.then(() => live.connection.send(relay.chatId, markdown, buttons));
    relay.chain = next.catch((error: unknown) => this.#log(`send: ${explain(error)}`));
    return next;
  }

  // ── Answers out ────────────────────────────────────────────────────────

  /** Everything conversations say; the ones being relayed are passed on. */
  onEvent(event: ServerEvent) {
    if (event.type === 'conversation.created') {
      const relay = this.#pending.get(event.clientMessageId);
      if (relay) {
        this.#pending.delete(event.clientMessageId);
        this.#relays.set(event.conversation.id, relay);
      }
      return;
    }
    if (event.type === 'routine.run') {
      void this.#routineRun(event.run).catch((error: unknown) =>
        this.#log(`routine: ${explain(error)}`),
      );
      return;
    }
    if (event.type !== 'conversation.event') return;
    const e = event.event;
    if (e.type === 'permission.resolved') {
      this.#quietly(this.#resolved(e.permissionId, e.decision), 'answer');
      return;
    }
    const relay = this.#relays.get(e.conversationId);
    if (!relay) return;
    this.#relayEvent(relay, e);
  }

  #relayEvent(relay: Relay, e: ConversationEvent) {
    switch (e.type) {
      case 'status':
        if (e.status === 'running') this.#startTyping(relay);
        else this.#stopTyping(relay);
        break;
      case 'assistant.delta':
        if (e.kind === 'text') {
          const text = (relay.texts.get(e.messageId) ?? '') + e.delta;
          relay.texts.set(e.messageId, text);
          if (relay.draft) {
            relay.draft.text = text;
            this.#scheduleDraft(relay);
          }
        }
        break;
      case 'assistant.done': {
        const text = relay.texts.get(e.messageId)?.trim();
        relay.texts.delete(e.messageId);
        if (relay.draft) {
          // The finished message replaces the draft; the next one gets its own.
          clearTimeout(relay.draft.timer);
          relay.draft = { id: relay.draft.id + 1, text: '', sentAt: relay.draft.sentAt };
        }
        if (text) void this.#say(relay, text).catch(() => undefined);
        break;
      }
      case 'permission.requested':
        this.#quietly(this.#askOrDefer(relay, e), 'question');
        break;
      case 'browser.handoff':
        if (e.handoff.state === 'waiting')
          void this.#say(
            relay,
            `🖐️ I need you for a moment in the browser: ${e.handoff.reason}. Open Conch on your computer to take over.`,
          ).catch(() => undefined);
        break;
      case 'integration.issue':
        void this.#say(
          relay,
          `⚠️ ${e.name} needs you: ${e.message} Open Conch on your computer to fix it.`,
        ).catch(() => undefined);
        break;
      case 'turn.completed':
        this.#quietly(this.#finish(relay, e), 'finish');
        break;
      default:
        break;
    }
  }

  async #finish(relay: Relay, e: Extract<ConversationEvent, { type: 'turn.completed' }>) {
    this.#stopTyping(relay);
    // Anything said but not yet marked done (a turn cut short) still goes.
    for (const [id, text] of relay.texts) {
      relay.texts.delete(id);
      if (text.trim()) void this.#say(relay, text.trim()).catch(() => undefined);
    }
    if (e.outcome === 'error') {
      const assistant = (await this.deps.settings.get()).persona.name;
      void this.#say(
        relay,
        `⚠️ ${assistant} couldn’t finish: ${e.error ?? 'something went wrong'}${
          e.problem === 'signed-out' || e.problem === 'key-locked'
            ? ' Open Conch on your computer to sign in again.'
            : ''
        }`,
      ).catch(() => undefined);
    }
    const live = this.#live.get(relay.channelId);
    if (relay.source) void live?.connection.seen?.(relay.source, false).catch(() => undefined);
    await relay.chain;
    // Read before letting go, so a message arriving now still joins this queue.
    const stored = relay.queued.length ? await this.deps.store.get(relay.channelId) : undefined;
    this.#release(relay);
    // What was sent meanwhile goes now, as one message, if they're still let in.
    const queued = relay.queued;
    if (!queued.length || !stored?.people.some((p) => p.id === relay.personId)) return;
    await this.#send(
      stored,
      relay.chatId,
      relay.personId,
      queued
        .map((q) => q.text)
        .filter(Boolean)
        .join('\n\n'),
      queued.flatMap((q) => q.attachments),
    );
  }

  /** Put a question to the chat, with buttons. */
  /**
   * A question from the guard (the chat read something untrusted, ADR 0028)
   * in someone else's chat goes to you, the owner, in Conch itself (and as a
   * notification): the person who wrote it can't approve their own request.
   */
  async #askOrDefer(relay: Relay, e: Extract<ConversationEvent, { type: 'permission.requested' }>) {
    if (e.taint) {
      const stored = await this.deps.store.get(relay.channelId);
      const owner = stored?.people[0];
      if (owner && owner.id !== relay.personId) {
        await this.#say(
          relay,
          `🔐 Before I ${e.summary.charAt(0).toLowerCase()}${e.summary.slice(1)}, I’ve asked ${firstName(owner.name)} to OK it.`,
        );
        return;
      }
    }
    return this.#ask(
      relay.channelId,
      relay.chatId,
      e.conversationId,
      e.permissionId,
      e.summary,
      undefined,
      {
        always: !e.taint,
      },
    );
  }

  async #ask(
    channelId: string,
    chatId: string,
    conversationId: string,
    permissionId: string,
    summary: string,
    heading?: string,
    options: { always?: boolean } = {},
  ) {
    const live = this.#live.get(channelId);
    const askKey = `${channelId}:${permissionId}`;
    if (!live || this.#asks.has(askKey)) return;
    const key = randomBytes(6).toString('base64url');
    const ask: Ask = { channelId, chatId, conversationId, permissionId, summary, refs: [] };
    this.#asks.set(askKey, ask);
    this.#buttons.set(key, askKey);
    const assistant = (await this.deps.settings.get()).persona.name;
    const relay = this.#relays.get(conversationId);
    const text = `🔐 ${heading ?? `**${assistant} would like to:**`}\n${summary}`;
    const buttons = {
      buttons: [
        { label: 'Allow', data: `p:${key}:a`, style: 'primary' as const },
        ...(options.always !== false ? [{ label: 'Always in this chat', data: `p:${key}:A` }] : []),
        { label: 'Don’t allow', data: `p:${key}:d`, style: 'danger' as const },
      ],
    };
    try {
      ask.refs = relay
        ? await this.#say(relay, text, buttons)
        : await live.connection.send(chatId, text, buttons);
    } catch (error) {
      this.#log(`question: ${explain(error)}`);
    }
    // Answered somewhere while this was on its way? Then its buttons are done too.
    const decided = await this.#decisionOn(conversationId, permissionId);
    if (decided) await this.#resolved(permissionId, decided);
  }

  async #decisionOn(conversationId: string, permissionId: string) {
    const events = await this.deps.conversations.eventsAfter(conversationId).catch(() => []);
    for (const e of events)
      if (e.type === 'permission.resolved' && e.permissionId === permissionId) return e.decision;
    return undefined;
  }

  /** Every chat that was asked hears how it was answered, and its buttons stop working. */
  async #resolved(permissionId: string, decision: PermissionDecision | 'expired') {
    for (const [askKey, ask] of this.#asks) {
      if (ask.permissionId !== permissionId) continue;
      this.#asks.delete(askKey);
      for (const [key, target] of this.#buttons) if (target === askKey) this.#buttons.delete(key);
      await this.#showAnswer(ask, decision);
    }
  }

  async #showAnswer(ask: Ask, decision: PermissionDecision | 'expired') {
    const live = this.#live.get(ask.channelId);
    const ref = ask.refs.at(-1);
    if (!live || !ref) return;
    const said = {
      allow: '✅ Allowed',
      'allow-always': '✅ Allowed for the rest of this chat',
      deny: '🚫 Not allowed',
      expired: '⌛ No answer in time, so not allowed',
    }[decision];
    await live.connection.edit(ref, `${said}\n${ask.summary}`).catch(() => undefined);
  }

  async #onPress(id: string, press: ChannelPress) {
    const stored = await this.deps.store.get(id);
    if (!stored?.people.some((p) => p.id === press.user.id)) {
      await press.ack('Only people who were let in can answer.');
      return;
    }
    const match = /^p:([\w-]+):([aAd])$/.exec(press.data);
    const askKey = match?.[1] ? this.#buttons.get(match[1]) : undefined;
    const ask = askKey ? this.#asks.get(askKey) : undefined;
    if (!match || !ask || ask.channelId !== id || ask.chatId !== press.chatId) {
      await press.ack('That was already answered.');
      return;
    }
    const decision = ({ a: 'allow', A: 'allow-always', d: 'deny' } as const)[
      match[2] as 'a' | 'A' | 'd'
    ];
    await this.deps.conversations.respond(ask.conversationId, ask.permissionId, decision);
    await press.ack(decision === 'deny' ? 'Not allowed' : 'Allowed');
  }

  // ── Routines ───────────────────────────────────────────────────────────

  /** A routine finished or needs you: tell the owner of each channel that wants to know. */
  async #routineRun(run: RoutineRun) {
    const wanted = ['succeeded', 'failed', 'needs-you'];
    if (!wanted.includes(run.status)) return;
    const key = `${run.id}:${run.status}`;
    if (this.#notified.has(key)) return;
    this.#notified.set(key, run.status);
    if (this.#notified.size > 500) this.#notified.delete(this.#notified.keys().next().value ?? '');

    const channels = (await this.deps.store.all()).filter(
      (c) =>
        c.enabled &&
        c.settings.notifyRoutines &&
        c.people.length &&
        this.#live.get(c.id)?.health.state === 'online',
    );
    if (!channels.length) return;
    const title = (await this.deps.routineTitle?.(run.routineId)) ?? 'A routine';
    const pending =
      run.status === 'needs-you' && run.conversationId
        ? await this.#pendingQuestions(run.conversationId)
        : [];
    for (const channel of channels) {
      const live = this.#live.get(channel.id);
      const owner = channel.people[0];
      if (!live || !owner) continue;
      const chat = await live.connection.directChat(owner.id).catch(() => undefined);
      if (!chat) continue;
      if (run.status === 'needs-you' && run.conversationId) {
        for (const question of pending)
          await this.#ask(
            channel.id,
            chat,
            run.conversationId,
            question.permissionId,
            question.summary,
            `**${title}** needs your OK to:`,
          );
        continue;
      }
      const text =
        run.status === 'succeeded'
          ? `🗓️ **${title}** — ${run.outcome ?? 'done.'}`
          : `⚠️ **${title}** didn’t finish: ${run.error ?? run.outcome ?? 'something went wrong.'}`;
      await live.connection
        .send(chat, text)
        .catch((error: unknown) => this.#log(`routine: ${explain(error)}`));
    }
  }

  async #pendingQuestions(conversationId: string) {
    const events = await this.deps.conversations.eventsAfter(conversationId).catch(() => []);
    const resolved = new Set(
      events.flatMap((e) => (e.type === 'permission.resolved' ? [e.permissionId] : [])),
    );
    return events.flatMap((e) =>
      e.type === 'permission.requested' && !resolved.has(e.permissionId)
        ? [{ permissionId: e.permissionId, summary: e.summary }]
        : [],
    );
  }
}

/** Plain words for any failure, never a stack or a key. */
export function explain(error: unknown): string {
  if (error instanceof ChannelError || error instanceof ChannelServiceError) return error.message;
  if (error instanceof ConversationError) return error.message;
  if (error instanceof Error && error.name === 'TimeoutError')
    return 'It took too long to answer. Check your internet connection and try again.';
  return 'Something unexpected went wrong.';
}
