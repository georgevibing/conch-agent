/**
 * LINE (ADR 0082): a LINE Official Account's bot, through the Messaging API.
 * LINE only delivers to a web address, so messages come in through the
 * public door (ADR 0045); answers go out through LINE's REST API.
 *
 * - **Every delivery is signed**: `x-line-signature` is the base64 HMAC-SHA256
 *   of the exact body with the channel secret, checked in constant time
 *   before anything is read. A repeated `webhookEventId` is one event, and an
 *   event older than an hour is not read.
 * - **Conch points the channel at the door itself** (`PUT
 *   /v2/bot/channel/webhook/endpoint`), and again whenever the door's address
 *   changes, so there's no address to paste.
 * - **Answers** use the free reply token while it's fresh, else a push
 *   message (which counts against the account's monthly messages). Plain
 *   text: LINE has no Markdown. Approvals are quick-reply buttons whose
 *   postback comes back signed like everything else.
 * - **Groups** (ADR 0075): a group or room is answered only once you turn it
 *   on, and only when the bot is @mentioned.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ChannelBot, ChannelSecrets } from '@conch/protocol';

import type { ChannelEndpoints } from './adapters';
import type { HookReply, HookRequest } from './door';
import { fit, plain } from './format';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelUser,
  type SendOptions,
  type SentRef,
  dataUrl,
  pause,
  redact,
} from './types';

export const LINE_API = 'https://api.line.me';
export const LINE_DATA_API = 'https://api-data.line.me';

type LineSecrets = Extract<ChannelSecrets, { kind: 'line' }>;

/** LINE takes 5000 characters a text message; parts this long stay under. */
const PART = 4800;
/** A reply token is used while it's this fresh; after that, a push message. */
const REPLY_FRESH_MS = 50_000;
/** Events remembered, so a redelivery is one event. */
const SEEN = 1000;
/** Events older than this aren't read (a replay, or a backlog from long ago). */
const STALE_MS = 60 * 60_000;
const FILE_LIMIT = 20 * 1024 * 1024;

/** LINE's signature of a delivery: the base64 HMAC-SHA256 of the exact body with the channel secret. */
export function lineSignature(channelSecret: string, body: string): string {
  return createHmac('sha256', channelSecret).update(body, 'utf8').digest('base64');
}

export function signedByLine(channelSecret: string, body: string, signature?: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(lineSignature(channelSecret, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Find the secret and the token in whatever was pasted. */
export function normalizeLine(secrets: LineSecrets, kept?: LineSecrets): LineSecrets {
  return {
    kind: 'line',
    channelSecret:
      /\b([0-9a-f]{32})\b/.exec(secrets.channelSecret)?.[1] ?? secrets.channelSecret.trim(),
    accessToken: secrets.accessToken.trim(),
    hookId: kept?.hookId ?? secrets.hookId ?? randomBytes(18).toString('base64url'),
  };
}

interface LineSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

interface LineEvent {
  type: string;
  webhookEventId?: string;
  timestamp?: number;
  replyToken?: string;
  source?: LineSource;
  deliveryContext?: { isRedelivery?: boolean };
  message?: {
    id: string;
    type: string;
    text?: string;
    fileName?: string;
    fileSize?: number;
    mention?: {
      mentionees?: { index: number; length: number; userId?: string; isSelf?: boolean }[];
    };
  };
  postback?: { data: string };
}

/** LINE through a Messaging API channel (ADR 0082). */
export class LineAdapter implements ChannelAdapter {
  readonly kind = 'line' as const;
  /** Mentions in groups are told apart (ADR 0075). */
  readonly groups = true;
  #people = new Map<string, ChannelUser>();
  #places = new Map<string, string>();
  #endpoint?: string;

  constructor(
    private readonly secrets: LineSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get #api() {
    return this.endpoints.line ?? LINE_API;
  }

  get #data() {
    return this.endpoints.lineData ?? this.endpoints.line ?? LINE_DATA_API;
  }

  async call<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { signal?: AbortSignal; base?: string } = {},
  ): Promise<T> {
    if (!/^[\x21-\x7e]{20,1000}$/.test(this.secrets.accessToken))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a channel access token. Issue one at the bottom of the Messaging API tab.',
        { field: 'accessToken' },
      );
    let response: Response;
    try {
      response = await fetch(`${options.base ?? this.#api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.secrets.accessToken}`,
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(15_000),
          ...(options.signal ? [options.signal] : []),
        ]),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach LINE (${(error as Error).message}).`, this.secrets.accessToken),
      );
    }
    if (response.ok) {
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    const said = (await response.json().catch(() => ({}))) as { message?: string };
    const message = redact(said.message ?? '', this.secrets.accessToken);
    if (response.status === 401)
      throw new ChannelError(
        'auth',
        'LINE doesn’t accept that channel access token. Issue a new one at the bottom of the Messaging API tab.',
        { field: 'accessToken' },
      );
    if (response.status === 429)
      throw /monthly limit/i.test(message)
        ? new ChannelError(
            'setup',
            'This LINE account has sent all the messages its plan allows this month. Answers within a minute of your message still go; for the rest, raise the plan in LINE Official Account Manager.',
          )
        : new ChannelError('rate-limit', 'LINE asked Conch to slow down.', { retryAfterMs: 2_000 });
    if (response.status >= 500)
      throw new ChannelError('network', `LINE had a problem (${response.status}).`);
    throw new ChannelError(
      'refused',
      `LINE said no (${response.status}${message ? `: ${message}` : ''}).`,
    );
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    if (!/^[0-9a-f]{32}$/.test(this.secrets.channelSecret))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a channel secret. It’s 32 letters and digits on the Basic settings tab.',
        { field: 'channelSecret' },
      );
    const info = await this.call<{
      userId: string;
      basicId?: string;
      displayName?: string;
      pictureUrl?: string;
    }>('GET', '/v2/bot/info', undefined, { signal });
    return {
      id: info.userId,
      name: info.displayName || 'LINE bot',
      ...(info.basicId && {
        username: info.basicId,
        chatUrl: `https://line.me/R/ti/p/${encodeURIComponent(info.basicId)}`,
      }),
      ...(await this.#avatar(info.pictureUrl).catch(() => undefined)),
    };
  }

  /** The bot's picture, small, if LINE's own profile host has one. */
  async #avatar(url?: string): Promise<{ avatar: string } | undefined> {
    if (!url || !/^https:\/\/profile\.line-scdn\.net\//.test(url)) return undefined;
    const response = await fetch(`${url}/small`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    const avatar = dataUrl(Buffer.from(await response.arrayBuffer()), 'image/jpeg');
    return avatar ? { avatar } : undefined;
  }

  hook() {
    const url = this.endpoints.door?.hookUrl(this.secrets.hookId ?? '');
    return url ? { url } : {};
  }

  async #person(userId: string, source?: LineSource): Promise<ChannelUser> {
    const known = this.#people.get(userId);
    if (known) return known;
    const path =
      source?.type === 'group' && source.groupId
        ? `/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(userId)}`
        : source?.type === 'room' && source.roomId
          ? `/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(userId)}`
          : `/v2/bot/profile/${encodeURIComponent(userId)}`;
    const profile = await this.call<{ displayName?: string }>('GET', path).catch(() => undefined);
    const person: ChannelUser = { id: userId, name: profile?.displayName || 'Someone on LINE' };
    if (profile?.displayName) this.#people.set(userId, person);
    return person;
  }

  async #place(source: LineSource): Promise<string> {
    const id = source.groupId ?? source.roomId ?? '';
    const known = this.#places.get(id);
    if (known) return known;
    if (source.type !== 'group' || !source.groupId) return 'A LINE chat';
    const summary = await this.call<{ groupName?: string }>(
      'GET',
      `/v2/bot/group/${encodeURIComponent(source.groupId)}/summary`,
    ).catch(() => undefined);
    const name = summary?.groupName || 'A LINE group';
    if (summary?.groupName) this.#places.set(id, name);
    return name;
  }

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    const door = this.endpoints.door;
    const seen = new Set<string>();
    /** The freshest reply token per chat, used once. */
    const replies = new Map<string, { token: string; at: number }>();

    const health = async () => {
      const url = this.hook().url;
      if (!url) {
        events.state('error', {
          message:
            door?.status().state === 'starting'
              ? 'Turning on the public address LINE delivers to…'
              : 'LINE can’t reach Conch yet: turn on its public address on this channel’s page.',
        });
        return;
      }
      const backoff = new Backoff();
      while (!stop.signal.aborted) {
        try {
          if (this.#endpoint !== url) {
            await this.call(
              'PUT',
              '/v2/bot/channel/webhook/endpoint',
              { endpoint: url },
              {
                signal: stop.signal,
              },
            );
            this.#endpoint = url;
          }
          events.state('online');
          return;
        } catch (error) {
          if (stop.signal.aborted) return;
          const failure =
            error instanceof ChannelError ? error : new ChannelError('network', String(error));
          if (failure.code === 'auth')
            return events.state('needs-token', { message: failure.message });
          if (failure.code === 'setup' || failure.code === 'refused')
            return events.state('error', { message: failure.message });
          const wait = failure.detail?.retryAfterMs ?? backoff.next();
          events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
          await pause(wait, stop.signal);
        }
      }
    };

    const deliver = async (request: HookRequest): Promise<HookReply> => {
      if (request.method !== 'POST') return { status: 405 };
      // Nothing is read before LINE's signature checks out.
      if (
        !signedByLine(this.secrets.channelSecret, request.body, request.headers['x-line-signature'])
      )
        return { status: 401 };
      let payload: { destination?: string; events?: LineEvent[] };
      try {
        payload = JSON.parse(request.body) as typeof payload;
      } catch {
        return { status: 400 };
      }
      events.heard?.();
      for (const event of payload.events ?? []) {
        const id = event.webhookEventId;
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
          if (seen.size > SEEN) seen.delete(seen.values().next().value ?? '');
        }
        if (event.timestamp && Date.now() - event.timestamp > STALE_MS) continue;
        void this.#event(event, events, replies).catch(() => undefined);
      }
      return { status: 200, body: '{}', type: 'application/json' };
    };

    const unmount = door?.mount(this.secrets.hookId ?? '', 'line', deliver);
    const offDoor = door?.onChange(() => {
      events.changed?.();
      void health();
    });
    events.state('connecting');
    void health();

    const send = async (chatId: string, markdown: string, options?: SendOptions) => {
      const parts = fit(markdown, PART, (p) => plain(p).length).map((p) => plain(p) || '…');
      const refs: SentRef[] = [];
      for (const [index, part] of parts.entries()) {
        const last = index === parts.length - 1;
        const message = {
          type: 'text',
          text: part,
          ...(last &&
            options?.buttons?.length && {
              quickReply: {
                items: options.buttons.slice(0, 13).map((b) => ({
                  type: 'action',
                  action: {
                    type: 'postback',
                    label: b.label.slice(0, 20),
                    data: b.data.slice(0, 300),
                    displayText: b.label.slice(0, 300),
                  },
                })),
              },
            }),
        };
        const fresh = replies.get(chatId);
        if (fresh && Date.now() - fresh.at < REPLY_FRESH_MS) {
          replies.delete(chatId);
          const ok = await this.call('POST', '/v2/bot/message/reply', {
            replyToken: fresh.token,
            messages: [message],
          }).then(
            () => true,
            () => false,
          );
          if (ok) {
            refs.push({ chatId, messageId: `r${Date.now()}${index}` });
            continue;
          }
        }
        const pushed = await this.call<{ sentMessages?: { id: string }[] }>(
          'POST',
          '/v2/bot/message/push',
          { to: chatId, messages: [message] },
        );
        refs.push({ chatId, messageId: pushed.sentMessages?.[0]?.id ?? `p${Date.now()}${index}` });
      }
      return refs;
    };

    return {
      send,
      // A LINE message can't be changed once sent; its quick replies end with the next one.
      edit: () => Promise.resolve(),
      typing: async (chatId) => {
        // The loading animation, in a chat with one person only.
        if (!/^U[0-9a-f]{32}$/.test(chatId)) return;
        await this.call('POST', '/v2/bot/chat/loading/start', { chatId, loadingSeconds: 20 });
      },
      download: (file) => this.#download(file),
      directChat: (userId) => Promise.resolve(userId),
      close: () => {
        stop.abort();
        unmount?.();
        offDoor?.();
      },
    };
  }

  async #event(
    event: LineEvent,
    events: ChannelEvents,
    replies: Map<string, { token: string; at: number }>,
  ) {
    const source = event.source;
    const userId = source?.userId;
    if (!source || !userId) return;
    const direct = source.type === 'user';
    const chatId = direct ? userId : (source.groupId ?? source.roomId ?? '');
    if (!chatId) return;
    if (event.replyToken) replies.set(chatId, { token: event.replyToken, at: Date.now() });
    const user = await this.#person(userId, source);
    if (event.type === 'postback' && event.postback) {
      events.press({
        chatId,
        user,
        data: event.postback.data,
        message: { chatId, messageId: event.webhookEventId ?? '' },
        ack: () => Promise.resolve(),
      });
      return;
    }
    if (event.type !== 'message' || !event.message) return;
    const message = event.message;
    const files: ChannelFile[] =
      message.type === 'image' ||
      message.type === 'file' ||
      message.type === 'audio' ||
      message.type === 'video'
        ? [
            {
              name:
                message.fileName ??
                `${message.type}-${message.id}.${{ image: 'jpg', audio: 'm4a', video: 'mp4' }[message.type as 'image'] ?? 'bin'}`,
              ref: message.id,
              ...(message.fileSize !== undefined && { size: message.fileSize }),
            },
          ]
        : [];
    let text = message.text ?? '';
    if (direct) {
      events.message({ chatId, messageId: message.id, user, text, files, direct: true });
      return;
    }
    const mine = (message.mention?.mentionees ?? []).filter((m) => m.isSelf);
    // "@Conch what's on?" reads as "what's on?": its mentions are cut out, last first.
    for (const m of [...mine].sort((a, b) => b.index - a.index))
      text = text.slice(0, m.index) + text.slice(m.index + m.length);
    events.message({
      chatId,
      messageId: message.id,
      user,
      text: mine.length
        ? text
            .replace(/^[\s,:]+/, '')
            .replace(/ {2,}/g, ' ')
            .trim()
        : text,
      files,
      direct: false,
      mentioned: mine.length > 0,
      group: await this.#place(source),
    });
  }

  /** What someone sent: only from LINE's own content host, with the channel's token. */
  async #download(file: ChannelFile) {
    if (!/^\d{1,30}$/.test(file.ref))
      throw new ChannelError('refused', 'That file isn’t on LINE, so Conch didn’t fetch it.');
    if (file.size && file.size > FILE_LIMIT)
      throw new ChannelError('refused', 'Files from LINE can be 20 MB at most here.');
    let response: Response;
    try {
      response = await fetch(`${this.#data}/v2/bot/message/${file.ref}/content`, {
        headers: { authorization: `Bearer ${this.secrets.accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new ChannelError(
        'network',
        redact(
          `Couldn’t download that from LINE (${(error as Error).message}).`,
          this.secrets.accessToken,
        ),
      );
    }
    if (!response.ok)
      throw new ChannelError('network', `LINE didn’t hand over that file (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > FILE_LIMIT)
      throw new ChannelError('refused', 'Files from LINE can be 20 MB at most here.');
    const type = response.headers.get('content-type') ?? undefined;
    return { name: file.name, bytes, ...(type && { mimeType: type }) };
  }
}
