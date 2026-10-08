import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ATTACHMENT_LIMITS,
  type ChannelBot,
  type ChannelSecrets,
  TEAMS_APP_ID,
} from '@conch/protocol';
import { convert } from 'html-to-text';

import type { ChannelEndpoints } from './adapters';
import type { HookReply, HookRequest } from './door';
import { fit, toChatHtml } from './format';
import {
  BOT_FRAMEWORK_OPENID,
  BotFrameworkKeys,
  TeamsAuthError,
  verifyActivity,
} from './teams-auth';
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
  pause,
  personId,
  redact,
  capOf,
  readCapped,
} from './types';
import { writeFileAtomic } from '../lib/fs';

type TeamsSecrets = Extract<ChannelSecrets, { kind: 'microsoftteams' }>;

export const MICROSOFT_LOGIN = 'https://login.microsoftonline.com';
/** Teams takes messages up to 100 KB; parts this long stay far below it as HTML. */
const PART = 12_000;
/** What Conch keeps of one file (ATTACHMENT_LIMITS): more would only be refused after downloading it. */
const FILE_LIMIT = ATTACHMENT_LIMITS.maxBytes;
/**
 * A picture a bot puts in a personal chat goes inside the message itself
 * (a data: address), which Teams takes up to 1 MB, in PNG, JPEG or GIF. Any
 * other file needs the person to accept it into their OneDrive first (a
 * consent card), which Conch doesn't do: those are refused, honestly.
 */
const PICTURE_LIMIT = 1024 * 1024;
const PICTURE_TYPES = /^image\/(?:png|jpeg|gif)$/;

/** One key set for every Teams channel: they're Microsoft's, not the bot's. */
const sharedKeys = new Map<string, BotFrameworkKeys>();

interface Activity {
  type?: string;
  id?: string;
  channelId?: string;
  serviceUrl?: string;
  text?: string;
  value?: unknown;
  from?: { id?: string; name?: string; aadObjectId?: string };
  recipient?: { id?: string; name?: string };
  conversation?: { id?: string; conversationType?: string; tenantId?: string; isGroup?: boolean };
  channelData?: { tenant?: { id?: string } };
  attachments?: { contentType?: string; contentUrl?: string; name?: string; content?: unknown }[];
}

/** Where a conversation lives, learned from the activities in it. */
interface Conversation {
  serviceUrl: string;
  /** The person's Teams id (`29:…`), for opening a chat with them later. */
  user?: string;
  tenantId?: string;
}

interface TeamsMemory {
  /** The bot's name as Teams shows it. */
  name?: string;
  conversations: Record<string, Conversation>;
  /** Each person's private chat, by their Entra object id. */
  people: Record<string, string>;
}

/**
 * Microsoft's connector servers, the only places Conch sends the bot's token
 * (a forged `serviceUrl` would otherwise collect it).
 */
export function connectorAllowed(url: string, extra: string[] = []): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (extra.some((base) => url.startsWith(base))) return true;
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === 'smba.trafficmanager.net' ||
    host.endsWith('.botframework.com') ||
    host.endsWith('.teams.microsoft.com') ||
    host.endsWith('.teams.microsoft.us') ||
    host.endsWith('.botframework.azure.us')
  );
}

/** Find the App ID in whatever was pasted, and keep the channel's address across a new secret. */
export function normalizeTeams(secrets: TeamsSecrets, kept?: TeamsSecrets): TeamsSecrets {
  const tenant = secrets.tenantId?.trim();
  return {
    kind: 'microsoftteams',
    appId: (TEAMS_APP_ID.exec(secrets.appId)?.[1] ?? secrets.appId.trim()).toLowerCase(),
    appPassword: secrets.appPassword.trim(),
    ...(tenant && { tenantId: TEAMS_APP_ID.exec(tenant)?.[1]?.toLowerCase() ?? tenant }),
    // Made here, never taken from the page: the unguessable part of the address.
    hookId: kept?.hookId ?? randomBytes(18).toString('base64url'),
  };
}

/**
 * Microsoft Teams, through the Bot Framework. Teams only delivers to a
 * public HTTPS address, so this channel comes in through the public door
 * (ADR 0045) at `/hooks/<id>`; every delivery's JWT is checked
 * (`teams-auth.ts`) before a word of it is read. Answers go back through the
 * Bot Connector with the bot's own token (client credentials, refreshed
 * before it expires), only ever to Microsoft's connector hosts.
 *
 * Healing: the token is renewed by itself; a refused secret asks for a new
 * one, naming whether it expired; a single-tenant bot that needs its tenant
 * says so; deliveries are acknowledged at once, so Teams never retries one
 * that took long to answer; the bot's name, and where each person's chat
 * lives, are remembered across restarts so routine results still reach you.
 */
export class TeamsAdapter implements ChannelAdapter {
  readonly kind = 'microsoftteams' as const;
  #token?: { value: string; expiresAt: number };
  #memory?: TeamsMemory;

  constructor(
    private readonly secrets: TeamsSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get #hookId() {
    return this.secrets.hookId ?? '';
  }

  get #keys(): BotFrameworkKeys {
    const metadata = this.endpoints.teamsOpenId ?? BOT_FRAMEWORK_OPENID;
    let keys = sharedKeys.get(metadata);
    if (!keys) {
      keys = new BotFrameworkKeys(metadata);
      sharedKeys.set(metadata, keys);
    }
    return keys;
  }

  // ── The bot's own token ────────────────────────────────────────────────

  async token(signal?: AbortSignal): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now() + 5 * 60_000) return this.#token.value;
    if (!TEAMS_APP_ID.test(this.secrets.appId))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a Microsoft App ID. It’s a long code like 1a2b3c4d-…, on the bot’s page.',
        { field: 'appId' },
      );
    const tenant = this.secrets.tenantId || 'botframework.com';
    const login = this.endpoints.teamsLogin ?? MICROSOFT_LOGIN;
    let response: Response;
    try {
      response = await fetch(`${login}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.secrets.appId,
          client_secret: this.secrets.appPassword,
          scope: 'https://api.botframework.com/.default',
        }),
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach Microsoft (${(error as Error).message}).`, this.secrets.appPassword),
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (response.ok && body.access_token) {
      this.#token = {
        value: body.access_token,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      };
      return body.access_token;
    }
    const said = body.error_description ?? '';
    if (/AADSTS7000222/.test(said))
      throw new ChannelError(
        'auth',
        'That client secret has expired. Make a new one on the bot’s page.',
        {
          field: 'appPassword',
        },
      );
    if (/AADSTS7000215|AADSTS7000218/.test(said))
      throw new ChannelError(
        'auth',
        'Microsoft doesn’t accept that client secret. Copy its Value (not its Secret ID).',
        { field: 'appPassword' },
      );
    if (/AADSTS700016/.test(said))
      throw new ChannelError(
        'auth',
        this.secrets.tenantId
          ? 'Microsoft doesn’t know a bot with that App ID in that directory. Check both on the bot’s page.'
          : 'This bot belongs to your organisation only (single-tenant). Paste its Directory (tenant) ID too: it’s on the bot’s Overview page.',
        { field: this.secrets.tenantId ? 'appId' : 'tenantId' },
      );
    if (/AADSTS90002|AADSTS900023/.test(said))
      throw new ChannelError('auth', 'Microsoft doesn’t know that directory (tenant) ID.', {
        field: 'tenantId',
      });
    if (response.status === 429)
      throw new ChannelError('rate-limit', 'Microsoft asked Conch to slow down.', {
        retryAfterMs: Number(response.headers.get('retry-after') ?? 5) * 1000,
      });
    if (response.status >= 500)
      throw new ChannelError('network', `Microsoft had a problem (${response.status}).`);
    throw new ChannelError(
      'auth',
      `Microsoft refused the bot’s sign-in (${body.error ?? response.status}).`,
      { field: 'appPassword' },
    );
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    await this.token(signal);
    const memory = await this.#remember();
    return {
      id: this.secrets.appId,
      name: memory.name ?? 'Teams bot',
      chatUrl: `https://teams.microsoft.com/l/chat/0/0?users=28:${this.secrets.appId}`,
    };
  }

  hook() {
    const url = this.endpoints.door?.hookUrl(this.#hookId);
    return url ? { url } : {};
  }

  async forget() {
    const path = this.#memoryPath();
    if (path) await import('node:fs/promises').then((fs) => fs.rm(path, { force: true }));
  }

  // ── What it remembers ──────────────────────────────────────────────────

  #memoryPath() {
    const home = this.endpoints.home;
    return home && this.#hookId ? join(home, 'channels', `teams-${this.#hookId}.json`) : undefined;
  }

  async #remember(): Promise<TeamsMemory> {
    if (this.#memory) return this.#memory;
    const path = this.#memoryPath();
    let memory: TeamsMemory = { conversations: {}, people: {} };
    if (path)
      try {
        const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<TeamsMemory>;
        memory = {
          ...(typeof raw.name === 'string' && { name: raw.name }),
          conversations: {},
          people: {},
        };
        for (const [id, c] of Object.entries(raw.conversations ?? {}))
          if (
            c &&
            typeof c.serviceUrl === 'string' &&
            connectorAllowed(c.serviceUrl, this.endpoints.teamsConnectors)
          )
            memory.conversations[id] = c;
        for (const [who, id] of Object.entries(raw.people ?? {}))
          if (typeof id === 'string') memory.people[who] = id;
      } catch {
        // Missing or damaged: it's learned again from the next message.
      }
    this.#memory = memory;
    return memory;
  }

  async #save() {
    const path = this.#memoryPath();
    if (path && this.#memory) await writeFileAtomic(path, `${JSON.stringify(this.#memory)}\n`);
  }

  // ── Connection ─────────────────────────────────────────────────────────

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    const door = this.endpoints.door;
    const unmount = door?.mount(this.#hookId, 'microsoftteams', (request) =>
      this.#deliver(request, events),
    );
    const offDoor = door?.onChange(() => {
      events.changed?.();
      void this.#health(events, stop.signal);
    });
    void this.#run(events, stop.signal);
    return {
      send: (chatId, markdown, options) => this.#send(chatId, markdown, options),
      edit: (ref, markdown) => this.#edit(ref, markdown),
      typing: (chatId) => this.#activity(chatId, { type: 'typing' }).then(() => undefined),
      files: {
        maxBytes: PICTURE_LIMIT,
        accepts: (file) => file.image && PICTURE_TYPES.test(file.mimeType),
        send: (chatId, files, caption) => this.#sendPictures(chatId, files, caption),
      },
      download: (file, options) => this.#download(file, options),
      directChat: (userId) => this.#directChat(appId(userId)),
      close: () => {
        stop.abort();
        unmount?.();
        offDoor?.();
      },
    };
  }

  /** Check the bot's sign-in until it works, then say how the door is. */
  async #run(events: ChannelEvents, signal: AbortSignal) {
    events.state('connecting');
    const backoff = new Backoff();
    while (!signal.aborted) {
      try {
        await this.token(signal);
        await this.#health(events, signal);
        return;
      } catch (error) {
        if (signal.aborted) return;
        const failure =
          error instanceof ChannelError ? error : new ChannelError('network', String(error));
        if (failure.code === 'auth') {
          events.state('needs-token', { message: failure.message });
          return;
        }
        const wait = failure.detail?.retryAfterMs ?? backoff.next();
        events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
        await pause(wait, signal);
      }
    }
  }

  async #health(events: ChannelEvents, signal: AbortSignal) {
    if (signal.aborted || !this.#token) return;
    const door = this.endpoints.door?.status();
    if (door?.state === 'ready') events.state('online');
    else
      events.state('error', {
        message:
          door?.state === 'starting'
            ? 'Turning on the public address Teams delivers to…'
            : 'Teams can’t reach Conch yet: turn on its public address on this channel’s page.',
      });
  }

  async #deliver(request: HookRequest, events: ChannelEvents): Promise<HookReply> {
    if (request.method !== 'POST') return { status: 405, body: 'Not allowed.' };
    let activity: Activity;
    try {
      activity = JSON.parse(request.body) as Activity;
    } catch {
      return { status: 400, body: 'Not accepted.' };
    }
    if (!activity || typeof activity !== 'object') return { status: 400, body: 'Not accepted.' };
    try {
      await verifyActivity(request.headers.authorization, activity, this.secrets.appId, this.#keys);
    } catch (error) {
      if (error instanceof TeamsAuthError) return { status: 401, body: 'Not authorised.' };
      throw error;
    }
    if (
      !activity.serviceUrl ||
      !connectorAllowed(activity.serviceUrl, this.endpoints.teamsConnectors)
    )
      return { status: 403, body: 'Not accepted.' };
    events.heard?.();
    // Acknowledged at once; the answer goes back through the connector.
    void this.#activityIn(activity, events).catch(() => undefined);
    return { status: 200, body: '' };
  }

  async #activityIn(activity: Activity, events: ChannelEvents) {
    const conversation = activity.conversation?.id;
    if (!conversation || !activity.serviceUrl) return;
    const memory = await this.#remember();
    const tenantId = activity.conversation?.tenantId ?? activity.channelData?.tenant?.id;
    const direct =
      activity.conversation?.conversationType === 'personal' ||
      (activity.conversation?.conversationType === undefined &&
        activity.conversation?.isGroup !== true);
    const before = JSON.stringify(memory);
    memory.conversations[conversation] = {
      serviceUrl: activity.serviceUrl,
      ...(activity.from?.id && { user: activity.from.id }),
      ...(tenantId && { tenantId }),
    };
    if (activity.recipient?.name) memory.name = activity.recipient.name;
    const who = activity.from?.aadObjectId ?? activity.from?.id;
    if (direct && who) memory.people[who] = conversation;
    if (JSON.stringify(memory) !== before) await this.#save().catch(() => undefined);
    if (activity.type !== 'message' || !who) return;
    const user = { id: personId(who), name: activity.from?.name || 'Someone' };
    const value = activity.value as { conch?: unknown } | undefined;
    if (value && typeof value.conch === 'string') {
      events.press({
        chatId: conversation,
        user,
        data: value.conch,
        message: {
          chatId: conversation,
          messageId: (activity as { replyToId?: string }).replyToId ?? '',
        },
        ack: () => Promise.resolve(),
      });
      return;
    }
    const files: ChannelFile[] = [];
    for (const attachment of activity.attachments ?? []) {
      const content = attachment.content as { downloadUrl?: string; fileType?: string } | undefined;
      if (
        attachment.contentType === 'application/vnd.microsoft.teams.file.download.info' &&
        content?.downloadUrl
      )
        files.push({
          name: attachment.name ?? 'file',
          ref: JSON.stringify({ url: content.downloadUrl, auth: false }),
        });
      else if (attachment.contentType?.startsWith('image/') && attachment.contentUrl)
        files.push({
          name: attachment.name ?? `picture.${attachment.contentType.split('/')[1] ?? 'png'}`,
          mimeType: attachment.contentType,
          ref: JSON.stringify({ url: attachment.contentUrl, auth: true }),
        });
    }
    events.message({
      chatId: conversation,
      messageId: activity.id ?? '',
      user,
      // Teams' command menu sends the bare word.
      text: teamsText(activity.text ?? '').replace(/^(new|stop|help)$/i, '/$1'),
      files,
      direct,
    });
  }

  // ── What goes out ──────────────────────────────────────────────────────

  async #connector<T>(
    method: 'POST' | 'PUT',
    url: string,
    body: unknown,
    retried = false,
  ): Promise<T> {
    if (!connectorAllowed(url, this.endpoints.teamsConnectors))
      throw new ChannelError('refused', 'That isn’t one of Microsoft’s Teams servers.');
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${await this.token()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
    } catch (error) {
      if (error instanceof ChannelError) throw error;
      throw new ChannelError('network', `Couldn’t reach Teams (${(error as Error).message}).`);
    }
    if (response.ok) return (await response.json().catch(() => ({}))) as T;
    if ((response.status === 401 || response.status === 403) && !retried) {
      // A token Teams stopped liking: a fresh one, once.
      this.#token = undefined;
      return this.#connector(method, url, body, true);
    }
    if (response.status === 429)
      throw new ChannelError('rate-limit', 'Teams asked Conch to slow down.', {
        retryAfterMs: Number(response.headers.get('retry-after') ?? 2) * 1000,
      });
    if (response.status >= 500)
      throw new ChannelError('network', `Teams had a problem (${response.status}).`);
    if (response.status === 401 || response.status === 403)
      throw new ChannelError('auth', 'Teams doesn’t accept this bot’s sign-in any more.', {
        field: 'appPassword',
      });
    throw new ChannelError('refused', `Teams said no (${response.status}).`);
  }

  async #where(chatId: string) {
    const conversation = (await this.#remember()).conversations[chatId];
    if (!conversation) throw new ChannelError('refused', 'Conch doesn’t know that Teams chat yet.');
    return `${conversation.serviceUrl.replace(/\/+$/, '')}/v3/conversations/${encodeURIComponent(chatId)}/activities`;
  }

  #activity(chatId: string, activity: Record<string, unknown>) {
    return this.#where(chatId).then((url) =>
      this.#connector<{ id?: string }>('POST', url, activity),
    );
  }

  async #send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const parts = fit(markdown, PART, (part) => toChatHtml(part).length);
    const sent: SentRef[] = [];
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      const posted = await this.#withRetry(() =>
        this.#activity(chatId, {
          type: 'message',
          textFormat: 'xml',
          text: toChatHtml(part),
          ...(last && options?.buttons?.length && { attachments: [card(options)] }),
        }),
      );
      sent.push({ chatId, messageId: posted.id ?? '' });
    }
    return sent;
  }

  /** Pictures in one message, the caption above them; nothing goes if any file isn't a picture Teams shows. */
  async #sendPictures(chatId: string, files: OutboundFile[], caption?: string): Promise<SentRef[]> {
    const other = files.filter((f) => !f.image || !PICTURE_TYPES.test(f.mimeType));
    if (other.length)
      throw new ChannelError(
        'refused',
        `Teams only takes pictures from Conch (PNG, JPEG or GIF, up to 1 MB), so ${other.map((f) => f.name).join(', ')} can’t go there. Nothing was sent.`,
      );
    const text = caption ? (fit(caption, PART, (p) => toChatHtml(p).length)[0] ?? '') : '';
    const posted = await this.#withRetry(() =>
      this.#activity(chatId, {
        type: 'message',
        textFormat: 'xml',
        text: text ? toChatHtml(text) : '',
        attachments: files.map((file) => ({
          contentType: file.mimeType,
          contentUrl: `data:${file.mimeType};base64,${file.bytes.toString('base64')}`,
          name: file.name,
        })),
      }),
    );
    return [{ chatId, messageId: posted.id ?? '' }];
  }

  async #edit(ref: SentRef, markdown: string) {
    if (!ref.messageId) return;
    const url = `${await this.#where(ref.chatId)}/${encodeURIComponent(ref.messageId)}`;
    const part = fit(markdown, PART, (p) => toChatHtml(p).length)[0] ?? '…';
    await this.#connector('PUT', url, {
      type: 'message',
      id: ref.messageId,
      textFormat: 'xml',
      text: toChatHtml(part),
      attachments: [],
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
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(error.detail?.retryAfterMs ?? 1500, 30_000)),
      );
      return fn();
    }
  }

  async #download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(FILE_LIMIT, options);
    let ref: { url?: string; auth?: boolean };
    try {
      ref = JSON.parse(file.ref) as typeof ref;
    } catch {
      throw new ChannelError('refused', 'That file’s address isn’t one Conch recognises.');
    }
    const url = ref.url ?? '';
    let host = '';
    try {
      const parsed = new URL(url);
      host = parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : '';
    } catch {
      host = '';
    }
    // Files in a chat live in OneDrive (a link that needs no key); pictures, with Teams (the bot's token).
    const sharepoint = /(^|\.)sharepoint(-df)?\.com$/.test(host);
    const teams =
      connectorAllowed(url, this.endpoints.teamsConnectors) || /(^|\.)asm\.skype\.com$/.test(host);
    if (ref.auth ? !teams : !sharepoint)
      throw new ChannelError('refused', 'That file isn’t on Microsoft’s own servers.');
    const response = await fetch(url, {
      headers: ref.auth ? { authorization: `Bearer ${await this.token()}` } : {},
      signal: AbortSignal.timeout(60_000),
    }).catch((error: unknown) => {
      throw new ChannelError(
        'network',
        `Couldn’t download that file (${(error as Error).message}).`,
      );
    });
    if (!response.ok)
      throw new ChannelError('network', `Couldn’t download that file (${response.status}).`);
    const bytes = await readCapped(response, cap, 'That file is too big to take from Teams.');
    const type = response.headers.get('content-type') ?? file.mimeType;
    return { name: file.name, bytes, ...(type && { mimeType: type }) };
  }

  /** The private chat with someone: the one they wrote in, or a new one (Teams allows it for people in the bot's tenant). */
  async #directChat(who: string): Promise<string> {
    const memory = await this.#remember();
    const known = memory.people[who];
    if (known && memory.conversations[known]) return known;
    const any = Object.values(memory.conversations).find((c) => c.user);
    if (!any?.user) throw new ChannelError('refused', 'Say hello to the bot in Teams first.');
    const created = await this.#connector<{ id?: string }>(
      'POST',
      `${any.serviceUrl.replace(/\/+$/, '')}/v3/conversations`,
      {
        bot: { id: `28:${this.secrets.appId}` },
        members: [{ id: any.user }],
        isGroup: false,
        ...(any.tenantId && {
          tenantId: any.tenantId,
          channelData: { tenant: { id: any.tenantId } },
        }),
      },
    );
    if (!created.id)
      throw new ChannelError('refused', 'Teams didn’t open a chat with that person.');
    memory.conversations[created.id] = any;
    memory.people[who] = created.id;
    await this.#save().catch(() => undefined);
    return created.id;
  }
}

/** Approval buttons, as an Adaptive Card (Action.Submit posts its `data` back as a message). */
function card(options: SendOptions) {
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [],
      actions: (options.buttons ?? []).map((button) => ({
        type: 'Action.Submit',
        title: button.label,
        data: { conch: button.data },
        ...(button.style && { style: button.style === 'primary' ? 'positive' : 'destructive' }),
      })),
    },
  };
}

/**
 * Teams markup as plain text. This is not an HTML sanitizer: render its result
 * as text, or escape it when creating an outbound HTML message.
 */
export function teamsText(text: string): string {
  return convert(text, {
    wordwrap: false,
    preserveNewlines: true,
    limits: { maxInputLength: 100_000, maxDepth: 30, maxChildNodes: 5000 },
    selectors: [
      { selector: 'at', format: 'skip' },
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  }).trim();
}
