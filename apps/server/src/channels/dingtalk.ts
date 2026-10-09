/**
 * DingTalk (钉钉, ADR 0120): an internal app with a robot, in **Stream
 * mode**. Conch asks DingTalk for a ticket (`POST
 * /v1.0/gateway/connections/open`) and opens the WebSocket it names, so
 * nothing needs a public address, an IP allowlist or a domain.
 *
 * - **Who it is**: the app's Client ID (AppKey, also the robot's code) and
 *   Client Secret, checked at once for an access token and a Stream ticket.
 * - **Messages** arrive as `CALLBACK` frames on the robot's topic, each
 *   acknowledged at once so DingTalk doesn't send it again; a `ping` is
 *   answered with its own data, a `disconnect` reconnects straight away.
 * - **Answers** go as Markdown (`sampleMarkdown`, under 15,000 bytes a
 *   message), to a person by their staff id or to a group by its
 *   conversation; the conversation's own reply address (sessionWebhook) is
 *   the fallback before the robot is published.
 * - **Approvals** are numbered answers. DingTalk's buttons that call back
 *   need a card template made in its card platform (the built-in one closed
 *   to new apps at the end of 2024), so a question says "Reply 1 to allow",
 *   and what was decided comes as a message of its own.
 * - **Voice messages** come with DingTalk's own transcript (`recognition`);
 *   one without is a voice note Conch hears itself (ADR 0077).
 * - **Groups** (ADR 0075): DingTalk only delivers a group's messages that
 *   @mention the robot.
 * - **Healing**: the token is refreshed before it expires (and once more if
 *   DingTalk calls it stale), a silent socket is replaced, drops are retried
 *   with backoff, rate limits waited out, the free plan's monthly allowance
 *   running out is said in plain words, and a refused secret stops this
 *   channel only.
 *
 * Only DingTalk's own API is called (api.dingtalk.com, oapi.dingtalk.com),
 * with the person's own app's keys.
 */
import { randomBytes } from 'node:crypto';

import type { ChannelBot, ChannelSecrets } from '@conch/protocol';

import type { ChannelEndpoints } from './adapters';
import { blocks, fit, inline, plain, prose } from './format';
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
  pause,
  personId,
  readCapped,
  redact,
} from './types';

type DingTalkSecrets = Extract<ChannelSecrets, { kind: 'dingtalk' }>;

export const DINGTALK_API = 'https://api.dingtalk.com';
export const DINGTALK_OAPI = 'https://oapi.dingtalk.com';
export const BOT_TOPIC = '/v1.0/im/bot/messages/get';

/** A message's parameters must be under 15,000 bytes; keep room for the JSON around them. */
const PART_BYTES = 12_000;
const PART_CHARS = 5_000;
/** Pictures and files DingTalk takes from an app: 20 MB, and only these kinds of file. */
const UPLOAD_LIMIT = 20 * 1024 * 1024;
const FILE_TYPES = new Set(['xlsx', 'pdf', 'zip', 'rar', 'doc', 'docx']);
const PICTURE_TYPES = /^image\/(?:png|jpeg|gif|bmp)$/;
const DOWNLOAD_LIMIT = 50 * 1024 * 1024;
/** No frame at all for this long (DingTalk pings far more often): the socket is gone. */
const SILENCE_MS = 150_000;

/** What was pasted, tidied. */
export function normalizeDingTalk(secrets: DingTalkSecrets): DingTalkSecrets {
  return {
    kind: 'dingtalk',
    clientId: /\b(ding[a-z0-9]{12,40})\b/.exec(secrets.clientId)?.[1] ?? secrets.clientId.trim(),
    clientSecret:
      /\b([A-Za-z0-9_-]{40,80})\b/.exec(secrets.clientSecret)?.[1] ?? secrets.clientSecret.trim(),
  };
}

/** DingTalk's Markdown: headings, quotes, bold, italic, links, images and lists; code as quoted lines. */
export function toDingTalkMarkdown(markdown: string): string {
  const style = {
    escape: (s: string) => s,
    code: (s: string) => `\`${s}\``,
    bold: (s: string) => `**${s}**`,
    italic: (s: string) => `*${s}*`,
    strike: (s: string) => s,
    link: (label: string, url: string) => `[${label}](${url})`,
  };
  return blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? block.text
            .split('\n')
            .map((line) => `> ${line || ' '}`)
            .join('\n')
        : prose(block.text, {
            line: (s) => inline(s, style),
            heading: (s) => `### ${s}`,
            quote: (lines) => lines.map((l) => `> ${l}`).join('\n'),
            table: (rows) =>
              rows
                .split('\n')
                .map((l) => `> ${l}`)
                .join('\n'),
            bullet: '-',
          }).replace(/([^\n])\n(?=[^\n])/g, '$1  \n'),
    )
    .join('\n\n')
    .trim();
}

/** Files come only from DingTalk's own servers (and its storage). */
function dingtalkHost(url: string, extra: string[]): boolean {
  try {
    const parsed = new URL(url);
    if (extra.some((origin) => parsed.origin === new URL(origin).origin)) return true;
    return (
      parsed.protocol === 'https:' &&
      /(^|\.)(dingtalk\.com|aliyuncs\.com|alicdn\.com|dingtalkapps\.com)$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

interface StreamFrame {
  specVersion?: string;
  type?: 'SYSTEM' | 'EVENT' | 'CALLBACK';
  headers?: { topic?: string; messageId?: string; contentType?: string; [key: string]: unknown };
  data?: string;
}

interface BotMessage {
  conversationId?: string;
  conversationType?: string;
  conversationTitle?: string;
  msgId?: string;
  senderNick?: string;
  senderStaffId?: string;
  senderId?: string;
  isInAtList?: boolean;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  robotCode?: string;
  chatbotUserId?: string;
  msgtype?: string;
  text?: { content?: string };
  content?: {
    downloadCode?: string;
    pictureDownloadCode?: string;
    recognition?: string;
    fileName?: string;
    richText?: { text?: string; downloadCode?: string; type?: string }[];
  };
  errorCode?: string | number;
}

/** DingTalk, through an internal app's robot in Stream mode. */
export class DingTalkAdapter implements ChannelAdapter {
  readonly kind = 'dingtalk' as const;
  /** DingTalk delivers only the group messages that @mention it (ADR 0075). */
  readonly groups = true;
  #token?: { value: string; expiresAt: number };

  constructor(
    private readonly secrets: DingTalkSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get api() {
    return this.endpoints.dingtalk ?? DINGTALK_API;
  }

  get oapi() {
    return this.endpoints.dingtalkOld ?? DINGTALK_OAPI;
  }

  get robotCode() {
    return this.secrets.clientId;
  }

  async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now() + 5 * 60_000) return this.#token.value;
    if (!/^[\w-]{6,64}$/.test(this.secrets.clientId))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a Client ID. It’s on the app’s Credentials & Basic Info page (凭证与基础信息), often starting with ding.',
        { field: 'clientId' },
      );
    const body = await this.request<{ accessToken?: string; expireIn?: number }>(
      'POST',
      '/v1.0/oauth2/accessToken',
      { appKey: this.secrets.clientId, appSecret: this.secrets.clientSecret },
      { signal, noToken: true },
    );
    if (!body.accessToken) throw new ChannelError('network', 'DingTalk didn’t hand over a token.');
    this.#token = {
      value: body.accessToken,
      expiresAt: Date.now() + (body.expireIn ?? 7200) * 1000,
    };
    return body.accessToken;
  }

  /** One call to api.dingtalk.com, with DingTalk's own error codes turned into what to change. */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { signal?: AbortSignal; noToken?: boolean; retried?: boolean } = {},
  ): Promise<T> {
    const token = options.noToken ? undefined : await this.accessToken(options.signal);
    let response: Response;
    try {
      response = await fetch(`${this.api}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(token && { 'x-acs-dingtalk-access-token': token }),
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
        redact(
          `Couldn’t reach DingTalk (${(error as Error).message}).`,
          this.secrets.clientSecret,
          token,
        ),
      );
    }
    const data = (await response.json().catch(() => ({}))) as T & {
      code?: string;
      message?: string;
      requiredScopes?: string[];
    };
    if (response.ok && !data.code) return data;
    const code = String(data.code ?? response.status);
    const said = redact(data.message ?? '', this.secrets.clientSecret, token);
    if (
      (code === 'InvalidAuthentication' ||
        code === 'invalidAccessToken' ||
        response.status === 401) &&
      !options.noToken &&
      !options.retried
    ) {
      this.#token = undefined;
      return this.request(method, path, body, { ...options, retried: true });
    }
    throw dingTalkError(response.status, code, said, data.requiredScopes);
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    await this.accessToken(signal);
    // The Stream gateway checks the keys again, and that Stream mode is allowed for this app.
    await this.ticket(signal);
    return { id: this.secrets.clientId, name: 'DingTalk robot' };
  }

  /** A ticket for one Stream connection (good for 90 seconds, once). */
  async ticket(signal?: AbortSignal): Promise<{ endpoint: string; ticket: string }> {
    const reply = await this.request<{ endpoint?: string; ticket?: string }>(
      'POST',
      '/v1.0/gateway/connections/open',
      {
        clientId: this.secrets.clientId,
        clientSecret: this.secrets.clientSecret,
        subscriptions: [
          { type: 'EVENT', topic: '*' },
          { type: 'CALLBACK', topic: BOT_TOPIC },
        ],
        ua: 'conch-stream/1',
        localIp: '',
      },
      { signal, noToken: true },
    );
    if (!reply.endpoint || !reply.ticket || !/^wss?:\/\//.test(reply.endpoint))
      throw new ChannelError('network', 'DingTalk didn’t say where its Stream connection is.');
    return { endpoint: reply.endpoint, ticket: reply.ticket };
  }

  connect(events: ChannelEvents): ChannelConnection {
    const session = new DingTalkSession(this, events, this.endpoints.dingtalkFiles ?? []);
    void session.run();
    return {
      send: (chatId, markdown, options) => session.send(chatId, markdown, options),
      // DingTalk can't change a robot's message: what was decided goes as a new one.
      edit: async (ref, markdown) => {
        session.forget(ref);
        await session.send(ref.chatId, markdown);
      },
      typing: () => Promise.resolve(),
      download: (file, options) => session.download(file, options),
      directChat: (userId) => Promise.resolve(appId(userId)),
      files: {
        maxBytes: UPLOAD_LIMIT,
        accepts: (file) =>
          file.image
            ? PICTURE_TYPES.test(file.mimeType)
            : FILE_TYPES.has(file.name.split('.').pop()?.toLowerCase() ?? ''),
        send: (chatId, files, caption) => session.sendFiles(chatId, files, caption),
      },
      close: () => session.close(),
    };
  }
}

function dingTalkError(
  status: number,
  code: string,
  said: string,
  scopes?: string[],
): ChannelError {
  if (code === 'invalidClientIdOrSecret' || code === 'authFailed' || code === 'invalidClientId')
    return new ChannelError(
      'auth',
      'DingTalk doesn’t accept this Client ID and Client Secret. Copy both again from the app’s Credentials & Basic Info page (凭证与基础信息).',
      { field: 'clientSecret' },
    );
  if (status === 429 || /Throttling|tooFast|too\.fast|flowControl|QpsLimit/i.test(code))
    return new ChannelError('rate-limit', 'DingTalk asked Conch to slow down.', {
      retryAfterMs: 2_000,
    });
  if (/AccessTokenPermissionDenied|Forbidden|permission/i.test(code))
    return new ChannelError(
      'setup',
      `The app is missing a permission${scopes?.length ? ` (${scopes.join(', ')})` : ''}. In the developer console, open Permissions (权限管理), turn on what Conch’s page lists, and publish the app again.`,
    );
  if (/robot.*not.*exist|robotCode|chatbot/i.test(code))
    return new ChannelError(
      'setup',
      'The app has no robot yet. In the developer console, open App capabilities → Robot (机器人), set it up with Stream mode, and publish it.',
    );
  if (status >= 500) return new ChannelError('network', `DingTalk had a problem (${status}).`);
  return new ChannelError('refused', `DingTalk said no (${code}${said ? ` ${said}` : ''}).`);
}

class DingTalkSession {
  #stop = new AbortController();
  #socket?: WebSocket;
  #seen = new Recent(2000);
  #choices = new TextChoices();
  /** Each chat's reply address, for before the robot is published (no staff ids yet). */
  #webhooks = new Map<string, { url: string; until: number }>();
  /** The monthly allowance ran out: said once, until a message arrives again. */
  #quota = false;

  constructor(
    private readonly adapter: DingTalkAdapter,
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
        const { endpoint, ticket } = await this.adapter.ticket(signal);
        const url = new URL(endpoint);
        url.searchParams.set('ticket', ticket);
        const ended = await this.#session(url.toString(), signal, () => backoff.reset());
        if (signal.aborted) return;
        if (ended === 'told') continue;
        const wait = backoff.next();
        this.events.state('reconnecting', {
          message: 'Reconnecting to DingTalk.',
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

  /** One Stream connection: `told` when DingTalk asked Conch to move to a new one. */
  #session(url: string, signal: AbortSignal, onReady: () => void): Promise<'dropped' | 'told'> {
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
      let heard = Date.now();
      const watch = setInterval(() => {
        if (Date.now() - heard > SILENCE_MS) finish('dropped');
      }, 15_000);
      watch.unref?.();
      const finish = (why: 'dropped' | 'told') => {
        if (settled) return;
        settled = true;
        clearInterval(watch);
        signal.removeEventListener('abort', abort);
        socket.close(1000);
        resolve(why);
      };
      const abort = () => finish('dropped');
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', () => {
        onReady();
        this.events.state('online');
      });
      socket.addEventListener('message', (message) => {
        heard = Date.now();
        let frame: StreamFrame;
        try {
          frame = JSON.parse(String(message.data)) as StreamFrame;
        } catch {
          return;
        }
        const topic = frame.headers?.topic;
        const messageId = frame.headers?.messageId ?? '';
        const reply = (data: unknown) =>
          socket.readyState === WebSocket.OPEN &&
          socket.send(
            JSON.stringify({
              code: 200,
              headers: { contentType: 'application/json', messageId },
              message: 'OK',
              data: typeof data === 'string' ? data : JSON.stringify(data),
            }),
          );
        if (frame.type === 'SYSTEM') {
          if (topic === 'ping') reply(frame.data ?? '{}');
          // DingTalk is moving this connection: a new ticket now (it closes this one in 10 s).
          else if (topic === 'disconnect') finish('told');
          return;
        }
        if (frame.type === 'EVENT') {
          reply({ status: 'SUCCESS', message: 'OK' });
          return;
        }
        if (frame.type === 'CALLBACK') {
          // Taken at once, so DingTalk doesn't send it again; then read.
          reply({ response: {} });
          if (topic === BOT_TOPIC && messageId && this.#seen.add(`f:${messageId}`))
            void this.#message(frame.data ?? '{}').catch(() => undefined);
        }
      });
      socket.addEventListener('close', () => finish('dropped'));
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) finish('dropped');
      });
    });
  }

  async #message(raw: string) {
    let message: BotMessage;
    try {
      message = JSON.parse(raw) as BotMessage;
    } catch {
      return;
    }
    // The month's allowance is used up: DingTalk sends the message without its words.
    if (String(message.errorCode ?? '') === '20001') {
      if (!this.#quota)
        this.events.state('error', {
          message:
            'DingTalk’s monthly allowance of robot messages is used up (the free plan has 5,000). It starts again next month, or with a bigger plan.',
        });
      this.#quota = true;
      return;
    }
    if (this.#quota) {
      this.#quota = false;
      this.events.state('online');
    }
    if (message.msgId && !this.#seen.add(`m:${message.msgId}`)) return;
    const sender = message.senderStaffId || message.senderId;
    if (!sender || !message.conversationId) return;
    const direct = message.conversationType !== '2';
    // A person's private chat is them (by staff id, as DingTalk sends to); a group is its conversation.
    const chatId = direct ? sender : message.conversationId;
    if (message.sessionWebhook && message.sessionWebhookExpiredTime)
      this.#webhooks.set(chatId, {
        url: message.sessionWebhook,
        until: message.sessionWebhookExpiredTime,
      });
    const files: ChannelFile[] = [];
    const file = (code: unknown, name: string, extra: Partial<ChannelFile> = {}) => {
      if (typeof code === 'string' && code.length > 4 && code.length < 4000)
        files.push({ name, ref: JSON.stringify({ c: code }), ...extra });
    };
    let text = '';
    const content = message.content ?? {};
    switch (message.msgtype) {
      case 'text':
        text = message.text?.content ?? '';
        break;
      case 'richText':
        for (const item of content.richText ?? []) {
          if (item.text) text += item.text;
          else if (item.downloadCode)
            file(item.downloadCode, `picture-${files.length + 1}.png`, { mimeType: 'image/png' });
        }
        break;
      case 'picture':
        file(content.downloadCode ?? content.pictureDownloadCode, 'picture.png', {
          mimeType: 'image/png',
        });
        break;
      case 'audio':
        // DingTalk's own transcript first; a recording without one, Conch hears itself.
        if (content.recognition?.trim()) text = content.recognition.trim();
        else file(content.downloadCode, 'voice.amr', { voice: true });
        break;
      case 'video':
        file(content.downloadCode, 'video.mp4', { mimeType: 'video/mp4' });
        break;
      case 'file':
        file(content.downloadCode, content.fileName ?? 'file');
        break;
      default:
        return;
    }
    text = text.trim();
    const user = {
      id: personId(sender),
      name: message.senderNick?.trim() || `DingTalk user ·${sender.slice(-4)}`,
      ...(!message.senderNick && { anonymous: true }),
    };
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
      messageId: message.msgId ?? randomBytes(6).toString('hex'),
      user,
      text,
      files,
      direct,
      ...(!direct && {
        mentioned: message.isInAtList !== false,
        group: message.conversationTitle?.trim() || 'A DingTalk group',
      }),
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

  /** One robot message to a person or a group; its query key back. */
  async #deliver(
    chatId: string,
    msgKey: string,
    msgParam: Record<string, unknown>,
  ): Promise<string> {
    const group = chatId.startsWith('cid');
    try {
      const sent = await this.#withRetry(() =>
        group
          ? this.adapter.request<{ processQueryKey?: string }>(
              'POST',
              '/v1.0/robot/groupMessages/send',
              {
                robotCode: this.adapter.robotCode,
                openConversationId: chatId,
                msgKey,
                msgParam: JSON.stringify(msgParam),
              },
            )
          : this.adapter.request<{
              processQueryKey?: string;
              flowControlledStaffIdList?: string[];
            }>('POST', '/v1.0/robot/oToMessages/batchSend', {
              robotCode: this.adapter.robotCode,
              userIds: [chatId],
              msgKey,
              msgParam: JSON.stringify(msgParam),
            }),
      );
      if ((sent as { flowControlledStaffIdList?: string[] }).flowControlledStaffIdList?.length)
        throw new ChannelError('rate-limit', 'DingTalk asked Conch to slow down.', {
          retryAfterMs: 5_000,
        });
      return sent.processQueryKey ?? randomBytes(6).toString('hex');
    } catch (error) {
      // Not published yet (no staff ids), or a permission missing: the conversation's reply address still works.
      const hook = this.#webhooks.get(chatId);
      if (!hook || hook.until < Date.now() + 5_000 || msgKey !== 'sampleMarkdown') throw error;
      await this.#webhook(hook.url, msgParam);
      return randomBytes(6).toString('hex');
    }
  }

  async #webhook(url: string, param: Record<string, unknown>) {
    if (!dingtalkHost(url, this.files))
      throw new ChannelError('refused', 'That reply address isn’t DingTalk’s.');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: param }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      throw new ChannelError('network', `Couldn’t reach DingTalk (${(error as Error).message}).`);
    });
    const data = (await response.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
    if (!response.ok || (data.errcode ?? 0) !== 0)
      throw new ChannelError('refused', `DingTalk said no (${data.errcode ?? response.status}).`);
  }

  async send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const buttons = options?.buttons ?? [];
    const words = buttons.length ? TextChoices.render(markdown, buttons) : markdown;
    const parts = fit(words, PART_CHARS, (p) =>
      Math.max(p.length, Buffer.byteLength(toDingTalkMarkdown(p)) / (PART_BYTES / PART_CHARS)),
    );
    if (!parts.length) parts.push('…');
    const refs: SentRef[] = [];
    for (const part of parts) {
      const text = toDingTalkMarkdown(part) || '…';
      const title = plain(part).split('\n')[0]?.slice(0, 30) || '…';
      refs.push({
        chatId,
        messageId: await this.#deliver(chatId, 'sampleMarkdown', { title, text }),
      });
    }
    const last = refs.at(-1);
    if (last && buttons.length) this.#choices.remember(last, buttons);
    return refs;
  }

  /** Uploaded as media (the token in the address, as DingTalk's older API wants), then sent. */
  async #upload(file: OutboundFile, type: 'image' | 'file'): Promise<string> {
    const token = await this.adapter.accessToken();
    const form = new FormData();
    form.set('type', type);
    form.set('media', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.name);
    const url = `${this.adapter.oapi}/media/upload?access_token=${encodeURIComponent(token)}&type=${type}`;
    const response = await fetch(url, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    }).catch((error: unknown) => {
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach DingTalk (${(error as Error).message}).`, token),
      );
    });
    const data = (await response.json().catch(() => ({}))) as {
      errcode?: number;
      errmsg?: string;
      media_id?: string;
    };
    if (data.media_id && !data.errcode) return data.media_id;
    throw new ChannelError(
      'refused',
      `DingTalk didn’t take ${file.name} (${data.errcode ?? response.status}${data.errmsg ? ` ${redact(data.errmsg, token)}` : ''}).`,
    );
  }

  async sendFiles(chatId: string, files: OutboundFile[], caption?: string): Promise<SentRef[]> {
    const refs: SentRef[] = caption?.trim() ? await this.send(chatId, caption) : [];
    for (const file of files) {
      if (file.image) {
        const mediaId = await this.#upload(file, 'image');
        refs.push({
          chatId,
          messageId: await this.#deliver(chatId, 'sampleImageMsg', { photoURL: mediaId }),
        });
      } else {
        const mediaId = await this.#upload(file, 'file');
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        refs.push({
          chatId,
          messageId: await this.#deliver(chatId, 'sampleFile', {
            mediaId,
            fileName: file.name,
            fileType: ext,
          }),
        });
      }
    }
    return refs;
  }

  /** A picture, recording or file from a message: its download code, exchanged for a short-lived address. */
  async download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(DOWNLOAD_LIMIT, options);
    let code: string | undefined;
    try {
      code = (JSON.parse(file.ref) as { c?: string }).c;
    } catch {
      code = undefined;
    }
    if (!code) throw new ChannelError('refused', 'That file’s address isn’t one Conch recognises.');
    const found = await this.adapter.request<{ downloadUrl?: string }>(
      'POST',
      '/v1.0/robot/messageFiles/download',
      { downloadCode: code, robotCode: this.adapter.robotCode },
    );
    const url = found.downloadUrl;
    if (!url || !dingtalkHost(url, this.files))
      throw new ChannelError('refused', 'That file isn’t on DingTalk’s own servers.');
    const response = await fetch(url, {
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
    const bytes = await readCapped(response, cap, 'That file is too big to take from DingTalk.');
    const mimeType =
      file.mimeType ?? (response.headers.get('content-type')?.split(';')[0] || undefined);
    return { name: file.name, bytes, ...(mimeType && { mimeType }) };
  }
}
