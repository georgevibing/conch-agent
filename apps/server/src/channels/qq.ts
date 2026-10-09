/**
 * QQ (ADR 0120): a bot on QQ's bot platform (q.qq.com), reached over its
 * **WebSocket gateway**, which Conch opens from this computer, so nothing
 * needs a public address. QQ's own guide recommends it for exactly this: an
 * assistant on one computer.
 *
 * - **Who it is**: the bot's AppID and AppSecret, checked at once for an
 *   access token (`POST /app/getAppAccessToken`), then `GET /users/@me`.
 * - **The gateway**: Hello, Identify (private chats and groups,
 *   `GROUP_AND_C2C_EVENT`, and button presses, `INTERACTION`), heartbeats at
 *   the interval QQ asks for, and Resume after a drop, so nothing is missed;
 *   a session QQ no longer knows is identified again.
 * - **Answers** go as Markdown (open to every bot since April 2026), plain
 *   text where QQ refuses it. Each answer replies to the message it answers
 *   while QQ allows (an hour in a private chat, five minutes in a group, a
 *   few replies each); later ones go as messages of the bot's own.
 * - **Approvals** are numbered answers, with buttons under them where QQ
 *   shows them (custom buttons are opened to bots by invitation): a press
 *   is acknowledged at once, and what was decided comes as a new message.
 * - **Groups** (ADR 0075): QQ only delivers a group's messages that
 *   @mention the bot.
 * - **Voice messages** come with QQ's own transcript (`asr_refer_text`), or
 *   as a WAV Conch hears itself (ADR 0077).
 * - **Adding the bot as a friend** is the hello: nothing to think of typing.
 *
 * Only QQ's own API is called (api.bot.qq.com), with the person's own bot's keys.
 */
import { randomBytes } from 'node:crypto';

import type { ChannelBot, ChannelSecrets } from '@conch/protocol';

import type { ChannelEndpoints } from './adapters';
import { fit, plain } from './format';
import { Recent, TextChoices } from './linked';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type OutboundFile,
  type SendOptions,
  type SentRef,
  appId,
  capOf,
  dataUrl,
  pause,
  personId,
  readCapped,
  redact,
} from './types';

type QqSecrets = Extract<ChannelSecrets, { kind: 'qq' }>;

export const QQ_API = 'https://api.bot.qq.com';

/** Private chats and groups (1 << 25), and button presses (1 << 26). */
export const INTENTS = (1 << 25) | (1 << 26);
/** QQ doesn't say a limit; its own SDK cuts at 5000 characters. Keep under. */
const PART = 3_000;
/** A file sent as base64 in JSON: keep the request reasonable. */
const UPLOAD_LIMIT = 10 * 1024 * 1024;
const DOWNLOAD_LIMIT = 50 * 1024 * 1024;
/** How long, and how many times, a message may be replied to (QQ: an hour and 4 in private, 5 minutes and 5 in a group). */
const REPLY_WINDOW = { direct: 55 * 60_000, group: 4.5 * 60_000 };
const REPLIES = { direct: 4, group: 5 };

/** What was pasted, tidied. */
export function normalizeQq(secrets: QqSecrets): QqSecrets {
  return {
    kind: 'qq',
    appId: /\b(\d{6,12})\b/.exec(secrets.appId)?.[1] ?? secrets.appId.trim(),
    appSecret: /\b([A-Za-z0-9]{16,64})\b/.exec(secrets.appSecret)?.[1] ?? secrets.appSecret.trim(),
    ...(secrets.hookId && { hookId: secrets.hookId }),
  };
}

/** Files come only from QQ's own servers. */
function qqHost(url: string, extra: string[]): boolean {
  try {
    const parsed = new URL(url);
    if (extra.some((origin) => parsed.origin === new URL(origin).origin)) return true;
    return (
      parsed.protocol === 'https:' &&
      /(^|\.)(qq\.com|qpic\.cn|gtimg\.cn|qq\.com\.cn|myqcloud\.com|qlogo\.cn)$/.test(
        parsed.hostname,
      )
    );
  } catch {
    return false;
  }
}

/** A gateway payload. */
interface Payload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
  id?: string;
}

interface Attachment {
  content_type?: string;
  url?: string;
  filename?: string;
  size?: number;
  voice_wav_url?: string;
  asr_refer_text?: string;
}

/** QQ's error codes, as what to change. */
function qqError(status: number, code: number, said: string): ChannelError {
  if (code === 100016 || code === 11241 || code === 11242)
    return new ChannelError(
      'auth',
      'QQ doesn’t accept this AppID and AppSecret. Copy both again from the bot’s page on q.qq.com (开发设置).',
      { field: 'appSecret' },
    );
  if (code === 10004 || code === 100007)
    return new ChannelError(
      'auth',
      code === 10004
        ? 'QQ doesn’t know a bot with that AppID. Copy it again from the bot’s page on q.qq.com.'
        : 'QQ says this bot isn’t allowed to run (its AppID is wrong, or it was banned).',
      { field: 'appId' },
    );
  if (status === 429 || code === 100001 || code === 22009 || code === 304045)
    return new ChannelError('rate-limit', 'QQ asked Conch to slow down.', { retryAfterMs: 3_000 });
  if (status >= 500) return new ChannelError('network', `QQ had a problem (${status}).`);
  return new ChannelError('refused', `QQ said no (${code || status}${said ? ` ${said}` : ''}).`);
}

/** QQ, through a bot of your own and its WebSocket gateway. */
export class QqAdapter implements ChannelAdapter {
  readonly kind = 'qq' as const;
  /** QQ delivers only the group messages that @mention the bot (ADR 0075). */
  readonly groups = true;
  #token?: { value: string; expiresAt: number };

  constructor(
    private readonly secrets: QqSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get api() {
    return this.endpoints.qq ?? QQ_API;
  }

  async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now() + 90_000) return this.#token.value;
    if (!/^\d{6,12}$/.test(this.secrets.appId))
      throw new ChannelError(
        'auth',
        'That doesn’t look like an AppID. It’s the number on the bot’s page on q.qq.com.',
        { field: 'appId' },
      );
    let response: Response;
    try {
      response = await fetch(`${this.endpoints.qqToken ?? this.api}/app/getAppAccessToken`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: this.secrets.appId, clientSecret: this.secrets.appSecret }),
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach QQ (${(error as Error).message}).`, this.secrets.appSecret),
      );
    }
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: string | number;
      code?: number;
      message?: string;
    };
    if (!data.access_token)
      throw qqError(response.status, Number(data.code ?? 0) || response.status, data.message ?? '');
    this.#token = {
      value: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 7200) * 1000,
    };
    return data.access_token;
  }

  async call<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { signal?: AbortSignal; retried?: boolean } = {},
  ): Promise<T> {
    const token = await this.accessToken(options.signal);
    let response: Response;
    try {
      response = await fetch(`${this.api}${path}`, {
        method,
        headers: {
          authorization: `QQBot ${token}`,
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(path.endsWith('/files') ? 120_000 : 15_000),
          ...(options.signal ? [options.signal] : []),
        ]),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach QQ (${(error as Error).message}).`, this.secrets.appSecret, token),
      );
    }
    const data = (await response.json().catch(() => ({}))) as T & {
      code?: number;
      err_code?: number;
      message?: string;
    };
    if (response.ok && !data.code) return data;
    if (response.status === 401 && !options.retried) {
      this.#token = undefined;
      return this.call(method, path, body, { ...options, retried: true });
    }
    throw qqError(
      response.status,
      Number(data.code ?? data.err_code ?? 0),
      redact(data.message ?? '', this.secrets.appSecret, token),
    );
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    await this.accessToken(signal);
    const me = await this.call<{ id?: string; username?: string; avatar?: string }>(
      'GET',
      '/users/@me',
      undefined,
      { signal },
    ).catch(() => undefined);
    const avatar = me?.avatar ? await this.#avatar(me.avatar).catch(() => undefined) : undefined;
    return {
      id: this.secrets.appId,
      name: me?.username?.trim() || 'QQ bot',
      ...(avatar && { avatar }),
    };
  }

  async #avatar(url: string): Promise<string | undefined> {
    if (!qqHost(url, [])) return undefined;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return undefined;
    return dataUrl(
      await readCapped(response, 120_000),
      response.headers.get('content-type') ?? 'image/png',
    );
  }

  connect(events: ChannelEvents): ChannelConnection {
    const session = new QqSession(this, events, this.endpoints.qqFiles ?? []);
    void session.run();
    return {
      send: (chatId, markdown, options) => session.send(chatId, markdown, options),
      // QQ can't change a message once sent: what was decided goes as a new one.
      edit: async (ref, markdown) => {
        session.forget(ref);
        await session.send(ref.chatId, markdown);
      },
      typing: () => Promise.resolve(),
      download: (file, options) => session.download(file, options),
      directChat: (userId) => Promise.resolve(appId(userId)),
      files: {
        maxBytes: UPLOAD_LIMIT,
        send: (chatId, files, caption) => session.sendFiles(chatId, files, caption),
      },
      close: () => session.close(),
    };
  }
}

/** A group's chat as Conch keeps it, apart from a person's (both are QQ openids). */
const GROUP = 'g:';
const isGroup = (chatId: string) => chatId.startsWith(GROUP);
const target = (chatId: string) =>
  isGroup(chatId)
    ? `/v2/groups/${encodeURIComponent(chatId.slice(GROUP.length))}`
    : `/v2/users/${encodeURIComponent(chatId)}`;

/** What the next message in a chat may reply to (QQ counts replies to each). */
interface ReplyTo {
  field: 'msg_id' | 'event_id';
  id: string;
  at: number;
  used: number;
}

/** A button's words, as QQ shows them (ten characters at most). */
const shortLabel = (label: string) => (label.length <= 10 ? label : `${label.slice(0, 9)}…`);

class QqSession {
  #stop = new AbortController();
  #socket?: WebSocket;
  #seen = new Recent(2000);
  #choices = new TextChoices();
  #replyTo = new Map<string, ReplyTo>();
  #session?: { id: string; seq: number };
  /** QQ refused Markdown, or buttons, for this bot: plain words from now on. */
  #plainOnly = false;
  #noButtons = false;

  constructor(
    private readonly adapter: QqAdapter,
    private readonly events: ChannelEvents,
    private readonly files: string[],
  ) {}

  close() {
    this.#stop.abort();
    this.#socket?.close(1000);
  }

  forget(ref: SentRef) {
    this.#choices.forget(ref);
  }

  async run() {
    const signal = this.#stop.signal;
    const backoff = new Backoff();
    this.events.state('connecting');
    while (!signal.aborted) {
      try {
        await this.adapter.accessToken(signal);
        const gateway = await this.adapter.call<{ url?: string }>(
          'GET',
          '/gateway/bot',
          undefined,
          {
            signal,
          },
        );
        if (!gateway.url || !/^wss?:\/\//.test(gateway.url))
          throw new ChannelError('network', 'QQ didn’t say where its gateway is.');
        const ended = await this.#connect(gateway.url, signal, () => backoff.reset());
        if (signal.aborted) return;
        if (ended === 'fatal') return;
        if (ended === 'resume') continue;
        const wait = ended === 'slow' ? 60_000 : backoff.next();
        this.events.state('reconnecting', {
          message: 'Reconnecting to QQ.',
          retryAt: Date.now() + wait,
        });
        await pause(wait, signal);
      } catch (error) {
        if (signal.aborted) return;
        const failure =
          error instanceof ChannelError ? error : new ChannelError('network', String(error));
        if (failure.code === 'auth')
          return this.events.state('needs-token', { message: failure.message });
        if (failure.code === 'setup')
          return this.events.state('error', { message: failure.message });
        const wait =
          failure.code === 'rate-limit' && failure.detail?.retryAfterMs
            ? failure.detail.retryAfterMs
            : backoff.next();
        this.events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
        await pause(wait, signal);
      }
    }
  }

  /**
   * One gateway connection. `resume`: reconnect now and carry on where it
   * was; `dropped`: after a pause; `slow`: QQ asked for a minute; `fatal`:
   * only a person can fix it (the state says how).
   */
  #connect(
    url: string,
    signal: AbortSignal,
    onReady: () => void,
  ): Promise<'resume' | 'dropped' | 'slow' | 'fatal'> {
    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        resolve('dropped');
        return;
      }
      this.#socket = socket;
      let settled = false;
      let beat: NodeJS.Timeout | undefined;
      let missed = 0;
      const finish = (why: 'resume' | 'dropped' | 'slow' | 'fatal') => {
        if (settled) return;
        settled = true;
        clearInterval(beat);
        signal.removeEventListener('abort', abort);
        socket.close(1000);
        resolve(why);
      };
      const abort = () => finish('dropped');
      signal.addEventListener('abort', abort, { once: true });
      const write = (payload: Payload) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
      };
      socket.addEventListener('message', (message) => {
        let payload: Payload;
        try {
          payload = JSON.parse(String(message.data)) as Payload;
        } catch {
          return;
        }
        if (typeof payload.s === 'number' && this.#session) this.#session.seq = payload.s;
        switch (payload.op) {
          case 10: {
            const interval = Math.max(
              5_000,
              Number(
                (payload.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval,
              ) || 41_250,
            );
            beat = setInterval(() => {
              // Two heartbeats without an answer: this socket is gone, whatever it looks like.
              if (++missed > 2) return finish('resume');
              write({ op: 1, d: this.#session?.seq ?? null });
            }, interval);
            beat.unref?.();
            void this.adapter.accessToken(signal).then(
              (token) =>
                this.#session
                  ? write({
                      op: 6,
                      d: {
                        token: `QQBot ${token}`,
                        session_id: this.#session.id,
                        seq: this.#session.seq,
                      },
                    })
                  : write({
                      op: 2,
                      d: {
                        token: `QQBot ${token}`,
                        intents: INTENTS,
                        shard: [0, 1],
                        properties: { $os: process.platform, $browser: 'conch', $device: 'conch' },
                      },
                    }),
              () => finish('dropped'),
            );
            return;
          }
          case 11:
            missed = 0;
            return;
          case 7:
            // QQ asks for a new connection: resume on it.
            return finish('resume');
          case 9:
            // The session can't be resumed: a new one, at once.
            this.#session = undefined;
            return finish('resume');
          case 0:
            void this.#dispatch(payload, onReady);
            return;
          default:
            return;
        }
      });
      socket.addEventListener('close', (event) => {
        const code = event.code;
        if (code === 4004) {
          // A token QQ no longer takes: a fresh one, and a new session.
          this.#session = undefined;
          return finish('resume');
        }
        if (code === 4006 || code === 4007 || code === 4009) {
          this.#session = undefined;
          return finish('resume');
        }
        if (code === 4008) return finish('slow');
        if (code === 4914 || code === 4915) {
          this.events.state('error', {
            message:
              code === 4915
                ? 'QQ banned this bot, so it can’t connect. Its page on q.qq.com says why.'
                : 'QQ says this bot isn’t live: it was taken down, or only its sandbox may connect. Check its status on its page at q.qq.com, then press Repair.',
          });
          return finish('fatal');
        }
        finish('dropped');
      });
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) finish('dropped');
      });
    });
  }

  async #dispatch(payload: Payload, onReady: () => void) {
    const d = (payload.d ?? {}) as Record<string, unknown>;
    switch (payload.t) {
      case 'READY':
        this.#session = { id: String(d.session_id ?? ''), seq: payload.s ?? 0 };
        onReady();
        this.events.state('online');
        return;
      case 'RESUMED':
        onReady();
        this.events.state('online');
        return;
      case 'C2C_MESSAGE_CREATE':
      case 'GROUP_AT_MESSAGE_CREATE':
        await this.#message(payload.t, d);
        return;
      case 'INTERACTION_CREATE':
        await this.#press(d);
        return;
      case 'FRIEND_ADD': {
        // Adding the bot is the hello.
        const openid = String(d.openid ?? '');
        if (!/^[\w-]{6,128}$/.test(openid) || !this.#seen.add(`friend:${openid}`)) return;
        if (payload.id)
          this.#replyTo.set(openid, { field: 'event_id', id: payload.id, at: Date.now(), used: 0 });
        this.events.message({
          chatId: openid,
          messageId: `friend-${openid}`,
          user: this.#user(openid),
          text: 'hello',
          files: [],
          direct: true,
        });
        return;
      }
      default:
        return;
    }
  }

  /**
   * QQ never says who someone is: an id, its end shown. In a private chat
   * that's all there is (the owner becomes you, by your name in Conch); in a
   * group QQ gives each member an id of that group's own, so a member is
   * known by it, and is a guest there (ADR 0075), the owner too.
   */
  #user(openid: string, member = false) {
    return member
      ? { id: personId(openid), name: `Member ·${openid.slice(-4)}` }
      : { id: personId(openid), name: `QQ user ·${openid.slice(-4)}`, anonymous: true };
  }

  async #message(type: string, d: Record<string, unknown>) {
    const id = String(d.id ?? '');
    if (!id || !this.#seen.add(`m:${id}`)) return;
    const author = (d.author ?? {}) as {
      user_openid?: string;
      member_openid?: string;
      bot?: boolean;
    };
    if (author.bot) return;
    const direct = type === 'C2C_MESSAGE_CREATE';
    const openid = direct ? author.user_openid : author.member_openid;
    const group = direct ? undefined : String(d.group_openid ?? '');
    if (!openid || (!direct && !group)) return;
    const chatId = direct ? openid : `${GROUP}${group}`;
    this.#replyTo.set(chatId, { field: 'msg_id', id, at: Date.now(), used: 0 });
    let text = String(d.content ?? '').trim();
    const files: ChannelFile[] = [];
    for (const a of (d.attachments ?? []) as Attachment[]) {
      const url = (u?: string) => (u?.startsWith('//') ? `https:${u}` : u);
      if (a.content_type === 'voice') {
        // QQ's own transcript first; else the WAV it made, which Conch hears itself.
        if (a.asr_refer_text?.trim()) text = `${text} ${a.asr_refer_text.trim()}`.trim();
        else if (a.voice_wav_url)
          files.push({
            name: 'voice.wav',
            mimeType: 'audio/wav',
            ref: url(a.voice_wav_url) ?? '',
            voice: true,
          });
        continue;
      }
      const ref = url(a.url);
      if (!ref) continue;
      files.push({
        name: a.filename || (a.content_type?.startsWith('image/') ? 'picture.jpg' : 'file'),
        ref,
        ...(a.content_type && a.content_type !== 'file' && { mimeType: a.content_type }),
        ...(a.size && { size: a.size }),
      });
    }
    const user = this.#user(openid, !direct);
    if (direct && !files.length) {
      const answer = this.#choices.match(chatId, text);
      if (answer) {
        this.#choices.forget(answer.ref);
        this.events.press({
          chatId,
          user,
          data: answer.data,
          message: answer.ref,
          ack: () => Promise.resolve(),
        });
        return;
      }
    }
    if (!text && !files.length) return;
    this.events.message({
      chatId,
      messageId: id,
      user,
      text,
      files,
      direct,
      ...(!direct && { mentioned: true, group: `A QQ group ·${(group ?? '').slice(-4)}` }),
    });
  }

  /** A button pressed: told to QQ at once (or its app spins), then handed on. */
  async #press(d: Record<string, unknown>) {
    const id = String(d.id ?? '');
    if (!id || !this.#seen.add(`i:${id}`)) return;
    await this.adapter
      .call('PUT', `/interactions/${encodeURIComponent(id)}`, { code: 0 })
      .catch(() => undefined);
    const resolved = ((
      d.data as { resolved?: { button_data?: string; message_id?: string } } | undefined
    )?.resolved ?? {}) as { button_data?: string; message_id?: string };
    const groupId = d.group_openid ? String(d.group_openid) : undefined;
    const openid = String(groupId ? (d.group_member_openid ?? '') : (d.user_openid ?? ''));
    if (!openid || !resolved.button_data) return;
    const chatId = groupId ? `${GROUP}${groupId}` : openid;
    // A press may be answered, like a message.
    this.#replyTo.set(chatId, { field: 'event_id', id, at: Date.now(), used: 0 });
    const ref = { chatId, messageId: resolved.message_id ?? '' };
    this.#choices.forget(ref);
    this.events.press({
      chatId,
      user: this.#user(openid, Boolean(groupId)),
      data: resolved.button_data,
      message: ref,
      ack: () => Promise.resolve(),
    });
  }

  /** Reply to the latest message while QQ allows it; the bot's own message after that. */
  #reply(chatId: string): Record<string, unknown> {
    const to = this.#replyTo.get(chatId);
    if (!to) return {};
    const group = isGroup(chatId);
    if (
      Date.now() - to.at > (group ? REPLY_WINDOW.group : REPLY_WINDOW.direct) ||
      to.used >= (group ? REPLIES.group : REPLIES.direct)
    ) {
      this.#replyTo.delete(chatId);
      return {};
    }
    to.used += 1;
    return { [to.field]: to.id, msg_seq: to.used };
  }

  async #withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        !(error instanceof ChannelError) ||
        (error.code !== 'rate-limit' && error.code !== 'network')
      )
        throw error;
      await pause(Math.min(error.detail?.retryAfterMs ?? 1500, 30_000), this.#stop.signal);
      return fn();
    }
  }

  async #post(chatId: string, body: Record<string, unknown>): Promise<string> {
    const sent = await this.#withRetry(() =>
      this.adapter.call<{ id?: string }>('POST', `${target(chatId)}/messages`, {
        ...body,
        ...this.#reply(chatId),
      }),
    );
    return sent.id ?? randomBytes(6).toString('hex');
  }

  #keyboard(buttons: NonNullable<SendOptions['buttons']>) {
    return {
      content: {
        rows: [
          {
            buttons: buttons.slice(0, 5).map((b, i) => ({
              id: String(i + 1),
              render_data: {
                label: shortLabel(b.label),
                visited_label: shortLabel(b.label),
                style: b.style === 'primary' ? 1 : 0,
              },
              action: {
                type: 1,
                data: b.data,
                permission: { type: 2 },
                unsupport_tips: 'Reply with its number instead.',
              },
            })),
          },
        ],
      },
    };
  }

  async send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const buttons = options?.buttons ?? [];
    const words = buttons.length ? TextChoices.render(markdown, buttons) : markdown;
    const parts = fit(words, PART, (p) => p.length);
    if (!parts.length) parts.push('…');
    const refs: SentRef[] = [];
    for (const [i, part] of parts.entries()) {
      const last = i === parts.length - 1;
      const keyboard =
        last && buttons.length && !this.#noButtons ? this.#keyboard(buttons) : undefined;
      let id: string | undefined;
      if (!this.#plainOnly) {
        try {
          id = await this.#post(chatId, {
            msg_type: 2,
            markdown: { content: part },
            ...(keyboard && { keyboard }),
          });
        } catch (error) {
          if (!(error instanceof ChannelError) || error.code !== 'refused') throw error;
          // Buttons are opened to bots by invitation: without them, the numbers still answer.
          if (keyboard) {
            this.#noButtons = true;
            try {
              id = await this.#post(chatId, { msg_type: 2, markdown: { content: part } });
            } catch (again) {
              if (!(again instanceof ChannelError) || again.code !== 'refused') throw again;
              this.#plainOnly = true;
            }
          } else this.#plainOnly = true;
          if (!id)
            this.events.healed(
              'Sent QQ answers as plain text. QQ didn’t take Markdown from this bot.',
            );
        }
      }
      id ??= await this.#post(chatId, { msg_type: 0, content: plain(part) });
      refs.push({ chatId, messageId: id });
    }
    const last = refs.at(-1);
    if (last && buttons.length) this.#choices.remember(last, buttons);
    return refs;
  }

  /** Each file uploaded to the chat, then sent as rich media; the caption first, in words. */
  async sendFiles(chatId: string, files: OutboundFile[], caption?: string): Promise<SentRef[]> {
    const refs: SentRef[] = caption?.trim() ? await this.send(chatId, caption) : [];
    for (const file of files) {
      const picture = file.image && /^image\/(?:png|jpeg)$/.test(file.mimeType);
      if (!picture && isGroup(chatId))
        throw new ChannelError(
          'refused',
          `QQ groups take pictures (PNG or JPEG) from a bot, not files, so ${file.name} can’t go there.`,
        );
      const up = await this.#withRetry(() =>
        this.adapter.call<{ file_info?: string }>('POST', `${target(chatId)}/files`, {
          file_type: picture ? 1 : 4,
          file_data: file.bytes.toString('base64'),
          srv_send_msg: false,
          ...(!picture && { file_name: file.name }),
        }),
      );
      if (!up.file_info) throw new ChannelError('refused', `QQ didn’t take ${file.name}.`);
      refs.push({
        chatId,
        messageId: await this.#post(chatId, {
          msg_type: 7,
          media: { file_info: up.file_info },
          content: ' ',
        }),
      });
    }
    return refs;
  }

  async download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(DOWNLOAD_LIMIT, options);
    if (!qqHost(file.ref, this.files))
      throw new ChannelError('refused', 'That file isn’t on QQ’s own servers.');
    const response = await fetch(file.ref, {
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    }).catch((error: unknown) => {
      throw new ChannelError(
        'network',
        `Couldn’t download that file (${(error as Error).message}).`,
      );
    });
    if (!response.ok)
      throw new ChannelError('network', `Couldn’t download that file (${response.status}).`);
    const bytes = await readCapped(response, cap, 'That file is too big to take from QQ.');
    const mimeType =
      file.mimeType ?? (response.headers.get('content-type')?.split(';')[0] || undefined);
    return { name: file.name, bytes, ...(mimeType && { mimeType }) };
  }
}
