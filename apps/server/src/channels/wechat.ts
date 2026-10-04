import { createDecipheriv, randomBytes } from 'node:crypto';

import { type ChannelBot, type ChannelSecrets, WECHAT_APP_ID } from '@conch/protocol';

import type { ChannelEndpoints } from './adapters';
import type { HookReply, HookRequest } from './door';
import { fit, plain, toDiscordMarkdown } from './format';
import { Recent, TextChoices } from './linked';
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
  appId,
  pause,
  personId,
  redact,
  capOf,
  readCapped,
} from './types';
import {
  WeChatCryptoError,
  buildXml,
  decrypt,
  encrypt,
  newAesKey,
  newToken,
  parseXml,
  signature,
  signed,
} from './wechat-crypto';

type WeChatSecrets = Extract<ChannelSecrets, { kind: 'wechat' }>;

export const WECHAT_API = 'https://api.weixin.qq.com';
export const WECOM_BOT_SOCKET = 'wss://openws.work.weixin.qq.com';
const FILE_LIMIT = 20 * 1024 * 1024;

/**
 * What was pasted, tidied. An Official Account's Token and EncodingAESKey
 * are made here the first time (and kept across a new AppSecret: they're
 * already pasted in WeChat), as is the channel's web address.
 */
export function normalizeWeChat(secrets: WeChatSecrets, kept?: WeChatSecrets): WeChatSecrets {
  if (secrets.mode === 'wecom')
    return {
      kind: 'wechat',
      mode: 'wecom',
      appId: secrets.appId.trim(),
      secret: secrets.secret.trim(),
    };
  const same = kept?.mode === 'official' ? kept : undefined;
  return {
    kind: 'wechat',
    mode: 'official',
    appId: WECHAT_APP_ID.exec(secrets.appId)?.[1] ?? secrets.appId.trim(),
    secret: /\b([0-9a-f]{32})\b/.exec(secrets.secret)?.[1] ?? secrets.secret.trim(),
    token: same?.token ?? newToken(),
    aesKey: same?.aesKey ?? newAesKey(),
    hookId: same?.hookId ?? randomBytes(18).toString('base64url'),
  };
}

/** Downloads come only from Tencent's own servers. */
function tencentHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      /(^|\.)(qq\.com|qpic\.cn|wechat\.com|weixin\.qq\.com|myqcloud\.com)$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** Remove WeChat's PKCS#7 padding to 32 bytes after AES-256-CBC (files from a WeCom bot). */
function decryptMedia(bytes: Buffer, aesKey: string): Buffer {
  const key = Buffer.from(aesKey, 'base64');
  if (key.length !== 32)
    throw new ChannelError('refused', 'That file’s key isn’t one Conch can read.');
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const plainBytes = Buffer.concat([decipher.update(bytes), decipher.final()]);
  const pad = plainBytes.at(-1) ?? 0;
  if (pad < 1 || pad > 32) throw new ChannelError('refused', 'That file couldn’t be decrypted.');
  return plainBytes.subarray(0, plainBytes.length - pad);
}

// ── WeCom AI bot (the default) ───────────────────────────────────────────

interface Frame {
  cmd?: string;
  headers?: { req_id?: string };
  body?: Record<string, unknown>;
  errcode?: number;
  errmsg?: string;
}

/**
 * When this process last checked each bot's keys: the check briefly takes
 * the bot's one connection, so the running one is told it was taken over.
 */
const probing = new Map<string, number>();
/** A takeover this soon after Conch's own check is that check. */
const PROBE_GRACE_MS = 5_000;

/**
 * WeChat through a WeCom (企业微信) AI bot, over its long connection
 * (`wss://openws.work.weixin.qq.com`): Conch dials out, so there's no
 * public address, no IP whitelist and no domain to register. You talk to it
 * in the WeCom app (free; you can sign in with WeChat).
 *
 * One connection per bot: a second one (another Conch, OpenClaw) takes over,
 * and WeCom tells the old one so. That's named, and retried every minute.
 *
 * Healing: heartbeats every 30 seconds, and two missed answers replace the
 * socket; drops retry with backoff; a refused Bot ID or Secret asks for new
 * ones; Conch's own key check (which briefly takes the connection) is told
 * apart from another program.
 */
export class WeComBotAdapter implements ChannelAdapter {
  readonly kind = 'wechat' as const;

  constructor(
    private readonly secrets: WeChatSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get #url() {
    return this.endpoints.wecom ?? WECOM_BOT_SOCKET;
  }

  #bot(): ChannelBot {
    return { id: this.secrets.appId, name: 'WeCom bot', account: 'wecom' };
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    if (!/^[\w-]{4,128}$/.test(this.secrets.appId))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a Bot ID. Copy it from the bot’s page in WeCom.',
        {
          field: 'appId',
        },
      );
    // The connection that's running already proves the keys.
    if (live.get(this.secrets.appId) === this.secrets.secret) return this.#bot();
    probing.set(this.secrets.appId, Date.now());
    try {
      await new Promise<void>((resolve, reject) => {
        let socket: WebSocket;
        try {
          socket = new WebSocket(this.#url);
        } catch {
          reject(new ChannelError('network', 'Couldn’t reach WeCom.'));
          return;
        }
        const done = (error?: Error) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          socket.close(1000);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => done(new ChannelError('network', 'Stopped.'));
        const timer = setTimeout(
          () => done(new ChannelError('network', 'WeCom didn’t answer in time.')),
          15_000,
        );
        signal?.addEventListener('abort', abort, { once: true });
        socket.addEventListener('open', () => socket.send(JSON.stringify(this.#subscribe())));
        socket.addEventListener('message', (event) => {
          const frame = parse(String(event.data));
          if (!frame?.headers?.req_id?.startsWith('aibot_subscribe')) return;
          done(frame.errcode ? refusedKeys(frame) : undefined);
        });
        socket.addEventListener('error', () =>
          done(new ChannelError('network', 'Couldn’t reach WeCom.')),
        );
        socket.addEventListener('close', () =>
          done(new ChannelError('network', 'WeCom closed the connection.')),
        );
      });
    } finally {
      probing.set(this.secrets.appId, Date.now());
    }
    return this.#bot();
  }

  #subscribe(): Frame {
    return {
      cmd: 'aibot_subscribe',
      headers: { req_id: `aibot_subscribe_${Date.now()}_${randomBytes(4).toString('hex')}` },
      body: { bot_id: this.secrets.appId, secret: this.secrets.secret },
    };
  }

  connect(events: ChannelEvents): ChannelConnection {
    const session = new WeComSession(
      this.secrets,
      this.#url,
      events,
      () => this.#subscribe(),
      this.endpoints.wechatFiles ?? [],
    );
    void session.run();
    return {
      send: (chatId, markdown, options) => session.send(chatId, markdown, options),
      // WeCom can't change a message a bot sent: what was decided goes as a new one.
      edit: async (ref, markdown) => {
        await session.send(ref.chatId, markdown);
      },
      typing: () => Promise.resolve(),
      download: (file, options) => session.download(file, options),
      directChat: (userId) => Promise.resolve(appId(userId)),
      close: () => session.close(),
    };
  }
}

/** Bots connected in this process, with the secret they connected with. */
const live = new Map<string, string>();

function parse(text: string): Frame | undefined {
  try {
    const frame = JSON.parse(text) as unknown;
    return frame && typeof frame === 'object' ? (frame as Frame) : undefined;
  } catch {
    return undefined;
  }
}

function refusedKeys(frame: Frame) {
  return new ChannelError(
    'auth',
    `WeCom doesn’t accept this Bot ID and Secret (${frame.errcode}). Copy both again from the bot’s page, under API mode → long connection.`,
    { field: 'secret' },
  );
}

class WeComSession {
  #stop = new AbortController();
  #socket?: WebSocket;
  #pending = new Map<
    string,
    { resolve: (frame: Frame) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  #seen = new Recent(2000);
  /** The last question asked in each chat, for answers typed as a number. */
  /** Questions answered by typing their number (or yes / no). */
  #choices = new TextChoices();

  constructor(
    private readonly secrets: WeChatSecrets,
    private readonly url: string,
    private readonly events: ChannelEvents,
    private readonly subscribe: () => Frame,
    private readonly files: string[],
  ) {}

  close() {
    this.#stop.abort();
    this.#socket?.close(1000);
    if (live.get(this.secrets.appId) === this.secrets.secret) live.delete(this.secrets.appId);
  }

  async run() {
    const signal = this.#stop.signal;
    const backoff = new Backoff();
    // From now on this bot's keys are checked by this connection, not by opening another.
    live.set(this.secrets.appId, this.secrets.secret);
    this.events.state('connecting');
    while (!signal.aborted) {
      const ended = await this.#session(signal, () => backoff.reset());
      if (signal.aborted) return;
      if (ended === 'auth') {
        if (live.get(this.secrets.appId) === this.secrets.secret) live.delete(this.secrets.appId);
        this.events.state('needs-token', {
          message: 'WeCom stopped accepting this bot’s Secret. Copy it again from the bot’s page.',
        });
        return;
      }
      if (ended === 'taken') {
        const probe = probing.get(this.secrets.appId) ?? 0;
        // Conch's own key check took the line for a moment: straight back.
        if (Date.now() - probe < PROBE_GRACE_MS) {
          await pause(500, signal);
          continue;
        }
        const retryAt = Date.now() + 60_000;
        this.events.state('conflict', {
          message:
            'Another program connected with this bot’s keys (another Conch, or an app like OpenClaw). Stop it, or make a new bot.',
          retryAt,
        });
        await pause(60_000, signal);
        continue;
      }
      const wait = backoff.next();
      this.events.state('reconnecting', {
        message: 'Reconnecting to WeCom.',
        retryAt: Date.now() + wait,
      });
      await pause(wait, signal);
    }
  }

  #session(signal: AbortSignal, onReady: () => void): Promise<'auth' | 'taken' | 'dropped'> {
    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        resolve('dropped');
        return;
      }
      this.#socket = socket;
      let settled = false;
      let missed = 0;
      let beat: NodeJS.Timeout | undefined;
      const finish = (why: 'auth' | 'taken' | 'dropped') => {
        if (settled) return;
        settled = true;
        clearInterval(beat);
        signal.removeEventListener('abort', abort);
        for (const [id, wait] of this.#pending) {
          clearTimeout(wait.timer);
          wait.reject(new ChannelError('network', 'The connection to WeCom dropped.'));
          this.#pending.delete(id);
        }
        socket.close(1000);
        resolve(why);
      };
      const abort = () => finish('dropped');
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', () => socket.send(JSON.stringify(this.subscribe())));
      socket.addEventListener('message', (event) => {
        const frame = parse(String(event.data));
        if (!frame) return;
        const id = frame.headers?.req_id ?? '';
        if (!frame.cmd && id.startsWith('aibot_subscribe')) {
          if (frame.errcode) return finish('auth');
          onReady();
          this.events.state('online');
          beat = setInterval(() => {
            // Two pings in a row without an answer: this socket is gone, whatever it looks like.
            if (++missed > 2) return finish('dropped');
            this.#write({ cmd: 'ping', headers: { req_id: `ping_${Date.now()}` } });
          }, 30_000);
          beat.unref?.();
          return;
        }
        if (!frame.cmd && id.startsWith('ping')) {
          missed = 0;
          return;
        }
        if (!frame.cmd) {
          const wait = this.#pending.get(id);
          if (!wait) return;
          clearTimeout(wait.timer);
          this.#pending.delete(id);
          if (frame.errcode)
            wait.reject(
              new ChannelError(
                frame.errcode === 45009 ? 'rate-limit' : 'refused',
                `WeCom said no (${frame.errcode} ${frame.errmsg ?? ''}).`.trim(),
                { retryAfterMs: 2_000 },
              ),
            );
          else wait.resolve(frame);
          return;
        }
        if (frame.cmd === 'aibot_event_callback') {
          const event = (frame.body?.event ?? {}) as {
            eventtype?: string;
            event_key?: string;
            task_id?: string;
          };
          if (event.eventtype === 'disconnected_event') return finish('taken');
          if (event.eventtype === 'template_card_event' && event.event_key)
            this.#press(frame.body ?? {}, event);
          return;
        }
        if (frame.cmd === 'aibot_msg_callback') this.#message(frame.body ?? {});
      });
      socket.addEventListener('close', () => finish('dropped'));
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) finish('dropped');
      });
    });
  }

  #write(frame: Frame) {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN)
      throw new ChannelError('network', 'Not connected to WeCom right now.');
    socket.send(JSON.stringify(frame));
  }

  /** Send a command and wait for WeCom's answer to it. */
  #ask(cmd: string, body: Record<string, unknown>): Promise<Frame> {
    const id = `${cmd}_${Date.now()}_${randomBytes(4).toString('hex')}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new ChannelError('network', 'WeCom didn’t answer in time.'));
      }, 15_000);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#write({ cmd, headers: { req_id: id }, body });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error as Error);
      }
    });
  }

  #who(
    body: Record<string, unknown>,
  ): { chatId: string; user: ChannelUser; direct: boolean } | undefined {
    const from = (body.from ?? {}) as { userid?: string };
    if (!from.userid) return undefined;
    const direct = body.chattype !== 'group';
    return {
      // A private chat's id is the person's userid.
      chatId: direct ? from.userid : String(body.chatid ?? ''),
      user: { id: personId(from.userid), name: from.userid, username: from.userid },
      direct,
    };
  }

  #message(body: Record<string, unknown>) {
    const msgid = String(body.msgid ?? '');
    if (!msgid || !this.#seen.add(msgid)) return;
    const who = this.#who(body);
    if (!who) return;
    const type = String(body.msgtype ?? '');
    let text = '';
    const files: ChannelFile[] = [];
    const media = (kind: string, value: unknown, name: string) => {
      const m = value as { url?: string; aeskey?: string } | undefined;
      if (m?.url)
        files.push({
          name,
          ref: JSON.stringify({ url: m.url, aeskey: m.aeskey }),
          ...(kind === 'image' && { mimeType: 'image/jpeg' }),
        });
    };
    if (type === 'text')
      text = String((body.text as { content?: string } | undefined)?.content ?? '');
    else if (type === 'voice')
      text = String((body.voice as { content?: string } | undefined)?.content ?? '');
    else if (type === 'image') media('image', body.image, 'picture.jpg');
    else if (type === 'file') media('file', body.file, 'file');
    else if (type === 'video') media('video', body.video, 'video.mp4');
    else if (type === 'mixed')
      for (const item of (
        body.mixed as
          | { msg_item?: { msgtype?: string; text?: { content?: string }; image?: unknown }[] }
          | undefined
      )?.msg_item ?? []) {
        if (item.msgtype === 'text') text += `${text ? '\n' : ''}${item.text?.content ?? ''}`;
        else if (item.msgtype === 'image') media('image', item.image, 'picture.jpg');
      }
    else return;
    const answer = this.#choices.match(who.chatId, text);
    if (answer) {
      this.#choices.forget(answer.ref);
      this.events.press({
        chatId: who.chatId,
        user: who.user,
        data: answer.data,
        message: answer.ref,
        ack: () => Promise.resolve(),
      });
      return;
    }
    this.events.message({
      chatId: who.chatId,
      messageId: msgid,
      user: who.user,
      text,
      files,
      direct: who.direct,
    });
  }

  #press(body: Record<string, unknown>, event: { event_key?: string; task_id?: string }) {
    const who = this.#who(body);
    if (!who || !event.event_key) return;
    this.#choices.forget({ chatId: who.chatId, messageId: event.task_id ?? '' });
    this.events.press({
      chatId: who.chatId,
      user: who.user,
      data: event.event_key,
      message: { chatId: who.chatId, messageId: event.task_id ?? '' },
      ack: () => Promise.resolve(),
    });
  }

  async send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const parts = fit(toDiscordMarkdown(markdown), 18_000, (p) => Buffer.byteLength(p));
    const sent: SentRef[] = [];
    for (const part of parts) {
      await this.#withRetry(() =>
        this.#ask('aibot_send_msg', {
          chatid: chatId,
          msgtype: 'markdown',
          markdown: { content: part },
        }),
      );
      sent.push({ chatId, messageId: '' });
    }
    const buttons = options?.buttons ?? [];
    if (buttons.length) {
      const taskId = `conch_${randomBytes(8).toString('hex')}`;
      this.#choices.remember({ chatId, messageId: taskId }, buttons);
      await this.#ask('aibot_send_msg', {
        chatid: chatId,
        msgtype: 'template_card',
        template_card: {
          card_type: 'button_interaction',
          main_title: { title: '需要你的确认 · Your OK' },
          sub_title_text: plain(markdown).slice(0, 120),
          task_id: taskId,
          button_list: buttons.map((b) => ({
            text: b.label.slice(0, 16),
            style: b.style === 'danger' ? 3 : b.style === 'primary' ? 1 : 2,
            key: b.data,
          })),
        },
      }).catch(async () => {
        // A workspace without cards still gets the question, with numbers to reply.
        await this.#ask('aibot_send_msg', {
          chatid: chatId,
          msgtype: 'markdown',
          markdown: { content: TextChoices.render('', buttons).trim() },
        });
      });
      sent.push({ chatId, messageId: taskId });
    }
    return sent;
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
      await pause(error.detail?.retryAfterMs ?? 1500, this.#stop.signal);
      return fn();
    }
  }

  async download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(FILE_LIMIT, options);
    let ref: { url?: string; aeskey?: string };
    try {
      ref = JSON.parse(file.ref) as typeof ref;
    } catch {
      throw new ChannelError('refused', 'That file’s address isn’t one Conch recognises.');
    }
    if (!ref.url || !tencentHost(ref.url))
      throw new ChannelError('refused', 'That file isn’t on WeCom’s own servers.');
    const response = await fetch(ref.url, { signal: AbortSignal.timeout(60_000) }).catch(
      (error: unknown) => {
        throw new ChannelError(
          'network',
          `Couldn’t download that file (${(error as Error).message}).`,
        );
      },
    );
    if (!response.ok)
      throw new ChannelError('network', `Couldn’t download that file (${response.status}).`);
    const bytes = await readCapped(response, cap, 'That file is too big to take from WeCom.');
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(
      response.headers.get('content-disposition') ?? '',
    )?.[1];
    return {
      name: named ? decodeURIComponent(named) : file.name,
      bytes: ref.aeskey ? decryptMedia(bytes, ref.aeskey) : bytes,
      ...(file.mimeType && { mimeType: file.mimeType }),
    };
  }
}

// ── Official Account (through the public door) ───────────────────────────

/** How long a delivery waits for an answer it could carry back itself (WeChat gives up at 5 s). */
const HOLD_MS = 4_500;
/** Text per message: WeChat cuts long ones, and Chinese takes three bytes a character. */
const OA_PART = 600;

/**
 * WeChat through an Official Account (公众号) or its free test account
 * (测试号), so you talk to it in WeChat itself. WeChat only delivers to a
 * public web address on port 80 or 443, so it comes in through the public
 * door (ADR 0045):
 *
 * - every delivery's `signature` (and in safe mode its `msg_signature`) is
 *   checked in constant time, the message is decrypted with the
 *   EncodingAESKey and must name this AppID, and a timestamp more than ten
 *   minutes off, or a message already seen, is refused (replays);
 * - an answer ready within 4.5 seconds goes back in the reply itself
 *   (passive reply), encrypted in safe mode; later ones go as
 *   customer-service messages (客服消息), which WeChat allows within 48
 *   hours of your last message, for verified accounts and the test account;
 * - an account that may not send them (an individual's, unverified) keeps
 *   WeChat waiting through its retries, then says it's still working, and
 *   the answer comes back with your next message ("?" fetches it).
 */
export class WeChatOfficialAdapter implements ChannelAdapter {
  readonly kind = 'wechat' as const;
  #token?: { value: string; expiresAt: number };

  constructor(
    private readonly secrets: WeChatSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get #api() {
    return this.endpoints.wechat ?? WECHAT_API;
  }

  async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now() + 5 * 60_000) return this.#token.value;
    if (!WECHAT_APP_ID.test(this.secrets.appId))
      throw new ChannelError(
        'auth',
        'That doesn’t look like an AppID. It starts with wx and is on the account’s page.',
        {
          field: 'appId',
        },
      );
    // The stable token doesn't cut off another program using the same account (unlike /cgi-bin/token).
    const body = await this.#call<{ access_token?: string; expires_in?: number }>(
      '/cgi-bin/stable_token',
      { grant_type: 'client_credential', appid: this.secrets.appId, secret: this.secrets.secret },
      { signal, noToken: true },
    );
    if (!body.access_token) throw new ChannelError('network', 'WeChat didn’t hand over a token.');
    this.#token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000,
    };
    return body.access_token;
  }

  async #call<T>(
    path: string,
    body: unknown,
    options: {
      signal?: AbortSignal;
      noToken?: boolean;
      retried?: boolean;
      method?: 'GET' | 'POST';
    } = {},
  ): Promise<T & { errcode?: number; errmsg?: string }> {
    const url = new URL(`${this.#api}${path}`);
    if (!options.noToken)
      url.searchParams.set('access_token', await this.accessToken(options.signal));
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'POST',
        ...(options.method !== 'GET' && {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(15_000),
          ...(options.signal ? [options.signal] : []),
        ]),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(
          `Couldn’t reach WeChat (${(error as Error).message}).`,
          this.secrets.secret,
          this.#token?.value,
        ),
      );
    }
    if (response.status >= 500)
      throw new ChannelError('network', `WeChat had a problem (${response.status}).`);
    const data = (await response.json().catch(() => ({ errcode: -1 }))) as T & {
      errcode?: number;
      errmsg?: string;
    };
    const code = data.errcode ?? 0;
    if (code === 0) return data;
    const said = redact(data.errmsg ?? '', this.secrets.secret, this.#token?.value);
    // An expired or replaced token: a fresh one, once.
    if ([40001, 40014, 42001].includes(code) && !options.noToken && !options.retried) {
      this.#token = undefined;
      return this.#call(path, body, { ...options, retried: true });
    }
    if (code === 40013)
      throw new ChannelError('auth', 'WeChat doesn’t know that AppID.', { field: 'appId' });
    if (code === 40125 || (code === 40001 && options.noToken))
      throw new ChannelError(
        'auth',
        'WeChat doesn’t accept that AppSecret. Copy it again (or reset it) on the account’s page.',
        {
          field: 'secret',
        },
      );
    if (code === 40164 || code === 89503) {
      const ip = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(said)?.[1];
      throw new ChannelError(
        'setup',
        `WeChat only takes calls from addresses on the account’s IP whitelist (IP白名单). Add ${ip ? `this computer’s address, ${ip},` : 'this computer’s public address'} under 设置与开发 → 基本配置 → IP白名单, then press Repair.`,
      );
    }
    if (code === 45009 || code === 45011)
      throw new ChannelError('rate-limit', 'WeChat asked Conch to slow down.', {
        retryAfterMs: 10_000,
      });
    throw new WeChatError(code, `WeChat said no (${code}${said ? ` ${said}` : ''}).`);
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    await this.accessToken(signal);
    return { id: this.secrets.appId, name: 'Official Account', account: 'official' };
  }

  hook() {
    const url = this.endpoints.door?.hookUrl(this.secrets.hookId ?? '');
    return url ? { url } : {};
  }

  hookSecrets() {
    return {
      ...this.hook(),
      ...(this.secrets.token && { token: this.secrets.token }),
      ...(this.secrets.aesKey && { aesKey: this.secrets.aesKey }),
    };
  }

  connect(events: ChannelEvents): ChannelConnection {
    const session = new OfficialSession(
      this,
      this.secrets,
      this.#api,
      events,
      (path, body, method) => this.#call(path, body, { method }),
    );
    const door = this.endpoints.door;
    const unmount = door?.mount(this.secrets.hookId ?? '', 'wechat', (request) =>
      session.deliver(request),
    );
    const stop = new AbortController();
    const health = () => {
      const state = door?.status().state;
      if (state === 'ready') events.state('online');
      else
        events.state('error', {
          message:
            state === 'starting'
              ? 'Turning on the public address WeChat delivers to…'
              : 'WeChat can’t reach Conch yet: turn on its public address on this channel’s page.',
        });
    };
    const offDoor = door?.onChange(() => {
      events.changed?.();
      health();
    });
    void (async () => {
      events.state('connecting');
      const backoff = new Backoff();
      while (!stop.signal.aborted) {
        try {
          await this.accessToken(stop.signal);
          health();
          return;
        } catch (error) {
          if (stop.signal.aborted) return;
          const failure =
            error instanceof ChannelError ? error : new ChannelError('network', String(error));
          if (failure.code === 'auth')
            return events.state('needs-token', { message: failure.message });
          if (failure.code === 'setup') return events.state('error', { message: failure.message });
          const wait =
            failure.detail?.retryAfterMs && failure.code === 'rate-limit'
              ? failure.detail.retryAfterMs
              : backoff.next();
          events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
          await pause(wait, stop.signal);
        }
      }
    })();
    return {
      send: (chatId, markdown, options) => session.send(chatId, markdown, options),
      edit: async (ref, markdown) => {
        await session.send(ref.chatId, markdown);
      },
      typing: (chatId) => session.typing(chatId),
      download: (file, options) => session.download(file, options),
      directChat: (userId) => Promise.resolve(appId(userId)),
      close: () => {
        stop.abort();
        unmount?.();
        offDoor?.();
        session.close();
      },
    };
  }
}

/** WeChat refused one request, with its own error code. */
class WeChatError extends ChannelError {
  constructor(
    readonly wechat: number,
    message: string,
  ) {
    super('refused', message);
  }
}

type Call = <T>(
  path: string,
  body: unknown,
  method?: 'GET' | 'POST',
) => Promise<T & { errcode?: number }>;

class OfficialSession {
  /** A delivery waiting for an answer it can carry back, per person. */
  #waiting = new Map<string, (text: string) => void>();
  /** Answers WeChat wouldn't let Conch send yet, per person. */
  #outbox = new Map<string, string[]>();
  /** How many times WeChat delivered each message (it retries after 5 s). */
  #attempts = new Map<string, number>();
  /** The account may not send customer-service messages (an individual's, unverified). */
  #passive = false;
  /** Questions answered by typing their number (or yes / no). */
  #choices = new TextChoices();
  #closed = false;

  constructor(
    private readonly adapter: WeChatOfficialAdapter,
    private readonly secrets: WeChatSecrets,
    private readonly api: string,
    private readonly events: ChannelEvents,
    private readonly call: Call,
  ) {}

  close() {
    this.#closed = true;
    for (const resolve of this.#waiting.values()) resolve('');
    this.#waiting.clear();
  }

  async deliver(request: HookRequest): Promise<HookReply> {
    const token = this.secrets.token ?? '';
    const q = request.query;
    const timestamp = q.timestamp ?? '';
    const nonce = q.nonce ?? '';
    if (!signed(q.signature, token, timestamp, nonce))
      return { status: 401, body: 'Not authorised.' };
    // A delivery far from now is a replay (WeChat's clock and this one agree to minutes).
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 10 * 60)
      return { status: 401, body: 'Not authorised.' };
    if (request.method === 'GET') {
      // WeChat checking the address when the settings are saved: answer its echo.
      this.events.heard?.();
      return { status: 200, body: q.echostr ?? '' };
    }
    let message: Record<string, string>;
    const safe = q.encrypt_type === 'aes';
    try {
      const outer = parseXml(request.body);
      if (safe) {
        const encrypted = outer.Encrypt ?? '';
        if (!signed(q.msg_signature, token, timestamp, nonce, encrypted))
          return { status: 401, body: 'Not authorised.' };
        message = parseXml(decrypt(encrypted, this.secrets.aesKey ?? '', this.secrets.appId));
      } else message = outer;
    } catch (error) {
      if (error instanceof WeChatCryptoError) return { status: 400, body: 'Not accepted.' };
      throw error;
    }
    this.events.heard?.();
    const openid = message.FromUserName ?? '';
    if (!/^[\w-]{6,64}$/.test(openid)) return { status: 400, body: 'Not accepted.' };
    const key = message.MsgId ?? `${openid}:${message.CreateTime}:${message.Event ?? ''}`;
    const attempt = (this.#attempts.get(key) ?? 0) + 1;
    this.#attempts.set(key, attempt);
    if (this.#attempts.size > 2000) this.#attempts.delete(this.#attempts.keys().next().value ?? '');
    if (attempt === 1) {
      const fetched = this.#receive(message, openid);
      // "?" only fetches what's waiting.
      if (fetched === 'fetch')
        return this.#reply(
          message,
          this.#takeOutbox(openid) ?? '这会儿没有新消息 · Nothing new yet.',
          safe,
          nonce,
        );
    }
    const waiting = this.#takeOutbox(openid);
    if (waiting) return this.#reply(message, waiting, safe, nonce);
    const text = await this.#hold(openid, HOLD_MS);
    if (text) return this.#reply(message, text, safe, nonce);
    // Nothing yet. An account that can't send later keeps WeChat waiting through its retries.
    if (this.#passive && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return { status: 200, body: '' };
    }
    if (this.#passive)
      return this.#reply(
        message,
        '⏳ 我还在想。稍后发一个“?”就能看到答案。· Still working on it: send “?” in a minute to see the answer.',
        safe,
        nonce,
      );
    return { status: 200, body: 'success' };
  }

  /** The message, to the service (or a press, for a number answering the last question). */
  #receive(message: Record<string, string>, openid: string): 'fetch' | undefined {
    // An Official Account only knows an id: the page shows its end, and the owner by your own name.
    const user: ChannelUser = {
      id: personId(openid),
      name: `WeChat user ·${openid.slice(-4)}`,
      anonymous: true,
    };
    const type = message.MsgType ?? '';
    if (type === 'event') {
      // Following the account is the hello on WeChat.
      if (message.Event === 'subscribe')
        this.events.message({
          chatId: openid,
          messageId: message.CreateTime ?? '',
          user,
          text: 'hello',
          files: [],
          direct: true,
        });
      return undefined;
    }
    let text = message.Content ?? '';
    if (type === 'text' && /^\s*[?？]\s*$/.test(text)) return 'fetch';
    const answer = type === 'text' ? this.#choices.match(openid, text) : undefined;
    if (answer) {
      this.#choices.forget(answer.ref);
      this.events.press({
        chatId: openid,
        user,
        data: answer.data,
        message: answer.ref,
        ack: () => Promise.resolve(),
      });
      return undefined;
    }
    const files: ChannelFile[] = [];
    if (type === 'image' && message.MediaId)
      files.push({
        name: `picture-${message.MsgId ?? Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        ref: message.MediaId,
      });
    else if (type === 'voice') {
      // WeChat's own speech recognition, when the account has it on; else the recording.
      if (message.Recognition) text = message.Recognition;
      else if (message.MediaId)
        files.push({
          name: `voice.${message.Format ?? 'amr'}`,
          ref: message.MediaId,
          voice: true,
        });
    } else if ((type === 'video' || type === 'shortvideo') && message.MediaId)
      files.push({ name: 'video.mp4', mimeType: 'video/mp4', ref: message.MediaId });
    else if (type === 'link') text = `${message.Title ?? ''}\n${message.Url ?? ''}`.trim();
    else if (type === 'location')
      text = `📍 ${message.Label ?? ''} (${message.Location_X}, ${message.Location_Y})`;
    else if (type !== 'text') return undefined;
    this.events.message({
      chatId: openid,
      messageId: message.MsgId ?? '',
      user,
      text,
      files,
      direct: true,
    });
    return undefined;
  }

  #hold(openid: string, ms: number): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.#waiting.get(openid) === done) this.#waiting.delete(openid);
        resolve('');
      }, ms);
      const done = (text: string) => {
        clearTimeout(timer);
        resolve(text);
      };
      this.#waiting.set(openid, done);
    });
  }

  #takeOutbox(openid: string): string | undefined {
    const box = this.#outbox.get(openid);
    const first = box?.shift();
    if (box && !box.length) this.#outbox.delete(openid);
    if (first && box?.length)
      return `${first}\n\n（还有 ${box.length} 条，发“?”继续 · ${box.length} more: send “?”）`;
    return first;
  }

  #reply(message: Record<string, string>, text: string, safe: boolean, nonce: string): HookReply {
    const now = Math.floor(Date.now() / 1000);
    const xml = buildXml({
      ToUserName: message.FromUserName ?? '',
      FromUserName: message.ToUserName ?? '',
      CreateTime: now,
      MsgType: 'text',
      Content: text,
    });
    if (!safe) return { status: 200, body: xml, type: 'application/xml' };
    const encrypted = encrypt(xml, this.secrets.aesKey ?? '', this.secrets.appId);
    return {
      status: 200,
      type: 'application/xml',
      body: buildXml({
        Encrypt: encrypted,
        MsgSignature: signature(this.secrets.token ?? '', String(now), nonce, encrypted),
        TimeStamp: now,
        Nonce: nonce,
      }),
    };
  }

  async send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const buttons = options?.buttons ?? [];
    const text = buttons.length ? TextChoices.render(markdown, buttons) : markdown;
    const parts = fit(text, OA_PART, (p) => plain(p).length).map((p) => plain(p));
    const sent: SentRef[] = [];
    for (const part of parts) {
      sent.push({ chatId, messageId: randomBytes(6).toString('hex') });
      // A delivery is waiting right now: the answer goes back in it.
      const waiting = this.#waiting.get(chatId);
      if (waiting && !this.#closed) {
        this.#waiting.delete(chatId);
        waiting(part);
        continue;
      }
      if (this.#passive || (this.#outbox.get(chatId)?.length ?? 0) > 0) {
        this.#queue(chatId, part);
        continue;
      }
      try {
        await this.call('/cgi-bin/message/custom/send', {
          touser: chatId,
          msgtype: 'text',
          text: { content: part },
        });
      } catch (error) {
        const code = error instanceof WeChatError ? error.wechat : undefined;
        // Not allowed for this account (48001), past the 48 hours (45015) or past the limit (45047): later, with their next message.
        if (code === 48001 || code === 48004) {
          this.#passive = true;
          this.events.healed(
            'This WeChat account can’t send messages later (only verified accounts and test accounts can), so long answers wait for your next message.',
          );
        }
        if (code === 48001 || code === 48004 || code === 45015 || code === 45047)
          this.#queue(chatId, part);
        else throw error;
      }
    }
    // The last part carries the question: a number replied to it presses its button.
    const last = sent.at(-1);
    if (buttons.length && last) this.#choices.remember(last, buttons);
    return sent;
  }

  #queue(chatId: string, part: string) {
    const box = this.#outbox.get(chatId) ?? [];
    box.push(part);
    this.#outbox.set(chatId, box.slice(-20));
  }

  async typing(chatId: string) {
    if (this.#passive) return;
    await this.call('/cgi-bin/message/custom/typing', { touser: chatId, command: 'Typing' }).catch(
      () => undefined,
    );
  }

  async download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(FILE_LIMIT, options);
    if (!/^[\w-]{1,128}$/.test(file.ref))
      throw new ChannelError('refused', 'That file’s id isn’t one Conch recognises.');
    const token = await this.adapter.accessToken();
    const url = `${this.api}/cgi-bin/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(file.ref)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(
      (error: unknown) => {
        throw new ChannelError(
          'network',
          redact(`Couldn’t download that file (${(error as Error).message}).`, token),
        );
      },
    );
    if (!response.ok)
      throw new ChannelError('network', `Couldn’t download that file (${response.status}).`);
    const type = response.headers.get('content-type') ?? '';
    // An error comes back as JSON instead of the file.
    if (/json|text\/plain/.test(type))
      throw new ChannelError(
        'refused',
        'WeChat didn’t hand over that file (it keeps them for three days).',
      );
    const bytes = await readCapped(response, cap, 'That file is too big to take from WeChat.');
    return {
      name: file.name,
      bytes,
      ...((file.mimeType ?? type) && { mimeType: file.mimeType ?? type }),
    };
  }
}
