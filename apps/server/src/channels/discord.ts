import type { ChannelBot } from '@conch/protocol';

import { botAvatar } from './assets';
import { nativeMenu } from './commands';
import { fit, toDiscordMarkdown } from './format';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelProfile,
  type ChannelUser,
  type OutboundFile,
  type SendOptions,
  type SentRef,
  capOf,
  dataUrl,
  readCapped,
  pause,
  redact,
} from './types';

export const DISCORD_API = 'https://discord.com/api/v10';

/** Discord allows 2000 characters a message; parts this long stay under it once formatted. */
const PART = 1900;
/**
 * Direct messages, reactions in them, servers (to notice when the bot is
 * added to one), and messages in servers' channels (ADR 0075: answered only
 * where you turned it on, when it's mentioned). None is privileged: DMs, and
 * messages that mention the bot, carry their text without the Message
 * Content switch, so there is nothing to turn on in the Developer Portal.
 */
export const DISCORD_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 13);
/** Close codes after which reconnecting can't help (a bad key, a bad request). */
const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** Closes after which the session is gone: identify again rather than resume. */
const FRESH = new Set([4007, 4009]);
/** Discord resets a token after 1000 identifies a day; stay far below. */
const IDENTIFY_BUDGET = 100;
const FILE_LIMIT = 25 * 1024 * 1024;
/** What a bot may upload to a server without boosts: 10 MB a file, and a message's files together. */
const UPLOAD_LIMIT = 10 * 1024 * 1024;
/** Files on one message. */
const FILES_PER_MESSAGE = 10;
const FILE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

interface DiscordApp {
  id: string;
  name: string;
  approximate_guild_count?: number;
  interactions_endpoint_url?: string | null;
  description?: string;
}

interface Frame {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

const person = (user: DiscordUser): ChannelUser => ({
  id: user.id,
  name: user.global_name || user.username,
  username: user.username,
});

/** What Discord's error codes mean for a person, in their words. */
function plainError(code: number | undefined, message: string): ChannelError {
  if (code === 50007)
    return new ChannelError(
      'setup',
      'Discord won’t let the bot message you. In Discord, open your server’s menu → Privacy Settings, and turn on Direct Messages.',
    );
  if (code === 50278)
    return new ChannelError(
      'setup',
      'You and the bot don’t share a server yet, so Discord won’t let it message you. Add it to your server first.',
    );
  return new ChannelError('refused', message);
}

/**
 * Discord, through its Gateway (a WebSocket Conch opens, so no public address)
 * and REST API. Only direct messages are read.
 *
 * Healing: the connection is resumed where it left off after a drop, a
 * silent (zombie) connection is noticed by its missing heartbeat replies and
 * replaced, identifies are rationed so a crash loop can never get the key
 * reset, a refused key stops and asks for a new one, and an Interactions
 * Endpoint URL left in the app's settings (which would swallow button
 * presses) is cleared.
 */
export class DiscordAdapter implements ChannelAdapter {
  readonly kind = 'discord' as const;
  /** Mentions and replies in groups are told apart (ADR 0075). */
  readonly groups = true;
  #dms = new Map<string, string>();
  #identifies: number[] = [];
  /** The bot's own id (from READY), to know when a server channel mentions it. */
  #me?: string;
  /** Server channels' names, as "#general (Server)", for the groups on its page. */
  #places = new Map<string, string>();

  constructor(
    private readonly token: string,
    private readonly api = DISCORD_API,
    /** Overrides the gateway Discord names (tests). */
    private readonly gateway?: string,
  ) {}

  async rest<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    if (!/^[\w-]{20,40}\.[\w-]{4,10}\.[\w-]{20,80}$/.test(this.token))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a Discord bot token. On the Bot page, press Reset Token and copy the whole thing.',
        { field: 'token' },
      );
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${this.api}${path}`, {
        method,
        headers: {
          authorization: `Bot ${this.token}`,
          'user-agent': 'DiscordBot (https://github.com/conch, 1) Conch',
          ...(body !== undefined &&
            !(body instanceof FormData) && {
              'content-type': 'application/json',
            }),
        },
        ...(body !== undefined && {
          body: body instanceof FormData ? body : JSON.stringify(body),
        }),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach Discord (${(error as Error).message}).`, this.token),
      );
    }
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => undefined)) as
      (T & { code?: number; message?: string; retry_after?: number }) | undefined;
    if (response.ok) return data as T;
    if (response.status === 401)
      throw new ChannelError(
        'auth',
        'Discord doesn’t recognise this token. On the Bot page, press Reset Token and copy the new one.',
        { field: 'token' },
      );
    if (response.status === 429)
      throw new ChannelError('rate-limit', 'Discord asked Conch to slow down.', {
        retryAfterMs: Math.ceil((data?.retry_after ?? 2) * 1000),
      });
    if (response.status >= 500)
      throw new ChannelError('network', `Discord had a problem (${response.status}).`);
    throw plainError(data?.code, redact(data?.message ?? response.statusText, this.token));
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    const [me, app] = await Promise.all([
      this.rest<DiscordUser>('GET', '/users/@me', undefined, { signal }),
      this.rest<DiscordApp>('GET', '/applications/@me', undefined, { signal }),
    ]);
    const invite = new URL('https://discord.com/oauth2/authorize');
    invite.searchParams.set('client_id', app.id);
    invite.searchParams.set('scope', 'bot');
    // No permissions at all: it only needs to be in a server you share, to be messaged.
    invite.searchParams.set('permissions', '0');
    invite.searchParams.set('integration_type', '0');
    return {
      id: me.id,
      name: me.global_name || app.name || me.username,
      username: me.username,
      chatUrl: `https://discord.com/users/${me.id}`,
      inviteUrl: invite.toString(),
      ...(app.approximate_guild_count !== undefined && { servers: app.approximate_guild_count }),
      ...(await this.#avatar(me).catch(() => undefined)),
    };
  }

  async #avatar(me: DiscordUser): Promise<{ avatar: string } | undefined> {
    if (!me.avatar) return undefined;
    const response = await fetch(
      `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return undefined;
    const avatar = dataUrl(Buffer.from(await response.arrayBuffer()), 'image/png');
    return avatar ? { avatar } : undefined;
  }

  async prepare(profile: ChannelProfile): Promise<void> {
    const app = await this.rest<DiscordApp>('GET', '/applications/@me').catch(() => undefined);
    const who = profile.owner ? `${profile.owner}’s` : 'your';
    await this.rest('PATCH', '/applications/@me', {
      description: `${profile.assistant}, ${who} assistant on Conch. Private: only people who were let in can talk to it.`,
      // Presses must come over the Gateway; a leftover endpoint URL would take them away.
      ...(app?.interactions_endpoint_url && { interactions_endpoint_url: '' }),
    }).catch(() => undefined);
    // Conch's commands in Discord's own "/" menu (ADR 0098), from the list the web app uses too.
    if (app?.id)
      await this.rest(
        'PUT',
        `/applications/${encodeURIComponent(app.id)}/commands`,
        discordCommands(),
      ).catch(() => undefined);
    // A bot without a picture gets Conch's pearl; one you chose is left alone.
    const me = await this.rest<DiscordUser>('GET', '/users/@me').catch(() => undefined);
    if (me && !me.avatar) {
      const avatar = `data:image/jpeg;base64,${(await botAvatar()).toString('base64')}`;
      await this.rest('PATCH', '/users/@me', { avatar }).catch(() => undefined);
    }
  }

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    void this.#run(events, stop.signal);
    return {
      send: (chatId, markdown, options) => this.#send(chatId, markdown, options),
      // A voice note back (ADR 0077): Discord plays an Ogg file in the chat.
      voiceNotes: {
        format: 'ogg',
        send: async (chatId, note) => {
          const form = new FormData();
          form.set(
            'payload_json',
            JSON.stringify({
              attachments: [{ id: 0, filename: 'voice-note.ogg' }],
              allowed_mentions: { parse: [] },
            }),
          );
          form.set(
            'files[0]',
            new Blob([new Uint8Array(note.bytes)], { type: note.mimeType }),
            'voice-note.ogg',
          );
          await this.#retry(() =>
            this.rest('POST', `/channels/${chatId}/messages`, form, { timeoutMs: 60_000 }),
          );
        },
      },
      files: {
        maxBytes: UPLOAD_LIMIT,
        send: (chatId, files, caption) => this.#sendFiles(chatId, files, caption),
      },
      edit: async (ref, markdown, options) => {
        await this.#retry(() =>
          this.rest('PATCH', `/channels/${ref.chatId}/messages/${ref.messageId}`, {
            content: toDiscordMarkdown(
              fit(markdown, PART, (p) => toDiscordMarkdown(p).length)[0] ?? '…',
            ),
            components: options?.buttons ? components(options) : [],
          }),
        );
      },
      typing: async (chatId) => {
        await this.rest('POST', `/channels/${chatId}/typing`);
      },
      download: (file, options) => this.#download(file, options),
      directChat: (userId) => this.#directChat(userId),
      close: () => stop.abort(),
    };
  }

  async #directChat(userId: string): Promise<string> {
    const known = this.#dms.get(userId);
    if (known) return known;
    const channel = await this.rest<{ id: string }>('POST', '/users/@me/channels', {
      recipient_id: userId,
    });
    this.#dms.set(userId, channel.id);
    return channel.id;
  }

  async #send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const parts = fit(markdown, PART, (part) => toDiscordMarkdown(part).length);
    const sent: SentRef[] = [];
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      const message = await this.#retry(() =>
        this.rest<{ id: string }>('POST', `/channels/${chatId}/messages`, {
          content: toDiscordMarkdown(part),
          allowed_mentions: { parse: [] },
          ...(last && options?.buttons && { components: components(options) }),
        }),
      );
      sent.push({ chatId, messageId: message.id });
    }
    return sent;
  }

  /**
   * Files as attachments on a message (pictures show in the chat), up to ten
   * and 10 MB together on each; the caption is the first message's words, or
   * a message of its own before them when it's too long for one.
   */
  async #sendFiles(chatId: string, files: OutboundFile[], caption?: string): Promise<SentRef[]> {
    const sent: SentRef[] = [];
    let words = caption ? toDiscordMarkdown(caption) : undefined;
    if (words && words.length > PART && caption) {
      sent.push(...(await this.#send(chatId, caption)));
      words = undefined;
    }
    const batches: OutboundFile[][] = [];
    for (const file of files) {
      const batch = batches.at(-1);
      const size = batch?.reduce((sum, f) => sum + f.bytes.length, 0) ?? 0;
      if (batch && batch.length < FILES_PER_MESSAGE && size + file.bytes.length <= UPLOAD_LIMIT)
        batch.push(file);
      else batches.push([file]);
    }
    for (const batch of batches) {
      const form = new FormData();
      form.set(
        'payload_json',
        JSON.stringify({
          ...(words && { content: words }),
          attachments: batch.map((file, id) => ({ id, filename: file.name })),
          allowed_mentions: { parse: [] },
        }),
      );
      for (const [id, file] of batch.entries())
        form.set(
          `files[${id}]`,
          new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
          file.name,
        );
      words = undefined;
      try {
        const message = await this.#retry(() =>
          this.rest<{ id: string }>('POST', `/channels/${chatId}/messages`, form, {
            timeoutMs: 120_000,
          }),
        );
        sent.push({ chatId, messageId: message.id });
      } catch (error) {
        if (error instanceof ChannelError && /entity too large/i.test(error.message))
          throw new ChannelError('refused', 'That file is too big for Discord (10 MB at most).');
        throw error;
      }
    }
    return sent;
  }

  async #retry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof ChannelError)) throw error;
      if (error.code !== 'rate-limit' && error.code !== 'network') throw error;
      await new Promise((r) => setTimeout(r, Math.min(error.detail?.retryAfterMs ?? 1500, 30_000)));
      return fn();
    }
  }

  async #download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(FILE_LIMIT, options);
    let url: URL;
    try {
      url = new URL(file.ref);
    } catch {
      throw new ChannelError('refused', 'That file’s address isn’t one Conch recognises.');
    }
    // Only Discord's own file servers: a message can't make Conch fetch anything else.
    if (url.protocol !== 'https:' || !FILE_HOSTS.has(url.hostname))
      throw new ChannelError('refused', 'That file isn’t on Discord’s own servers.');
    if (file.size && file.size > cap)
      throw new ChannelError('refused', 'That file is too big to take from Discord.');
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(
      (error: unknown) => {
        throw new ChannelError(
          'network',
          `Couldn’t download that file (${(error as Error).message}).`,
        );
      },
    );
    if (!response.ok)
      throw new ChannelError('network', `Couldn’t download that file (${response.status}).`);
    return {
      name: file.name,
      bytes: await readCapped(response, cap, 'That file is too big to take from Discord.'),
      mimeType: file.mimeType,
    };
  }

  // ── The Gateway ────────────────────────────────────────────────────────

  async #run(events: ChannelEvents, signal: AbortSignal) {
    const backoff = new Backoff();
    const session: { id?: string; seq: number | null; resumeUrl?: string } = { seq: null };
    events.state('connecting');
    while (!signal.aborted) {
      let url = session.id ? session.resumeUrl : undefined;
      try {
        url ??=
          this.gateway ??
          (await this.rest<{ url: string }>('GET', '/gateway/bot', undefined, { signal })).url;
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ChannelError && error.code === 'auth') {
          events.state('needs-token', {
            message:
              'Discord stopped accepting the bot’s token. It was probably reset in the Developer Portal.',
          });
          return;
        }
        const wait =
          (error instanceof ChannelError ? error.detail?.retryAfterMs : undefined) ??
          backoff.next();
        events.state('reconnecting', {
          message: error instanceof ChannelError ? error.message : 'Couldn’t reach Discord.',
          retryAt: Date.now() + wait,
        });
        await pause(wait, signal);
        continue;
      }
      // Identifies are rationed: a loop that burned through them would get the token reset.
      if (!session.id) {
        const day = Date.now() - 24 * 60 * 60_000;
        this.#identifies = this.#identifies.filter((at) => at > day);
        if (this.#identifies.length >= IDENTIFY_BUDGET) {
          const wait = 30 * 60_000;
          events.state('reconnecting', {
            message:
              'Discord kept dropping the connection, so Conch is waiting a while before trying again.',
            retryAt: Date.now() + wait,
          });
          await pause(wait, signal);
          continue;
        }
      }
      const closed = await this.#session(url, session, events, signal, () => backoff.reset());
      if (signal.aborted) return;
      if (closed.code === 4004) {
        events.state('needs-token', {
          message:
            'Discord stopped accepting the bot’s token. It was probably reset in the Developer Portal.',
        });
        return;
      }
      if (FATAL.has(closed.code)) {
        events.state('error', {
          message: `Discord closed the connection (${closed.code}). Press Repair to try again.`,
        });
        return;
      }
      if (!closed.resumable) {
        session.id = undefined;
        session.seq = null;
        session.resumeUrl = undefined;
      }
      // After an invalid session Discord asks for a pause of one to five seconds.
      const wait = closed.invalid
        ? 1000 + Math.random() * 4000
        : closed.resumable && backoff.attempts === 0
          ? 500
          : backoff.next();
      events.state('reconnecting', {
        message: 'Reconnecting to Discord.',
        retryAt: Date.now() + wait,
      });
      await pause(wait, signal);
    }
  }

  /** A resume address is untrusted input; it will receive the bot's token. */
  #gatewayUrl(raw: string): string {
    const url = new URL(raw);
    const official =
      url.protocol === 'wss:' &&
      /^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/.test(url.hostname) &&
      !url.port &&
      url.pathname === '/';
    // Only a constructor-injected test endpoint may use another origin. The
    // mock gateway shares its API's origin; received frames cannot grant one.
    const api = new URL(this.api);
    const mock =
      this.api !== DISCORD_API &&
      ['127.0.0.1', '[::1]', 'localhost'].includes(api.hostname) &&
      url.origin === api.origin.replace(/^http/, 'ws') &&
      url.pathname === '/gateway';
    if ((!official && !mock) || url.username || url.password || url.search || url.hash) {
      throw new ChannelError('network', 'Discord gave Conch an unexpected connection address.');
    }
    url.searchParams.set('v', '10');
    url.searchParams.set('encoding', 'json');
    return url.toString();
  }

  /** One Gateway connection, until it closes. */
  #session(
    url: string,
    session: { id?: string; seq: number | null; resumeUrl?: string },
    events: ChannelEvents,
    signal: AbortSignal,
    onReady: () => void,
  ): Promise<{ code: number; resumable: boolean; invalid: boolean }> {
    return new Promise((resolve) => {
      /** Discord said the session is invalid (op 9). */
      let invalid = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.#gatewayUrl(url));
      } catch {
        resolve({ code: 1006, resumable: false, invalid: false });
        return;
      }
      let heartbeat: NodeJS.Timeout | undefined;
      let acked = true;
      let resumable = true;
      let settled = false;
      const known = new Set<string>();
      let ready = false;
      const send = (frame: Frame) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
      };
      const beat = () => send({ op: 1, d: session.seq });
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        clearTimeout(heartbeat);
        signal.removeEventListener('abort', abort);
        resolve({
          code,
          resumable: resumable && !FATAL.has(code) && !FRESH.has(code) && code !== 1000,
          invalid,
        });
      };
      const abort = () => {
        resumable = false;
        socket.close(1000);
        finish(1000);
      };
      signal.addEventListener('abort', abort, { once: true });

      socket.addEventListener('message', (event) => {
        if (settled) return;
        let frame: Frame;
        try {
          const parsed: unknown = JSON.parse(String(event.data));
          if (!parsed || typeof parsed !== 'object' || !('op' in parsed)) return;
          frame = parsed as Frame;
        } catch {
          return;
        }
        if (typeof frame.s === 'number') session.seq = frame.s;
        switch (frame.op) {
          case 10: {
            // One Hello per connection: duplicates must not orphan live timers.
            if (heartbeat) break;
            const interval =
              frame.d && typeof frame.d === 'object' && 'heartbeat_interval' in frame.d
                ? frame.d.heartbeat_interval
                : undefined;
            // Node turns negative, non-finite and overflowing delays into 1 ms.
            if (
              typeof interval !== 'number' ||
              !Number.isInteger(interval) ||
              interval < 1000 ||
              interval > 120_000
            ) {
              resumable = false;
              socket.close(4000);
              finish(4000);
              return;
            }
            // The first beat is jittered, as Discord asks; then steady.
            heartbeat = setTimeout(() => {
              acked = false;
              beat();
              heartbeat = setInterval(() => {
                if (!acked) {
                  // No reply to the last beat: the connection is dead but doesn't know it.
                  socket.close(4000);
                  finish(4000);
                  return;
                }
                acked = false;
                beat();
              }, interval);
            }, interval * Math.random());
            if (session.id) {
              send({ op: 6, d: { token: this.token, session_id: session.id, seq: session.seq } });
            } else {
              this.#identifies.push(Date.now());
              send({
                op: 2,
                d: {
                  token: this.token,
                  intents: DISCORD_INTENTS,
                  properties: { os: process.platform, browser: 'conch', device: 'conch' },
                },
              });
            }
            break;
          }
          case 11:
            acked = true;
            break;
          case 1:
            beat();
            break;
          case 7:
            socket.close(4000);
            finish(4000);
            break;
          case 9:
            invalid = true;
            resumable = frame.d === true;
            socket.close(4000);
            finish(4000);
            break;
          case 0:
            this.#dispatch(
              frame,
              session,
              events,
              known,
              () => {
                ready = true;
                onReady();
              },
              () => ready,
            );
            break;
          default:
            break;
        }
      });
      socket.addEventListener('close', (event) => finish(event.code));
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) finish(1006);
      });
    });
  }

  #dispatch(
    frame: Frame,
    session: { id?: string; seq: number | null; resumeUrl?: string },
    events: ChannelEvents,
    guilds: Set<string>,
    onReady: () => void,
    isReady: () => boolean,
  ) {
    const d = frame.d as Record<string, unknown>;
    switch (frame.t) {
      case 'READY':
        session.id = d.session_id as string;
        session.resumeUrl = d.resume_gateway_url as string | undefined;
        this.#me = (d.user as DiscordUser | undefined)?.id ?? this.#me;
        for (const guild of (d.guilds as { id: string }[] | undefined) ?? []) guilds.add(guild.id);
        onReady();
        events.state('online');
        break;
      case 'RESUMED':
        onReady();
        events.state('online');
        break;
      case 'GUILD_CREATE':
        // Each channel's name, so a group on the page reads "#general (Ada's server)".
        for (const channel of (d.channels as { id: string; name?: string }[] | undefined) ?? [])
          if (channel.name)
            this.#places.set(channel.id, `#${channel.name}${d.name ? ` (${String(d.name)})` : ''}`);
        // Servers arrive after READY; a new one means the bot was just added somewhere.
        if (!guilds.has(d.id as string)) {
          guilds.add(d.id as string);
          if (isReady()) events.joined?.();
        }
        break;
      case 'MESSAGE_CREATE': {
        const author = d.author as DiscordUser | undefined;
        if (!author || author.bot) return;
        const attachments =
          (d.attachments as {
            url: string;
            filename: string;
            content_type?: string;
            size?: number;
            /** Set on a voice message's recording. */
            duration_secs?: number;
          }[]) ?? [];
        // IS_VOICE_MESSAGE: recorded in Discord, not a file someone shared.
        const voice = ((d.flags as number | undefined) ?? 0) & (1 << 13);
        const direct = !d.guild_id;
        const text = (d.content as string | undefined) ?? '';
        const me = this.#me;
        // In a server: mentioned by name (not @everyone), or a reply to one of its messages.
        const replied = d.referenced_message as
          { author?: DiscordUser; content?: string } | null | undefined;
        const mentioned =
          !direct &&
          me !== undefined &&
          (((d.mentions as DiscordUser[] | undefined) ?? []).some((u) => u.id === me) ||
            replied?.author?.id === me);
        events.message({
          chatId: d.channel_id as string,
          messageId: d.id as string,
          user: person(author),
          text:
            mentioned && me
              ? text.replaceAll(`<@${me}>`, '').replaceAll(`<@!${me}>`, '').trim()
              : text,
          files: attachments.map((a) => ({
            name: a.filename,
            ref: a.url,
            ...((voice || a.duration_secs !== undefined) && { voice: true }),
            ...(a.content_type && { mimeType: a.content_type }),
            ...(a.size !== undefined && { size: a.size }),
          })),
          direct,
          ...(!direct && {
            mentioned,
            group: this.#places.get(d.channel_id as string) ?? 'A Discord channel',
          }),
          ...(!direct &&
            replied?.author &&
            replied.author.id !== me &&
            replied.content && {
              quote: { name: person(replied.author).name, text: replied.content },
            }),
        });
        break;
      }
      case 'INTERACTION_CREATE': {
        if (d.type === 2) {
          this.#slash(d, events);
          return;
        }
        if (d.type !== 3) return;
        const user = (d.user ?? (d.member as { user?: DiscordUser } | undefined)?.user) as
          DiscordUser | undefined;
        const message = d.message as { id: string } | undefined;
        const data = d.data as { custom_id?: string } | undefined;
        if (!user || !message || !data?.custom_id) return;
        // Discord wants an answer within 3 seconds: say "got it" now, and edit the message after.
        void this.rest('POST', `/interactions/${d.id as string}/${d.token as string}/callback`, {
          type: 6,
        }).catch(() => undefined);
        events.press({
          chatId: d.channel_id as string,
          user: person(user),
          data: data.custom_id,
          message: { chatId: d.channel_id as string, messageId: message.id },
          ack: () => Promise.resolve(),
        });
        break;
      }
      default:
        break;
    }
  }

  /**
   * One of Conch's commands chosen from Discord's "/" menu: it reaches Conch
   * as the words it stands for (`/model opus`), from the person who chose it.
   * Discord wants an answer within three seconds, so the command is shown
   * back at once, to them only.
   */
  #slash(d: Record<string, unknown>, events: ChannelEvents) {
    const user = (d.user ?? (d.member as { user?: DiscordUser } | undefined)?.user) as
      DiscordUser | undefined;
    const data = d.data as
      { name?: string; options?: { name: string; value?: unknown }[] } | undefined;
    const channel = d.channel_id as string | undefined;
    if (!user || user.bot || !channel || !data?.name || !/^[a-z0-9_-]{1,32}$/.test(data.name))
      return;
    const value = data.options?.find((o) => o.name === 'value')?.value;
    const typed = typeof value === 'string' ? value.trim().slice(0, 4000) : '';
    const text = `/${data.name}${typed ? ` ${typed}` : ''}`;
    void this.rest('POST', `/interactions/${d.id as string}/${d.token as string}/callback`, {
      type: 4,
      data: { content: text, flags: 64, allowed_mentions: { parse: [] } },
    }).catch(() => undefined);
    const direct = !d.guild_id;
    events.message({
      chatId: channel,
      messageId: d.id as string,
      user: person(user),
      text,
      files: [],
      direct,
      // A command chosen for the bot is addressed to it, as a mention is.
      ...(!direct && {
        mentioned: true,
        group: this.#places.get(channel) ?? 'A Discord channel',
      }),
    });
  }
}

/**
 * Conch's commands as Discord application commands: in private messages and
 * servers, each with a `value` to type where it takes one (a model's name, a
 * goal). Discord allows 100 characters of words.
 */
export function discordCommands() {
  return nativeMenu({ words: 100 }).map((c) => ({
    name: c.command,
    type: 1,
    description: c.description,
    // In servers (0) and in private messages with the bot (1).
    contexts: [0, 1],
    integration_types: [0],
    ...(c.takes && {
      options: [
        {
          type: 3,
          name: 'value',
          description: (c.argumentHint ?? 'What to choose').slice(0, 100),
          required: false,
        },
      ],
    }),
  }));
}

function components(options: SendOptions) {
  const buttons = options.buttons ?? [];
  const rows = buttons.some((b) => b.data.startsWith('s:')) ? buttons.map((b) => [b]) : [buttons];
  return rows.map((row) => ({
    type: 1,
    components: row.map((button) => ({
      type: 2,
      style: button.style === 'primary' ? 1 : button.style === 'danger' ? 4 : 2,
      label: button.label.slice(0, 80),
      custom_id: button.data.slice(0, 100),
    })),
  }));
}
