/**
 * Feishu (飞书) and Lark (ADR 0120): one custom app with the Bot ability, on
 * either cloud. Conch opens the app's **long connection** from this
 * computer (`POST /callback/ws/endpoint`, then a WebSocket of protobuf
 * frames, `feishu-frame.ts`), so nothing needs a public address, an IP
 * allowlist or a verified domain. Messages and the presses of a card's
 * buttons both arrive on it.
 *
 * - **Who it is**: the App ID and App Secret, checked at once for a tenant
 *   access token, then `GET /open-apis/bot/v3/info` (the bot's name, its
 *   picture and its own `open_id`, which tells a mention of it apart).
 * - **Answers** go as rich text (`post` with one `md` element), so Markdown
 *   reads as Markdown; a question with buttons goes as a card (JSON 2.0),
 *   and when it's answered the card is changed in place to say so.
 * - **Groups** (ADR 0075): Feishu only delivers a group's messages that
 *   @mention the bot (unless the app asks for all of them, which Conch
 *   doesn't); a reply to one of its messages counts as a mention too.
 * - **Files both ways**: pictures (10 MB) and files (30 MB) out; pictures,
 *   files, voice messages (Opus) and videos in, fetched only from the
 *   message's own resources with the app's token.
 * - **Healing**: the tenant token is refreshed before it expires (and once
 *   more when Feishu says it's stale), pings at the interval Feishu asks
 *   for, a silent socket replaced, drops retried with backoff, rate limits
 *   waited out, and a refused App Secret stops this channel only.
 *
 * Only Feishu's (or Lark's) own API is ever called, with the person's own
 * app's keys.
 */
import { randomBytes } from 'node:crypto';

import type { ChannelBot, ChannelSecrets } from '@conch/protocol';
import { FEISHU_APP_ID } from '@conch/protocol';

import type { ChannelEndpoints } from './adapters';
import { CONTROL, type FeishuFrame, decodeFrame, encodeFrame, header } from './feishu-frame';
import { fit, plain, toDiscordMarkdown } from './format';
import { Recent } from './linked';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelMessage,
  type ChannelUser,
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

type FeishuSecrets = Extract<ChannelSecrets, { kind: 'feishu' }>;

/** Feishu in mainland China, and Lark everywhere else: the same API on two hosts. */
export const FEISHU_API = { feishu: 'https://open.feishu.cn', lark: 'https://open.larksuite.com' };
/** Where a chat with the bot opens (Feishu's AppLink). */
const APPLINK = {
  feishu: 'https://applink.feishu.cn/client/bot/open',
  lark: 'https://applink.larksuite.com/client/bot/open',
};

/** A rich-text or card message's request is at most 30 KB; keep well under. */
const PART_BYTES = 24_000;
/** The most a person reads comfortably in one bubble. */
const PART_CHARS = 6_000;
const IMAGE_LIMIT = 10 * 1024 * 1024;
const FILE_LIMIT = 30 * 1024 * 1024;
/** Files Conch takes from a chat (Feishu allows bigger; Conch keeps to what it can hold). */
const DOWNLOAD_LIMIT = 50 * 1024 * 1024;
/** How long Feishu waits for a card's callback to be answered (3 s); answer a little sooner. */
const CARD_REPLY_MS = 2_500;
const DEFAULT_PING_MS = 120_000;

/** What was pasted, tidied: the App ID found in whatever came with it. */
export function normalizeFeishu(secrets: FeishuSecrets): FeishuSecrets {
  return {
    kind: 'feishu',
    region: secrets.region === 'lark' ? 'lark' : 'feishu',
    appId: FEISHU_APP_ID.exec(secrets.appId)?.[1] ?? secrets.appId.trim(),
    appSecret: /\b([A-Za-z0-9]{32})\b/.exec(secrets.appSecret)?.[1] ?? secrets.appSecret.trim(),
  };
}

interface Reply<T> {
  code?: number;
  msg?: string;
  data?: T;
}

interface BotInfo {
  app_name?: string;
  avatar_url?: string;
  open_id?: string;
  activate_status?: number;
}

interface FeishuMessage {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  chat_id: string;
  chat_type?: string;
  message_type: string;
  content: string;
  mentions?: { key: string; id?: { open_id?: string }; name?: string }[];
}

interface FeishuEvent {
  schema?: string;
  header?: { event_id?: string; event_type?: string; app_id?: string; create_time?: string };
  event?: Record<string, unknown>;
  /** The old card callback (a `card` frame): the press itself, at the top. */
  open_id?: string;
  open_message_id?: string;
  open_chat_id?: string;
  action?: { value?: unknown };
}

/** Feishu's own words for its errors, as what to change. */
function failure(code: number, said: string, path: string): ChannelError {
  // 10003: not an App ID; 10014: no such app; 10015: the wrong App Secret;
  // 1000040345: the long connection's own check of both.
  if (code === 10003 || code === 10014)
    return new ChannelError(
      'auth',
      'Feishu doesn’t know that App ID. Copy it again from the app’s Credentials & Basic Info page (凭证与基础信息).',
      { field: 'appId' },
    );
  if (code === 10015 || code === 1000040345 || code === 10012)
    return new ChannelError(
      'auth',
      'Feishu doesn’t accept this App ID and App Secret. Copy both again from the app’s Credentials & Basic Info page (凭证与基础信息).',
      { field: 'appSecret' },
    );
  if (code === 99991400 || code === 230020 || code === 1000040350)
    return new ChannelError(
      'rate-limit',
      code === 1000040350
        ? 'This app has too many connections open (another program uses it too). Conch tries again in a minute.'
        : 'Feishu asked Conch to slow down.',
      { retryAfterMs: code === 1000040350 ? 60_000 : 2_000 },
    );
  if (code === 1 || code === 1000040343)
    return new ChannelError('network', 'Feishu is busy. Conch tries again by itself.');
  if (code === 99991401)
    return new ChannelError(
      'setup',
      'The app only takes calls from listed addresses. In the developer console, open Security Settings (安全设置) and clear the IP allowlist, or add this computer’s address.',
    );
  if (code === 99991672 || code === 99991679)
    return new ChannelError(
      'setup',
      `The app is missing a permission (${said || code}). In the developer console, open Permissions & Scopes (权限管理), add the ones Conch’s page lists, and publish a new version.`,
    );
  if (code === 230006)
    return new ChannelError(
      'setup',
      'The app’s bot isn’t on. In the developer console, open Features → Bot (机器人), add it, and publish a new version.',
    );
  if (code === 230013)
    return new ChannelError(
      'refused',
      'That person can’t use the app yet. In the developer console, add them to the version’s availability (可用范围) and publish it again.',
    );
  if (code === 230002) return new ChannelError('refused', 'The bot isn’t in that group any more.');
  if (code === 200340)
    return new ChannelError(
      'setup',
      'Buttons need the card callback. In Events & Callbacks → Callback configuration, choose the persistent connection, add card.action.trigger, and publish a new version.',
    );
  if (code === 230001 || code === 230099)
    return new ChannelError(
      'refused',
      `Feishu didn’t take that message (${code}${said ? ` ${said}` : ''}).`,
    );
  return new ChannelError(
    'refused',
    `Feishu said no (${code}${said ? ` ${said}` : ''}) to ${path.replace(/\/[a-z]{2}_[\w-]+/g, '/…').replace(/\?.*$/, '')}.`,
  );
}

/** Downloads of a profile picture come only from Feishu's own servers. */
function feishuHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      /(^|\.)(feishu\.cn|feishucdn\.com|larksuite\.com|larksuitecdn\.com|larkoffice\.com|bytedance\.com|byteimg\.com|pstatp\.com)$/.test(
        parsed.hostname,
      )
    );
  } catch {
    return false;
  }
}

/** A file in a message, as Conch remembers where it is. */
interface FileRef {
  m: string;
  k: string;
  t: 'image' | 'file';
}

/** Feishu or Lark, through a custom app's bot and its long connection. */
export class FeishuAdapter implements ChannelAdapter {
  readonly kind = 'feishu' as const;
  /** Mentions in groups are told apart (ADR 0075). */
  readonly groups = true;
  #token?: { value: string; expiresAt: number };
  #bot?: BotInfo;
  #people = new Map<string, ChannelUser>();
  #places = new Map<string, string>();

  constructor(
    private readonly secrets: FeishuSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get #api(): string {
    return this.endpoints.feishu ?? FEISHU_API[this.secrets.region];
  }

  /** The API's base, for a download made outside `call` (it streams). */
  get apiBase(): string {
    return this.#api;
  }

  get #brand() {
    return this.secrets.region === 'lark' ? 'Lark' : 'Feishu';
  }

  #say(words: string) {
    return this.secrets.region === 'lark' ? words.replaceAll('Feishu', 'Lark') : words;
  }

  async tenantToken(signal?: AbortSignal): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now() + 5 * 60_000) return this.#token.value;
    if (!FEISHU_APP_ID.test(this.secrets.appId))
      throw new ChannelError(
        'auth',
        this.#say(
          'That doesn’t look like an App ID. It starts with cli_ and is on the app’s Credentials & Basic Info page.',
        ),
        { field: 'appId' },
      );
    const body = await this.#fetch<{ tenant_access_token?: string; expire?: number }>(
      'POST',
      '/open-apis/auth/v3/tenant_access_token/internal',
      { app_id: this.secrets.appId, app_secret: this.secrets.appSecret },
      { signal, noToken: true },
    );
    if (!body.tenant_access_token)
      throw new ChannelError('network', this.#say('Feishu didn’t hand over a token.'));
    this.#token = {
      value: body.tenant_access_token,
      expiresAt: Date.now() + (body.expire ?? 7200) * 1000,
    };
    return body.tenant_access_token;
  }

  /** One call to the API; the reply's own top level (some calls answer outside `data`). */
  async #fetch<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { signal?: AbortSignal; noToken?: boolean; retried?: boolean; timeout?: number } = {},
  ): Promise<T & Reply<unknown>> {
    const form = body instanceof FormData ? body : undefined;
    const token = options.noToken ? undefined : await this.tenantToken(options.signal);
    let response: Response;
    try {
      response = await fetch(`${this.#api}${path}`, {
        method,
        headers: {
          ...(token && { authorization: `Bearer ${token}` }),
          ...(body !== undefined && !form && { 'content-type': 'application/json; charset=utf-8' }),
        },
        ...(body !== undefined && { body: form ?? JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(options.timeout ?? (form ? 120_000 : 15_000)),
          ...(options.signal ? [options.signal] : []),
        ]),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(
          this.#say(`Couldn’t reach Feishu (${(error as Error).message}).`),
          this.secrets.appSecret,
          token,
        ),
      );
    }
    if (response.status === 429)
      throw new ChannelError('rate-limit', this.#say('Feishu asked Conch to slow down.'), {
        retryAfterMs: Math.min(
          (Number(response.headers.get('x-ogw-ratelimit-reset')) || 1) * 1000,
          60_000,
        ),
      });
    if (response.status >= 500)
      throw new ChannelError('network', this.#say(`Feishu had a problem (${response.status}).`));
    const data = (await response.json().catch(() => ({ code: -1 }))) as T & Reply<unknown>;
    const code = data.code ?? 0;
    if (code === 0) return data;
    const said = redact(data.msg ?? '', this.secrets.appSecret, token);
    // A token Feishu no longer takes: a fresh one, once.
    if (
      [99991661, 99991663, 99991668, 99991677].includes(code) &&
      !options.noToken &&
      !options.retried
    ) {
      this.#token = undefined;
      return this.#fetch(method, path, body, { ...options, retried: true });
    }
    const error = failure(code, said, path);
    throw new ChannelError(error.code, this.#say(error.message), error.detail);
  }

  /** A call whose answer is in `data`. */
  async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const reply = await this.#fetch<Reply<T>>(method, path, body, { signal });
    return (reply.data ?? {}) as T;
  }

  async #info(signal?: AbortSignal): Promise<BotInfo> {
    await this.tenantToken(signal);
    const reply = await this.#fetch<{ bot?: BotInfo }>('GET', '/open-apis/bot/v3/info', undefined, {
      signal,
    });
    const bot = reply.bot;
    if (!bot?.open_id)
      throw new ChannelError(
        'setup',
        this.#say(
          'The app has no bot yet. In the developer console, open Features → Bot (机器人), add it, and publish a version.',
        ),
      );
    this.#bot = bot;
    return bot;
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    const bot = await this.#info(signal);
    const avatar = await this.#avatar(bot.avatar_url).catch(() => undefined);
    const link = new URL(APPLINK[this.secrets.region]);
    link.searchParams.set('appId', this.secrets.appId);
    return {
      id: this.secrets.appId,
      name: bot.app_name || `${this.#brand} bot`,
      account: this.secrets.region,
      chatUrl: link.toString(),
      ...(avatar && { avatar }),
    };
  }

  async #avatar(url?: string): Promise<string | undefined> {
    if (!url || !feishuHost(url)) return undefined;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return undefined;
    const bytes = await readCapped(response, 120_000);
    return dataUrl(bytes, response.headers.get('content-type') ?? 'image/png');
  }

  /** Someone's name, when the app may read the directory (contact:user.base:readonly). */
  async person(openId: string, known?: string): Promise<ChannelUser> {
    const cached = this.#people.get(openId);
    if (cached) return cached;
    let name = known;
    if (!name) {
      const found = await this.call<{ user?: { name?: string; en_name?: string } }>(
        'GET',
        `/open-apis/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
      ).catch(() => undefined);
      name = found?.user?.name || found?.user?.en_name;
    }
    const user: ChannelUser = name
      ? { id: personId(openId), name }
      : { id: personId(openId), name: `${this.#brand} user ·${openId.slice(-4)}`, anonymous: true };
    if (name) this.#people.set(openId, user);
    return user;
  }

  async place(chatId: string): Promise<string> {
    const known = this.#places.get(chatId);
    if (known) return known;
    const chat = await this.call<{ name?: string }>(
      'GET',
      `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`,
    ).catch(() => undefined);
    const name = chat?.name ? chat.name : `A ${this.#brand} group`;
    if (chat?.name) this.#places.set(chatId, name);
    return name;
  }

  /** The long connection's address, and how often Feishu wants a ping. */
  async endpoint(signal?: AbortSignal): Promise<{ url: string; pingMs: number; nonce: number }> {
    const reply = await this.#fetch<
      Reply<{
        URL?: string;
        ClientConfig?: { PingInterval?: number; ReconnectNonce?: number };
      }>
    >(
      'POST',
      '/callback/ws/endpoint',
      { AppID: this.secrets.appId, AppSecret: this.secrets.appSecret },
      {
        signal,
        noToken: true,
      },
    );
    const url = reply.data?.URL;
    if (!url || !/^wss?:\/\//.test(url))
      throw new ChannelError(
        'network',
        this.#say('Feishu didn’t say where its long connection is.'),
      );
    return {
      url,
      pingMs: Math.max(10, reply.data?.ClientConfig?.PingInterval ?? DEFAULT_PING_MS / 1000) * 1000,
      nonce: Math.max(0, reply.data?.ClientConfig?.ReconnectNonce ?? 30) * 1000,
    };
  }

  get botOpenId() {
    return this.#bot?.open_id;
  }

  connect(events: ChannelEvents): ChannelConnection {
    const session = new FeishuSession(this, events, this.#brand, (w) => this.#say(w));
    void session.run();
    return {
      send: (chatId, markdown, options) => session.send(chatId, markdown, options),
      edit: (ref, markdown, options) => session.edit(ref, markdown, options),
      // Feishu has no typing indicator for bots: a reaction on the message says it's on it.
      typing: () => Promise.resolve(),
      seen: (ref, working) => session.seen(ref, working),
      download: (file, options) => session.download(file, options),
      directChat: (userId) => Promise.resolve(appId(userId)),
      buttonLimit: 8,
      files: {
        maxBytes: FILE_LIMIT,
        send: (chatId, files, caption) => session.sendFiles(chatId, files, caption),
      },
      close: () => session.close(),
    };
  }
}

/** Where to send: a person's open_id (a private chat) or a group's chat_id. */
const receiver = (chatId: string) =>
  chatId.startsWith('ou_') ? 'open_id' : chatId.startsWith('on_') ? 'union_id' : 'chat_id';

/** A Feishu `md` element doesn't take raw HTML; everything else is Markdown it reads. */
const larkMarkdown = (markdown: string) => toDiscordMarkdown(markdown);

/** The JSON 2.0 card a question goes in: its words, then its buttons. */
function card(markdown: string, buttons: SendOptions['buttons'] = []) {
  return {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'fill' },
    body: {
      elements: [
        { tag: 'markdown', content: larkMarkdown(markdown) || '…' },
        ...(buttons.length
          ? [
              {
                tag: 'column_set',
                flex_mode: 'flow',
                horizontal_spacing: '8px',
                columns: buttons.map((b) => ({
                  tag: 'column',
                  width: 'auto',
                  elements: [
                    {
                      tag: 'button',
                      text: { tag: 'plain_text', content: b.label.slice(0, 40) },
                      type:
                        b.style === 'primary'
                          ? 'primary_filled'
                          : b.style === 'danger'
                            ? 'danger'
                            : 'default',
                      behaviors: [{ type: 'callback', value: { conch: b.data } }],
                    },
                  ],
                })),
              },
            ]
          : []),
      ],
    },
  };
}

class FeishuSession {
  #stop = new AbortController();
  #socket?: WebSocket;
  #seen = new Recent(2000);
  /** Long payloads arrive in parts (`sum`, `seq`), by `message_id`. */
  #parts = new Map<string, { at: number; parts: (Uint8Array | undefined)[] }>();
  /** What each message Conch sent is (a card can be changed as a card), and where it went. */
  #sent = new Map<string, { card: boolean; chatId: string }>();
  /** A reaction Conch put on a message while it works, to take off again. */
  #reactions = new Map<string, string>();

  constructor(
    private readonly adapter: FeishuAdapter,
    private readonly events: ChannelEvents,
    private readonly brand: string,
    private readonly say: (words: string) => string,
  ) {}

  close() {
    this.#stop.abort();
    this.#socket?.close(1000);
  }

  async run() {
    const signal = this.#stop.signal;
    const backoff = new Backoff();
    this.events.state('connecting');
    while (!signal.aborted) {
      try {
        await this.adapter.tenantToken(signal);
        if (!this.adapter.botOpenId) await this.adapter.identify(signal);
        const where = await this.adapter.endpoint(signal);
        const ended = await this.#session(where, signal, () => backoff.reset());
        if (signal.aborted) return;
        const wait = ended === 'told' ? Math.random() * where.nonce : backoff.next();
        this.events.state('reconnecting', {
          message: this.say('Reconnecting to Feishu.'),
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

  /** One WebSocket, until it drops: `told` when Feishu itself closed it (a reconnect is expected). */
  #session(
    where: { url: string; pingMs: number },
    signal: AbortSignal,
    onReady: () => void,
  ): Promise<'dropped' | 'told'> {
    const service = Number(new URL(where.url).searchParams.get('service_id') ?? 0) || 0;
    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(where.url);
      } catch {
        resolve('dropped');
        return;
      }
      socket.binaryType = 'arraybuffer';
      this.#socket = socket;
      let settled = false;
      let pingMs = where.pingMs;
      let heard = Date.now();
      let beat: NodeJS.Timeout | undefined;
      const ping = () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(
          encodeFrame({
            seqId: 0n,
            logId: 0n,
            service,
            method: CONTROL,
            headers: [['type', 'ping']],
          }),
        );
      };
      const watch = () => {
        clearInterval(beat);
        beat = setInterval(() => {
          // Nothing at all for two and a half pings: this socket is gone, whatever it looks like.
          if (Date.now() - heard > pingMs * 2.5) return finish('dropped');
          ping();
        }, pingMs);
        beat.unref?.();
      };
      const finish = (why: 'dropped' | 'told') => {
        if (settled) return;
        settled = true;
        clearInterval(beat);
        signal.removeEventListener('abort', abort);
        socket.close(1000);
        resolve(why);
      };
      const abort = () => finish('dropped');
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', () => {
        onReady();
        this.events.state('online');
        ping();
        watch();
      });
      socket.addEventListener('message', (message) => {
        heard = Date.now();
        const raw =
          message.data instanceof ArrayBuffer
            ? new Uint8Array(message.data)
            : typeof message.data === 'string'
              ? undefined
              : new Uint8Array(message.data as ArrayBufferLike);
        const frame = raw && decodeFrame(raw);
        if (!frame) return;
        if (frame.method === CONTROL) {
          if (header(frame, 'type') !== 'pong' || !frame.payload) return;
          // A pong carries the settings Feishu wants now (a new ping interval).
          try {
            const config = JSON.parse(new TextDecoder().decode(frame.payload)) as {
              PingInterval?: number;
            };
            if (config.PingInterval && config.PingInterval * 1000 !== pingMs) {
              pingMs = Math.max(10_000, config.PingInterval * 1000);
              watch();
            }
          } catch {
            // Not settings: nothing to change.
          }
          return;
        }
        void this.#data(frame, socket);
      });
      socket.addEventListener('close', (event) => finish(event.code === 1000 ? 'told' : 'dropped'));
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) finish('dropped');
      });
    });
  }

  /** A data frame: put its parts together, answer Feishu, then hand it on. */
  async #data(frame: FeishuFrame, socket: WebSocket) {
    const type = header(frame, 'type');
    const id = header(frame, 'message_id') ?? '';
    const sum = Number(header(frame, 'sum') ?? 1) || 1;
    const seq = Number(header(frame, 'seq') ?? 0) || 0;
    let payload = frame.payload ?? new Uint8Array();
    if (sum > 1) {
      if (sum > 64 || seq >= sum) return;
      const now = Date.now();
      for (const [key, held] of this.#parts) if (now - held.at > 30_000) this.#parts.delete(key);
      const held = this.#parts.get(id) ?? { at: now, parts: Array.from({ length: sum }) };
      held.parts[seq] = payload;
      this.#parts.set(id, held);
      if (held.parts.some((p) => !p)) return;
      this.#parts.delete(id);
      payload = Buffer.concat(held.parts as Uint8Array[]);
    }
    const started = Date.now();
    let answer: unknown;
    try {
      const event = JSON.parse(new TextDecoder().decode(payload)) as FeishuEvent;
      answer = await this.#handle(type ?? '', event);
    } catch {
      answer = undefined;
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    const body = JSON.stringify({
      code: 200,
      headers: {},
      ...(answer !== undefined && {
        data: Buffer.from(JSON.stringify(answer)).toString('base64'),
      }),
    });
    socket.send(
      encodeFrame({
        ...frame,
        headers: [...frame.headers, ['biz_rt', String(Date.now() - started)]],
        payload: new TextEncoder().encode(body),
      }),
    );
  }

  /** What Feishu delivered; for a card's press, the answer it shows (a toast). */
  async #handle(type: string, event: FeishuEvent): Promise<unknown> {
    const eventId = event.header?.event_id;
    if (eventId && !this.#seen.add(`e:${eventId}`)) return undefined;
    if (type === 'card' || event.header?.event_type === 'card.action.trigger')
      return this.#press(event);
    const body = event.event ?? {};
    switch (event.header?.event_type) {
      case 'im.message.receive_v1':
        await this.#message(body);
        return undefined;
      case 'im.chat.access_event.bot_p2p_chat_entered_v1':
        await this.#entered(body);
        return undefined;
      default:
        return undefined;
    }
  }

  /**
   * Opening the chat with the bot for the first time is a hello: the owner
   * doesn't have to think of something to type. Only the first visit (Feishu
   * says when the last message was; none means never), once per person.
   */
  async #entered(body: Record<string, unknown>) {
    const openId = (body.operator_id as { open_id?: string } | undefined)?.open_id;
    if (!openId || !/^ou_[\w-]{4,64}$/.test(openId)) return;
    const last = String(body.last_message_create_time ?? '');
    if (last && last !== '0') return;
    if (!this.#seen.add(`hello:${openId}`)) return;
    this.events.message({
      chatId: openId,
      messageId: `hello-${openId}`,
      user: await this.adapter.person(openId),
      text: 'hello',
      files: [],
      direct: true,
    });
  }

  async #message(body: Record<string, unknown>) {
    const sender = body.sender as
      { sender_id?: { open_id?: string }; sender_type?: string } | undefined;
    const message = body.message as FeishuMessage | undefined;
    const openId = sender?.sender_id?.open_id;
    // Its own messages and other apps' are never read.
    if (!message?.message_id || !openId || sender.sender_type !== 'user') return;
    if (!this.#seen.add(`m:${message.message_id}`)) return;
    const direct = message.chat_type === 'p2p';
    const me = this.adapter.botOpenId;
    const mentions = message.mentions ?? [];
    let mentioned = !direct && mentions.some((m) => m.id?.open_id === me);
    const { text, files } = this.#content(message, mentions, me);
    let quote: ChannelMessage['quote'];
    if (message.parent_id) {
      const parent = await this.#parent(message.parent_id);
      if (parent?.mine) mentioned = !direct || mentioned;
      else if (parent && !direct) quote = { name: parent.name, text: parent.text };
    }
    // A message with nothing Conch can read (a sticker, a vote) still reaches a stranger's request.
    if (!text && !files.length) return;
    const user = await this.adapter.person(openId);
    this.events.message({
      chatId: direct ? openId : message.chat_id,
      messageId: message.message_id,
      user,
      text,
      files,
      direct,
      ...(!direct && {
        mentioned,
        group: await this.adapter.place(message.chat_id),
        ...(quote && { quote }),
      }),
    });
  }

  /** The words and the files in a message, with mentions as names and the bot's taken out. */
  #content(
    message: FeishuMessage,
    mentions: NonNullable<FeishuMessage['mentions']>,
    me: string | undefined,
  ): { text: string; files: ChannelFile[] } {
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(message.content || '{}') as Record<string, unknown>;
    } catch {
      content = {};
    }
    const files: ChannelFile[] = [];
    const file = (
      t: FileRef['t'],
      key: unknown,
      name: string,
      extra: Partial<ChannelFile> = {},
    ) => {
      if (typeof key !== 'string' || !/^[\w-]{4,200}$/.test(key)) return;
      files.push({ name, ref: JSON.stringify({ m: message.message_id, k: key, t }), ...extra });
    };
    const named = (raw: string) => {
      let out = raw;
      for (const m of mentions)
        out = out.replaceAll(m.key, m.id?.open_id === me ? '' : `@${m.name ?? 'someone'}`);
      return out.replace(/[ \t]{2,}/g, ' ').trim();
    };
    let text = '';
    switch (message.message_type) {
      case 'text':
        text = named(String(content.text ?? ''));
        break;
      case 'post': {
        const post = (content.content ? content : (Object.values(content)[0] ?? {})) as {
          title?: string;
          content?: {
            tag?: string;
            text?: string;
            href?: string;
            image_key?: string;
            user_id?: string;
          }[][];
        };
        const lines = (post.content ?? []).map((line) =>
          line
            .map((item) => {
              if (item.tag === 'text') return item.text ?? '';
              if (item.tag === 'a')
                return item.href ? `[${item.text ?? item.href}](${item.href})` : (item.text ?? '');
              if (item.tag === 'at')
                return item.user_id && mentions.some((m) => m.key === item.user_id)
                  ? item.user_id
                  : '';
              if (item.tag === 'img') {
                file('image', item.image_key, `picture-${files.length + 1}.png`, {
                  mimeType: 'image/png',
                });
                return '';
              }
              if (item.tag === 'code_block' || item.tag === 'md') return item.text ?? '';
              return '';
            })
            .join(''),
        );
        text = named([post.title, ...lines].filter(Boolean).join('\n'));
        break;
      }
      case 'image':
        file('image', content.image_key, 'picture.png', { mimeType: 'image/png' });
        break;
      case 'file':
        file('file', content.file_key, String(content.file_name ?? 'file'));
        break;
      case 'audio':
        // A voice message: Opus, which Conch turns into words on this computer (ADR 0077).
        file('file', content.file_key, 'voice.opus', { mimeType: 'audio/ogg', voice: true });
        break;
      case 'media':
        file('file', content.file_key, String(content.file_name ?? 'video.mp4'), {
          mimeType: 'video/mp4',
        });
        break;
      case 'location':
        text = `📍 ${String(content.name ?? '')} (${String(content.latitude ?? '')}, ${String(content.longitude ?? '')})`;
        break;
      default:
        break;
    }
    return { text, files };
  }

  /** The message this one replies to: the bot's own, or someone else's words. */
  async #parent(id: string): Promise<{ mine: boolean; name: string; text: string } | undefined> {
    if (this.#sent.has(id)) return { mine: true, name: '', text: '' };
    const found = await this.adapter
      .call<{
        items?: {
          sender?: { id?: string; sender_type?: string };
          msg_type?: string;
          body?: { content?: string };
          mentions?: FeishuMessage['mentions'];
        }[];
      }>('GET', `/open-apis/im/v1/messages/${encodeURIComponent(id)}`)
      .catch(() => undefined);
    const item = found?.items?.[0];
    if (!item) return undefined;
    if (item.sender?.sender_type === 'app') return { mine: true, name: '', text: '' };
    const { text } = this.#content(
      {
        message_id: id,
        chat_id: '',
        message_type: item.msg_type ?? 'text',
        content: item.body?.content ?? '{}',
      },
      item.mentions ?? [],
      this.adapter.botOpenId,
    );
    const who = item.sender?.id ? await this.adapter.person(item.sender.id) : undefined;
    return { mine: false, name: who?.name ?? 'Someone', text: text.slice(0, 2000) };
  }

  /** A press on one of Conch's cards: answered within Feishu's three seconds, with a toast. */
  #press(event: FeishuEvent): Promise<unknown> {
    const body = (event.event ?? event) as {
      operator?: { open_id?: string };
      action?: { value?: unknown };
      context?: { open_message_id?: string; open_chat_id?: string };
      open_id?: string;
      open_message_id?: string;
      open_chat_id?: string;
    };
    const openId = body.operator?.open_id ?? body.open_id;
    const messageId = body.context?.open_message_id ?? body.open_message_id ?? '';
    const value = body.action?.value as { conch?: unknown } | string | undefined;
    const data =
      typeof value === 'string'
        ? (() => {
            try {
              return (JSON.parse(value) as { conch?: unknown }).conch;
            } catch {
              return undefined;
            }
          })()
        : value?.conch;
    if (!openId || typeof data !== 'string' || !messageId) return Promise.resolve(undefined);
    // Where Conch sent it: a private chat is the person, a group is its chat_id.
    const chatId = this.#sent.get(messageId)?.chatId ?? body.context?.open_chat_id ?? openId;
    return new Promise((resolve) => {
      let done = false;
      const answer = (note?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(note ? { toast: { type: 'info', content: note } } : {});
      };
      const timer = setTimeout(() => answer(), CARD_REPLY_MS);
      void this.adapter.person(openId).then((user) =>
        this.events.press({
          chatId,
          user,
          data,
          message: { chatId, messageId },
          ack: async (note) => answer(note),
        }),
      );
    });
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

  async #post(chatId: string, msgType: string, content: unknown): Promise<string> {
    const sent = await this.#withRetry(() =>
      this.adapter.call<{ message_id?: string }>(
        'POST',
        `/open-apis/im/v1/messages?receive_id_type=${receiver(chatId)}`,
        {
          receive_id: chatId,
          msg_type: msgType,
          content: JSON.stringify(content),
          uuid: randomBytes(12).toString('hex'),
        },
      ),
    );
    return sent.message_id ?? '';
  }

  async send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const buttons = options?.buttons ?? [];
    const parts = fit(markdown, PART_CHARS, (p) =>
      Math.max(p.length, Buffer.byteLength(larkMarkdown(p)) / (PART_BYTES / PART_CHARS)),
    );
    if (!parts.length) parts.push('…');
    const refs: SentRef[] = [];
    for (const [i, part] of parts.entries()) {
      const last = i === parts.length - 1;
      // The last part carries the buttons, in a card that can change when it's answered.
      const asCard = last && buttons.length > 0;
      const id = asCard
        ? await this.#post(chatId, 'interactive', card(part, buttons))
        : await this.#post(chatId, 'post', {
            zh_cn: { content: [[{ tag: 'md', text: larkMarkdown(part) || plain(part) }]] },
          });
      this.#remember(id, { card: asCard, chatId });
      refs.push({ chatId, messageId: id });
    }
    return refs;
  }

  #remember(id: string, what: { card: boolean; chatId: string }) {
    if (!id) return;
    this.#sent.set(id, what);
    if (this.#sent.size > 2000) this.#sent.delete(this.#sent.keys().next().value ?? '');
  }

  async edit(ref: SentRef, markdown: string, options?: SendOptions): Promise<void> {
    const kind = this.#sent.get(ref.messageId);
    if (kind?.card === false && !options?.buttons?.length) {
      await this.adapter.call(
        'PUT',
        `/open-apis/im/v1/messages/${encodeURIComponent(ref.messageId)}`,
        {
          msg_type: 'post',
          content: JSON.stringify({
            zh_cn: { content: [[{ tag: 'md', text: larkMarkdown(markdown) }]] },
          }),
        },
      );
      return;
    }
    // A card (or one Conch no longer remembers, after a restart): changed in place, its buttons gone.
    await this.adapter.call(
      'PATCH',
      `/open-apis/im/v1/messages/${encodeURIComponent(ref.messageId)}`,
      {
        content: JSON.stringify(card(markdown, options?.buttons ?? [])),
      },
    );
    this.#remember(ref.messageId, { card: true, chatId: ref.chatId });
  }

  async seen(ref: SentRef, working: boolean) {
    if (!/^om_[\w-]+$/.test(ref.messageId)) return;
    const path = `/open-apis/im/v1/messages/${encodeURIComponent(ref.messageId)}/reactions`;
    if (working) {
      const added = await this.adapter.call<{ reaction_id?: string }>('POST', path, {
        reaction_type: { emoji_type: 'Typing' },
      });
      if (added.reaction_id) this.#reactions.set(ref.messageId, added.reaction_id);
      return;
    }
    const reaction = this.#reactions.get(ref.messageId);
    if (!reaction) return;
    this.#reactions.delete(ref.messageId);
    await this.adapter.call('DELETE', `${path}/${encodeURIComponent(reaction)}`);
  }

  /** Pictures as pictures, anything else as a file; the caption first, in words. */
  async sendFiles(chatId: string, files: OutboundFile[], caption?: string): Promise<SentRef[]> {
    const refs: SentRef[] = caption?.trim() ? await this.send(chatId, caption) : [];
    for (const file of files) {
      const picture = file.image && file.bytes.length <= IMAGE_LIMIT && !/svg/.test(file.mimeType);
      if (!picture && file.bytes.length > FILE_LIMIT)
        throw new ChannelError(
          'refused',
          this.say(`${file.name} is bigger than Feishu takes from an app (30 MB).`),
        );
      const form = new FormData();
      const blob = new Blob([new Uint8Array(file.bytes)], { type: file.mimeType });
      let id: string;
      if (picture) {
        form.set('image_type', 'message');
        form.set('image', blob, file.name);
        const up = await this.#withRetry(() =>
          this.adapter.call<{ image_key?: string }>('POST', '/open-apis/im/v1/images', form),
        );
        if (!up.image_key)
          throw new ChannelError('refused', this.say('Feishu didn’t take that picture.'));
        id = await this.#post(chatId, 'image', { image_key: up.image_key });
      } else {
        form.set('file_type', fileType(file));
        form.set('file_name', file.name);
        form.set('file', blob, file.name);
        const up = await this.#withRetry(() =>
          this.adapter.call<{ file_key?: string }>('POST', '/open-apis/im/v1/files', form),
        );
        if (!up.file_key)
          throw new ChannelError('refused', this.say('Feishu didn’t take that file.'));
        id = await this.#post(chatId, 'file', { file_key: up.file_key });
      }
      this.#remember(id, { card: false, chatId });
      refs.push({ chatId, messageId: id });
    }
    return refs;
  }

  /** A picture or file from a message: only from that message's own resources. */
  async download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(DOWNLOAD_LIMIT, options);
    let ref: FileRef;
    try {
      ref = JSON.parse(file.ref) as FileRef;
    } catch {
      throw new ChannelError('refused', 'That file’s address isn’t one Conch recognises.');
    }
    if (
      !/^om_[\w-]{4,200}$/.test(ref.m ?? '') ||
      !/^[\w-]{4,200}$/.test(ref.k ?? '') ||
      (ref.t !== 'image' && ref.t !== 'file')
    )
      throw new ChannelError('refused', this.say('That file isn’t one of Feishu’s.'));
    const token = await this.adapter.tenantToken();
    const url = `${this.adapter.apiBase}/open-apis/im/v1/messages/${encodeURIComponent(ref.m)}/resources/${encodeURIComponent(ref.k)}?type=${ref.t}`;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    }).catch((error: unknown) => {
      throw new ChannelError(
        'network',
        redact(`Couldn’t download that file (${(error as Error).message}).`, token),
      );
    });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || /json/.test(type))
      throw new ChannelError(
        'refused',
        this.say(
          `Feishu didn’t hand over that file (${response.status}). The app needs the im:resource permission.`,
        ),
      );
    const bytes = await readCapped(
      response,
      cap,
      this.say('That file is too big to take from Feishu.'),
    );
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(
      response.headers.get('content-disposition') ?? '',
    )?.[1];
    const mimeType = file.mimeType ?? (type.split(';')[0] || undefined);
    return {
      name: named && !file.voice ? decodeURIComponent(named) : file.name,
      bytes,
      ...(mimeType && { mimeType }),
    };
  }
}

/** Feishu's own names for a file's kind; anything else is a `stream`. */
function fileType(file: OutboundFile): string {
  const name = file.name.toLowerCase();
  if (/\.pdf$/.test(name)) return 'pdf';
  if (/\.docx?$/.test(name)) return 'doc';
  if (/\.xlsx?$/.test(name)) return 'xls';
  if (/\.pptx?$/.test(name)) return 'ppt';
  if (/\.mp4$/.test(name)) return 'mp4';
  if (/\.opus$/.test(name)) return 'opus';
  return 'stream';
}
