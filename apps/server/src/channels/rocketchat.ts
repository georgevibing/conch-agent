/**
 * Rocket.Chat (ADR 0083): a bot user on your own Rocket.Chat server, reached
 * over its realtime API (DDP on a WebSocket Conch opens), so no public address
 * is needed. Rocket.Chat writes Markdown, so answers keep theirs.
 *
 * - **Who it is**: a user with the `bot` role and a personal access token
 *   (its user id and token). `GET /api/v1/me` checks them.
 * - **The connection**: `/websocket`, `connect`, then `login` with the token
 *   as a resume token, then a subscription to `stream-room-messages`
 *   `__my_messages__`: every message in a room the bot is in. The token goes
 *   only in that message and in REST headers, never in an address.
 * - **Groups** (ADR 0075): a channel or group the bot is in is answered only
 *   once you turn it on, and only when the bot is @mentioned.
 * - **No buttons**: approvals are a numbered question (`TextChoices`).
 * - **Healing**: DDP pings are answered, a dead socket is replaced, drops are
 *   retried with backoff, and a refused token stops this channel only.
 */
import type { ChannelBot, ChannelSecrets } from '@conch/protocol';

import { fit } from './format';
import { TextChoices } from './linked';
import { serverUrl } from './mattermost';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelUser,
  type OutboundFile,
  type SendOptions,
  type SentRef,
  pause,
  redact,
} from './types';

type RocketSecrets = Extract<ChannelSecrets, { kind: 'rocketchat' }>;

/** Rocket.Chat's default message limit is 5000 characters. */
const PART = 4800;
const FILE_LIMIT = 25 * 1024 * 1024;
/** The most one file Conch sends may be (Rocket.Chat's own default allows 100 MB). */
const UPLOAD_LIMIT = 100 * 1024 * 1024;
/** Without a word from the server this long, the socket is replaced. */
const SILENT_MS = 70_000;

interface RcMessage {
  _id: string;
  rid: string;
  msg?: string;
  t?: string;
  u?: { _id: string; username?: string; name?: string };
  mentions?: { _id: string; username?: string }[];
  bot?: unknown;
  editedAt?: unknown;
  file?: { _id: string; name?: string; type?: string; size?: number };
  files?: { _id: string; name?: string; type?: string; size?: number }[];
}

/** Find the server, the user id and the token in whatever was pasted. */
export function normalizeRocketChat(secrets: RocketSecrets): RocketSecrets {
  return {
    kind: 'rocketchat',
    server: serverUrl(secrets.server) ?? secrets.server.trim(),
    userId: /\b([A-Za-z0-9]{17})\b/.exec(secrets.userId)?.[1] ?? secrets.userId.trim(),
    token: /\b([A-Za-z0-9_-]{43})\b/.exec(secrets.token)?.[1] ?? secrets.token.trim(),
  };
}

/** Rocket.Chat, through a bot user's personal access token and the server's realtime API. */
export class RocketChatAdapter implements ChannelAdapter {
  readonly kind = 'rocketchat' as const;
  /** Mentions in channels are told apart (ADR 0075). */
  readonly groups = true;
  #me?: { _id: string; username: string };
  #rooms = new Map<string, { type: string; name?: string }>();
  #dms = new Map<string, string>();

  constructor(private readonly secrets: RocketSecrets) {}

  get #server(): string {
    const server = serverUrl(this.secrets.server);
    if (!server)
      throw new ChannelError(
        'setup',
        'That isn’t a server address. It looks like https://chat.example.com.',
        { field: 'server' },
      );
    if (
      server.startsWith('http:') &&
      !/^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(server)
    )
      throw new ChannelError(
        'setup',
        'Use the server’s https:// address, so the bot’s token isn’t sent in the clear.',
        { field: 'server' },
      );
    return server;
  }

  async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const server = this.#server;
    if (!/^[A-Za-z0-9]{10,40}$/.test(this.secrets.userId))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a user id. It’s shown with the token when you make it.',
        { field: 'userId' },
      );
    if (!/^[\x21-\x7e]{20,200}$/.test(this.secrets.token))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a personal access token. It’s shown once, when you make it.',
        { field: 'token' },
      );
    // A file goes as it is (multipart, its own boundary), anything else as JSON.
    const form = body instanceof FormData ? body : undefined;
    let response: Response;
    try {
      response = await fetch(`${server}/api/v1${path}`, {
        method,
        headers: {
          'x-user-id': this.secrets.userId,
          'x-auth-token': this.secrets.token,
          ...(body !== undefined && !form && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: form ?? JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(form ? 120_000 : 15_000),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(
          `Couldn’t reach ${new URL(server).host} (${(error as Error).message}).`,
          this.secrets.token,
        ),
        { field: 'server' },
      );
    }
    const data = (await response.json().catch(() => ({}))) as T & {
      success?: boolean;
      error?: string;
      message?: string;
    };
    if (response.ok && data.success !== false) return data;
    const said = redact(data.error ?? data.message ?? '', this.secrets.token);
    if (response.status === 401)
      throw new ChannelError(
        'auth',
        'Rocket.Chat doesn’t accept that user id and token. Make a new personal access token for the bot.',
        { field: 'token' },
      );
    if (response.status === 429)
      throw new ChannelError('rate-limit', 'Rocket.Chat asked Conch to slow down.', {
        retryAfterMs: 2_000,
      });
    if (response.status >= 500)
      throw new ChannelError('network', `Rocket.Chat had a problem (${response.status}).`);
    if (response.status === 413 || /too-large|too large/i.test(said))
      throw new ChannelError(
        'refused',
        'That file is bigger than this Rocket.Chat server takes (Administration → File Upload → Maximum File Upload Size).',
      );
    if (response.status === 404 && path === '/me')
      throw new ChannelError(
        'setup',
        'There’s no Rocket.Chat at that address. Check it’s the one you open Rocket.Chat at.',
        { field: 'server' },
      );
    throw new ChannelError(
      'refused',
      `Rocket.Chat said no (${response.status}${said ? `: ${said}` : ''}).`,
    );
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    const me = await this.call<{ _id: string; username: string; name?: string; roles?: string[] }>(
      'GET',
      '/me',
      undefined,
      signal,
    );
    this.#me = { _id: me._id, username: me.username };
    const server = this.#server;
    return {
      id: me._id,
      name: me.name || me.username,
      username: me.username,
      workspace: new URL(server).host,
      chatUrl: `${server}/direct/${encodeURIComponent(me.username)}`,
    };
  }

  async #room(rid: string): Promise<{ type: string; name?: string }> {
    const known = this.#rooms.get(rid);
    if (known) return known;
    const info = await this.call<{ room?: { t?: string; fname?: string; name?: string } }>(
      'GET',
      `/rooms.info?roomId=${encodeURIComponent(rid)}`,
    ).catch(() => undefined);
    const room = { type: info?.room?.t ?? 'c', name: info?.room?.fname ?? info?.room?.name };
    if (info?.room) this.#rooms.set(rid, room);
    return room;
  }

  async #directChat(userId: string): Promise<string> {
    const known = this.#dms.get(userId);
    if (known) return known;
    const user = await this.call<{ user?: { username?: string } }>(
      'GET',
      `/users.info?userId=${encodeURIComponent(userId)}`,
    );
    if (!user.user?.username)
      throw new ChannelError('refused', 'Rocket.Chat doesn’t know that person.');
    const made = await this.call<{ room?: { _id?: string; rid?: string } }>('POST', '/im.create', {
      username: user.user.username,
    });
    const rid = made.room?.rid ?? made.room?._id;
    if (!rid) throw new ChannelError('refused', 'Rocket.Chat didn’t open a direct message.');
    this.#dms.set(userId, rid);
    return rid;
  }

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    const choices = new TextChoices();
    let socket: WebSocket | undefined;
    void this.#run(events, stop.signal, choices, (s) => (socket = s));

    const send = async (chatId: string, markdown: string, options?: SendOptions) => {
      const words = options?.buttons?.length
        ? TextChoices.render(markdown, options.buttons)
        : markdown;
      const refs: SentRef[] = [];
      for (const part of fit(words, PART, (p) => p.length)) {
        const sent = await this.call<{ message?: { _id: string } }>('POST', '/chat.postMessage', {
          roomId: chatId,
          text: part,
        });
        refs.push({ chatId, messageId: sent.message?._id ?? '' });
      }
      const last = refs.at(-1);
      if (last && options?.buttons?.length) choices.remember(last, options.buttons);
      return refs;
    };

    return {
      send,
      edit: async (ref, markdown, options) => {
        choices.forget(ref);
        const words = options?.buttons?.length
          ? TextChoices.render(markdown, options.buttons)
          : markdown;
        await this.call('POST', '/chat.update', {
          roomId: ref.chatId,
          msgId: ref.messageId,
          text: fit(words, PART, (p) => p.length)[0] ?? '…',
        });
        if (options?.buttons?.length) choices.remember(ref, options.buttons);
      },
      typing: async (chatId) => {
        const me = this.#me;
        if (!me || socket?.readyState !== WebSocket.OPEN) return;
        socket.send(
          JSON.stringify({
            msg: 'method',
            method: 'stream-notify-room',
            id: `typing-${Date.now()}`,
            params: [`${chatId}/user-activity`, me.username, ['user-typing'], {}],
          }),
        );
      },
      seen: async (ref, working) => {
        await this.call('POST', '/chat.react', {
          messageId: ref.messageId,
          emoji: ':eyes:',
          shouldReact: working,
        });
      },
      download: (file) => this.#download(file),
      directChat: (userId) => this.#directChat(userId),
      files: {
        maxBytes: UPLOAD_LIMIT,
        send: async (chatId, files, caption) => {
          const refs: SentRef[] = [];
          let words = caption;
          // Too long to go with a file: the words first, on their own.
          if (words && words.length > PART) {
            refs.push(...(await send(chatId, words)));
            words = undefined;
          }
          // One file a message; the caption with the first.
          for (const file of files) {
            refs.push({ chatId, messageId: await this.#upload(chatId, file, words) });
            words = undefined;
          }
          return refs;
        },
      },
      close: () => {
        stop.abort();
        socket?.close(1000);
      },
    };
  }

  async #run(
    events: ChannelEvents,
    signal: AbortSignal,
    choices: TextChoices,
    onSocket: (socket: WebSocket) => void,
  ) {
    const backoff = new Backoff();
    events.state('connecting');
    while (!signal.aborted) {
      try {
        await this.identify(signal);
        const why = await this.#session(events, signal, choices, onSocket, () => backoff.reset());
        if (signal.aborted) return;
        if (why === 'auth')
          return events.state('needs-token', {
            message: 'Rocket.Chat stopped accepting the bot’s token. It was probably removed.',
          });
        const wait = backoff.next();
        events.state('reconnecting', {
          message: 'The connection to Rocket.Chat dropped.',
          retryAt: Date.now() + wait,
        });
        await pause(wait, signal);
      } catch (error) {
        if (signal.aborted) return;
        const failure =
          error instanceof ChannelError ? error : new ChannelError('network', String(error));
        if (failure.code === 'auth')
          return events.state('needs-token', { message: failure.message });
        if (failure.code === 'setup') return events.state('error', { message: failure.message });
        const wait = failure.detail?.retryAfterMs ?? backoff.next();
        events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
        await pause(wait, signal);
      }
    }
  }

  #session(
    events: ChannelEvents,
    signal: AbortSignal,
    choices: TextChoices,
    onSocket: (socket: WebSocket) => void,
    onReady: () => void,
  ): Promise<'dropped' | 'auth'> {
    const url = `${this.#server.replace(/^http/, 'ws')}/websocket`;
    return new Promise((resolve) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        resolve('dropped');
        return;
      }
      onSocket(socket);
      let heard = Date.now();
      const watch = setInterval(() => {
        if (Date.now() - heard > SILENT_MS) socket.close(4000);
      }, 10_000);
      watch.unref?.();
      const finish = (why: 'dropped' | 'auth') => {
        if (settled) return;
        settled = true;
        clearInterval(watch);
        signal.removeEventListener('abort', abort);
        resolve(why);
      };
      const abort = () => {
        socket.close(1000);
        finish('dropped');
      };
      signal.addEventListener('abort', abort, { once: true });
      const send = (frame: unknown) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
      };
      socket.addEventListener('open', () => send({ msg: 'connect', version: '1', support: ['1'] }));
      socket.addEventListener('message', (message) => {
        heard = Date.now();
        let frame: {
          msg?: string;
          id?: string;
          error?: unknown;
          subs?: string[];
          collection?: string;
          fields?: { eventName?: string; args?: unknown[] };
        };
        try {
          frame = JSON.parse(String(message.data)) as typeof frame;
        } catch {
          return;
        }
        if (frame.msg === 'ping') return send({ msg: 'pong' });
        if (frame.msg === 'connected')
          // The token is a resume token for DDP's login: only in this message.
          return send({
            msg: 'method',
            method: 'login',
            id: 'login',
            params: [{ resume: this.secrets.token }],
          });
        if (frame.msg === 'result' && frame.id === 'login') {
          if (frame.error) {
            socket.close(1000);
            finish('auth');
            return;
          }
          send({
            msg: 'sub',
            id: 'messages',
            name: 'stream-room-messages',
            params: ['__my_messages__', false],
          });
          return;
        }
        // Login is not readiness: messages can arrive only after the subscription
        // is acknowledged. Reporting online sooner can lose the first message.
        if (frame.msg === 'ready' && frame.subs?.includes('messages')) {
          onReady();
          events.state('online');
          return;
        }
        if (frame.msg === 'changed' && frame.collection === 'stream-room-messages') {
          const posted = frame.fields?.args?.[0] as RcMessage | undefined;
          if (posted) void this.#posted(posted, events, choices).catch(() => undefined);
        }
      });
      socket.addEventListener('close', () => finish('dropped'));
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) finish('dropped');
      });
    });
  }

  async #posted(posted: RcMessage, events: ChannelEvents, choices: TextChoices) {
    const me = this.#me;
    // Its own messages, system messages, edits and other bots are never read.
    if (!me || !posted.u || posted.u._id === me._id || posted.t || posted.bot || posted.editedAt)
      return;
    const room = await this.#room(posted.rid);
    const user: ChannelUser = {
      id: posted.u._id,
      name: posted.u.name || posted.u.username || 'Someone',
      ...(posted.u.username && { username: posted.u.username }),
    };
    const files: ChannelFile[] = (posted.files ?? (posted.file ? [posted.file] : [])).map((f) => ({
      name: f.name ?? 'file',
      ref: f._id,
      ...(f.type && { mimeType: f.type }),
      ...(f.size !== undefined && { size: f.size }),
    }));
    const text = posted.msg ?? '';
    if (room.type === 'd') {
      const answer = files.length ? undefined : choices.match(posted.rid, text);
      if (answer) {
        events.press({
          chatId: posted.rid,
          user,
          data: answer.data,
          message: answer.ref,
          ack: () => Promise.resolve(),
        });
        return;
      }
      this.#dms.set(user.id, posted.rid);
      events.message({
        chatId: posted.rid,
        messageId: posted._id,
        user,
        text,
        files,
        direct: true,
      });
      return;
    }
    const mentioned = (posted.mentions ?? []).some((m) => m._id === me._id);
    const handle = `@${me.username}`.toLowerCase();
    events.message({
      chatId: posted.rid,
      messageId: posted._id,
      user,
      text: mentioned
        ? text
            .split(/(\s+)/)
            .filter((word) => word.toLowerCase().replace(/[,:]$/, '') !== handle)
            .join('')
            .replace(/ {2,}/g, ' ')
            .trim()
        : text,
      files,
      direct: false,
      mentioned,
      group: room.name ? `#${room.name}` : 'A Rocket.Chat room',
    });
  }

  /**
   * One file into a room, as a message with `text` (Rocket.Chat 6.8+:
   * `rooms.media`, then `rooms.mediaConfirm`); an older server, with `rooms.upload`.
   */
  async #upload(roomId: string, file: OutboundFile, text?: string): Promise<string> {
    const room = encodeURIComponent(roomId);
    const form = () => {
      const data = new FormData();
      data.set('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.name);
      return data;
    };
    let staged: { file?: { _id: string } };
    try {
      staged = await this.call<{ file?: { _id: string } }>('POST', `/rooms.media/${room}`, form());
    } catch (error) {
      if (!(error instanceof ChannelError) || !/\(404/.test(error.message)) throw error;
      const data = form();
      if (text) data.set('msg', text);
      const sent = await this.call<{ message?: { _id: string } }>(
        'POST',
        `/rooms.upload/${room}`,
        data,
      );
      return sent.message?._id ?? '';
    }
    if (!staged.file?._id) throw new ChannelError('refused', 'Rocket.Chat didn’t take the file.');
    const sent = await this.call<{ message?: { _id: string } }>(
      'POST',
      `/rooms.mediaConfirm/${room}/${encodeURIComponent(staged.file._id)}`,
      { msg: text ?? '' },
    );
    return sent.message?._id ?? '';
  }

  /** A file someone attached: only from this server, with the bot's token. */
  async #download(file: ChannelFile) {
    if (!/^[A-Za-z0-9]{10,40}$/.test(file.ref))
      throw new ChannelError('refused', 'That file isn’t on this Rocket.Chat server.');
    if (file.size && file.size > FILE_LIMIT)
      throw new ChannelError('refused', 'Files from Rocket.Chat can be 25 MB at most.');
    let response: Response;
    try {
      response = await fetch(
        `${this.#server}/file-upload/${file.ref}/${encodeURIComponent(file.name)}`,
        {
          headers: { 'x-user-id': this.secrets.userId, 'x-auth-token': this.secrets.token },
          redirect: 'error',
          signal: AbortSignal.timeout(60_000),
        },
      );
    } catch (error) {
      throw new ChannelError(
        'network',
        redact(`Couldn’t download that file (${(error as Error).message}).`, this.secrets.token),
      );
    }
    if (!response.ok)
      throw new ChannelError(
        'network',
        `Rocket.Chat didn’t hand over that file (${response.status}).`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > FILE_LIMIT)
      throw new ChannelError('refused', 'Files from Rocket.Chat can be 25 MB at most.');
    return { name: file.name, bytes, ...(file.mimeType && { mimeType: file.mimeType }) };
  }
}
