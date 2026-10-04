import type { ChannelBot, ChannelCheck } from '@conch/protocol';

import { fit, toSlackMrkdwn } from './format';
import type { SlackCheck } from './service';
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

export const SLACK_API = 'https://slack.com/api';
/** A Slack app's id, as its settings pages' addresses use it. */
const SLACK_APP_ID = /^A[A-Z0-9]{6,20}$/;

/** A section of mrkdwn holds 3000 characters; parts this long stay under it once formatted. */
const PART = 2800;
const FILE_LIMIT = 50 * 1024 * 1024;
/** Open a fresh socket this often, so one that died quietly is replaced. */
const RENEW_MS = 10 * 60_000;
/** How long a part is as Slack counts it, whichever way it ends up written. */
const slackLength = (part: string) => Math.max(part.length, toSlackMrkdwn(part).length);
const AUTH_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'no_permission',
]);

interface SlackResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface Envelope {
  type: string;
  envelope_id?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}

/** The bot token must be the app's own (xoxb-); say plainly what was pasted instead. */
function checkBotToken(token: string) {
  if (token.startsWith('xoxb-')) return;
  if (token.startsWith('xoxp-') || token.startsWith('xoxe'))
    throw new ChannelError(
      'auth',
      'That’s a key for your own account. Use the app’s Bot User OAuth Token, which starts with xoxb-.',
      { field: 'botToken' },
    );
  if (token.startsWith('xapp-'))
    throw new ChannelError('auth', 'That’s the app-level token. The bot token starts with xoxb-.', {
      field: 'botToken',
    });
  throw new ChannelError(
    'auth',
    'That doesn’t look like a Slack bot token. It starts with xoxb- and is on the Install App page.',
    { field: 'botToken' },
  );
}

function checkAppToken(token: string) {
  if (token.startsWith('xapp-')) return;
  throw new ChannelError(
    'auth',
    token.startsWith('xoxb-')
      ? 'That’s the bot token. The app-level token starts with xapp-.'
      : 'That doesn’t look like an app-level token. It starts with xapp- and is under Basic Information → App-Level Tokens.',
    { field: 'appToken' },
  );
}

/**
 * Slack, through Socket Mode: Conch opens a WebSocket to Slack, so no public
 * address is needed. Only direct messages with the app are read.
 *
 * Healing: Slack's routine "please reconnect" is followed at once; drops are
 * retried with backoff; a key that stops working asks for a new one; Socket
 * Mode switched off in the app's settings is named with the switch to flip;
 * keys pasted into each other's boxes are put right, and keys from two
 * different apps are caught before they're saved. Slack has no typing
 * indicator for bots, so a 👀 on your message says it's being worked on.
 */
export class SlackAdapter implements ChannelAdapter, SlackCheck {
  readonly kind = 'slack' as const;
  /** Mentions and replies in groups are told apart (ADR 0075). */
  readonly groups = true;
  #names = new Map<string, ChannelUser>();
  #dms = new Map<string, string>();
  /** Channels' names, for the groups on its page (ADR 0075). */
  #places = new Map<string, string>();
  /** Markdown blocks render tables and headings; an older workspace gets mrkdwn instead. */
  #markdownBlocks = true;

  constructor(
    private readonly botToken: string,
    private readonly appToken: string,
    private readonly api = SLACK_API,
  ) {}

  async web<T extends SlackResponse>(
    method: string,
    params: Record<string, unknown> = {},
    options: { token?: string; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const token = options.token ?? this.botToken;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
      if (value !== undefined)
        body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    let response: Response;
    try {
      response = await fetch(`${this.api}/${method}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body,
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach Slack (${(error as Error).message}).`, this.botToken, this.appToken),
      );
    }
    if (response.status === 429)
      throw new ChannelError('rate-limit', 'Slack asked Conch to slow down.', {
        retryAfterMs: Number(response.headers.get('retry-after') ?? 2) * 1000,
      });
    if (response.status >= 500)
      throw new ChannelError('network', `Slack had a problem (${response.status}).`);
    const data = (await response.json().catch(() => ({ ok: false, error: 'bad_response' }))) as T;
    if (data.ok) return data;
    const error = data.error ?? 'unknown_error';
    if (AUTH_ERRORS.has(error)) {
      const app = token === this.appToken;
      throw new ChannelError(
        'auth',
        app
          ? 'Slack doesn’t accept this app-level token. Make a new one under Basic Information → App-Level Tokens.'
          : 'Slack doesn’t accept this bot token. Copy it again from the Install App page.',
        { field: app ? 'appToken' : 'botToken' },
      );
    }
    if (error === 'missing_scope')
      throw new ChannelError(
        'setup',
        'The Slack app is missing a permission. Open the app’s settings and press Reinstall to Workspace.',
      );
    if (error === 'messages_tab_disabled')
      throw new ChannelError(
        'setup',
        'Messages to the app are turned off. In the app’s settings, open App Home and allow messages in the Messages tab.',
      );
    throw new ChannelError('refused', `Slack said no (${error}).`);
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    checkBotToken(this.botToken);
    checkAppToken(this.appToken);
    const bot = await this.#bot(signal);
    const socketApp = await this.#socketApp(signal);
    if (socketApp && bot.appId && socketApp !== bot.appId)
      throw new ChannelError(
        'auth',
        'These two keys come from different Slack apps. Copy both from the same app.',
        { field: 'appToken' },
      );
    return bot.view;
  }

  /** Check whichever keys are here so far (the page checks each as it's pasted). */
  async checkSlack(parts: { botToken?: string; appToken?: string }): Promise<ChannelCheck> {
    const checked: ('botToken' | 'appToken')[] = [];
    try {
      let bot: { view: ChannelBot; appId?: string } | undefined;
      let socketApp: string | undefined;
      if (parts.botToken) {
        checkBotToken(this.botToken);
        bot = await this.#bot(AbortSignal.timeout(20_000));
        checked.push('botToken');
      }
      if (parts.appToken) {
        checkAppToken(this.appToken);
        socketApp = await this.#socketApp(AbortSignal.timeout(20_000));
        if (bot?.appId && socketApp && bot.appId !== socketApp)
          throw new ChannelError(
            'auth',
            'These two keys come from different Slack apps. Copy both from the same app.',
            { field: 'appToken' },
          );
        checked.push('appToken');
      }
      // The app's id, for links straight to its settings pages (never a secret).
      const appId = [bot?.appId, socketApp].find((id) => id && SLACK_APP_ID.test(id));
      return {
        ok: true,
        bot: bot?.view ?? { id: '', name: 'Slack app' },
        checked,
        ...(appId && { appId }),
      };
    } catch (error) {
      const failure = error instanceof ChannelError ? error : undefined;
      return {
        ok: false,
        ...(failure?.detail?.field && { field: failure.detail.field }),
        message: failure?.message ?? 'Couldn’t check that with Slack.',
      };
    }
  }

  async #bot(signal?: AbortSignal) {
    const auth = await this.web<
      SlackResponse & {
        team?: string;
        team_id?: string;
        user_id?: string;
        user?: string;
        bot_id?: string;
      }
    >('auth.test', {}, { signal });
    if (!auth.bot_id)
      throw new ChannelError(
        'auth',
        'That’s a key for your own account. Use the app’s Bot User OAuth Token, which starts with xoxb-.',
        { field: 'botToken' },
      );
    const info = await this.web<
      SlackResponse & { bot?: { app_id?: string; name?: string; icons?: { image_72?: string } } }
    >('bots.info', { bot: auth.bot_id }, { signal }).catch(() => undefined);
    const appId = info?.bot?.app_id;
    const avatar = await this.#avatar(info?.bot?.icons?.image_72).catch(() => undefined);
    const view: ChannelBot = {
      id: auth.user_id ?? auth.bot_id,
      name: info?.bot?.name ?? auth.user ?? 'Slack app',
      ...(auth.user && { username: auth.user }),
      ...(auth.team && { workspace: auth.team }),
      ...(appId &&
        auth.team_id && {
          chatUrl: `https://slack.com/app_redirect?app=${appId}&team=${auth.team_id}`,
        }),
      ...(avatar && { avatar }),
    };
    return { view, appId };
  }

  async #avatar(url: string | undefined): Promise<string | undefined> {
    if (!url) return undefined;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !/(^|\.)slack-edge\.com$/.test(parsed.hostname))
      return undefined;
    const response = await fetch(parsed, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    return dataUrl(
      Buffer.from(await response.arrayBuffer()),
      response.headers.get('content-type') ?? 'image/png',
    );
  }

  /** The app the app-level token belongs to (from the socket address Slack hands out). */
  async #socketApp(signal?: AbortSignal): Promise<string | undefined> {
    const open = await this.web<SlackResponse & { url?: string }>(
      'apps.connections.open',
      {},
      { token: this.appToken, signal },
    );
    try {
      return new URL(open.url ?? '').searchParams.get('app_id') ?? undefined;
    } catch {
      return undefined;
    }
  }

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    void this.#run(events, stop.signal);
    return {
      send: (chatId, markdown, options) => this.#send(chatId, markdown, options),
      edit: async (ref, markdown, options) => {
        const part = fit(markdown, PART, slackLength)[0] ?? '…';
        await this.#posting((blocks) =>
          this.web('chat.update', {
            channel: ref.chatId,
            ts: ref.messageId,
            text: part,
            blocks: blocks(part, options),
          }),
        );
      },
      // Slack has no typing indicator for bots; `seen` does the job.
      typing: () => Promise.resolve(),
      seen: async (ref, working) => {
        await this.web(working ? 'reactions.add' : 'reactions.remove', {
          channel: ref.chatId,
          timestamp: ref.messageId,
          name: 'eyes',
        }).catch(() => undefined);
      },
      download: (file) => this.#download(file),
      directChat: (userId) => this.#directChat(userId),
      close: () => stop.abort(),
    };
  }

  async #directChat(userId: string): Promise<string> {
    const known = this.#dms.get(userId);
    if (known) return known;
    const open = await this.web<SlackResponse & { channel?: { id: string } }>(
      'conversations.open',
      {
        users: userId,
      },
    );
    const id = open.channel?.id;
    if (!id) throw new ChannelError('refused', 'Slack didn’t open a chat with that person.');
    this.#dms.set(userId, id);
    return id;
  }

  async #send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const parts = fit(markdown, PART, slackLength);
    const sent: SentRef[] = [];
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      const posted = await this.#posting((blocks) =>
        this.web<SlackResponse & { ts?: string }>('chat.postMessage', {
          channel: chatId,
          text: part,
          blocks: blocks(part, last ? options : undefined),
          unfurl_links: false,
        }),
      );
      sent.push({ chatId, messageId: posted.ts ?? '' });
    }
    return sent;
  }

  /** Post with Markdown blocks; if this workspace refuses them, with mrkdwn from then on. */
  async #posting<T>(
    post: (blocks: (text: string, options?: SendOptions) => unknown[]) => Promise<T>,
  ) {
    const build = (markdown: boolean) => (text: string, options?: SendOptions) => [
      markdown
        ? { type: 'markdown', text }
        : { type: 'section', text: { type: 'mrkdwn', text: toSlackMrkdwn(text) || ' ' } },
      ...(options?.buttons?.length
        ? [
            {
              type: 'actions',
              elements: options.buttons.map((button) => ({
                type: 'button',
                text: { type: 'plain_text', text: button.label.slice(0, 75) },
                action_id: button.data.slice(0, 255),
                value: button.data,
                ...(button.style && { style: button.style }),
              })),
            },
          ]
        : []),
    ];
    if (this.#markdownBlocks) {
      try {
        return await post(build(true));
      } catch (error) {
        if (!(error instanceof ChannelError) || !/invalid_blocks/.test(error.message)) throw error;
        this.#markdownBlocks = false;
      }
    }
    return post(build(false));
  }

  async #download(file: ChannelFile) {
    let url: URL;
    try {
      url = new URL(file.ref);
    } catch {
      throw new ChannelError('refused', 'That file’s address isn’t one Conch recognises.');
    }
    // Only Slack's own file servers get the key.
    if (url.protocol !== 'https:' || !/(^|\.)slack\.com$/.test(url.hostname))
      throw new ChannelError('refused', 'That file isn’t on Slack’s own servers.');
    if (file.size && file.size > FILE_LIMIT)
      throw new ChannelError('refused', 'That file is too big to take from Slack.');
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.botToken}` },
      signal: AbortSignal.timeout(60_000),
    }).catch((error: unknown) => {
      throw new ChannelError(
        'network',
        `Couldn’t download that file (${(error as Error).message}).`,
      );
    });
    if (!response.ok)
      throw new ChannelError('network', `Couldn’t download that file (${response.status}).`);
    // Without the files:read permission Slack answers with its sign-in page, not the file.
    if ((response.headers.get('content-type') ?? '').includes('text/html'))
      throw new ChannelError(
        'setup',
        'Slack sent a sign-in page instead of the file. Open the app’s settings and press Reinstall to Workspace.',
      );
    return {
      name: file.name,
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: file.mimeType,
    };
  }

  async #person(id: string): Promise<ChannelUser> {
    const known = this.#names.get(id);
    if (known) return known;
    const info = await this.web<
      SlackResponse & {
        user?: {
          name?: string;
          real_name?: string;
          profile?: { display_name?: string; real_name?: string };
        };
      }
    >('users.info', { user: id }).catch(() => undefined);
    const user = info?.user;
    const found: ChannelUser = {
      id,
      name:
        user?.profile?.real_name ||
        user?.real_name ||
        user?.profile?.display_name ||
        user?.name ||
        'Someone',
      ...(user?.name && { username: user.name }),
    };
    this.#names.set(id, found);
    return found;
  }

  // ── Socket Mode ────────────────────────────────────────────────────────

  async #run(events: ChannelEvents, signal: AbortSignal) {
    const backoff = new Backoff();
    events.state('connecting');
    while (!signal.aborted) {
      let url: string | undefined;
      try {
        const open = await this.web<SlackResponse & { url?: string }>(
          'apps.connections.open',
          {},
          { token: this.appToken, signal },
        );
        url = open.url;
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ChannelError && error.code === 'auth') {
          events.state('needs-token', { message: error.message });
          return;
        }
        const wait =
          (error instanceof ChannelError ? error.detail?.retryAfterMs : undefined) ??
          backoff.next();
        events.state('reconnecting', {
          message: error instanceof ChannelError ? error.message : 'Couldn’t reach Slack.',
          retryAt: Date.now() + wait,
        });
        await pause(wait, signal);
        continue;
      }
      if (!url) {
        await pause(backoff.next(), signal);
        continue;
      }
      const closed = await this.#session(url, events, signal, () => backoff.reset());
      if (signal.aborted) return;
      if (closed === 'link_disabled') {
        events.state('error', {
          message:
            'Socket Mode was turned off in your Slack app. Open the app’s settings → Socket Mode, turn it on, then press Repair.',
        });
        return;
      }
      // Slack asks apps to reconnect every few hours; that's routine and immediate.
      const wait = closed === 'refresh' ? 0 : backoff.next();
      if (wait)
        events.state('reconnecting', {
          message: 'Reconnecting to Slack.',
          retryAt: Date.now() + wait,
        });
      await pause(wait, signal);
    }
  }

  #session(
    url: string,
    events: ChannelEvents,
    signal: AbortSignal,
    onHello: () => void,
  ): Promise<'refresh' | 'link_disabled' | 'dropped'> {
    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        resolve('dropped');
        return;
      }
      let settled = false;
      // A socket can die quietly (a laptop asleep, a new network) and still look open.
      // Renewing it now and then bounds how long that can go unnoticed.
      const renew = setTimeout(() => {
        socket.close(1000);
        finish('refresh');
      }, RENEW_MS);
      renew.unref?.();
      const finish = (why: 'refresh' | 'link_disabled' | 'dropped') => {
        if (settled) return;
        settled = true;
        clearTimeout(renew);
        signal.removeEventListener('abort', abort);
        resolve(why);
      };
      const abort = () => {
        socket.close(1000);
        finish('dropped');
      };
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('message', (event) => {
        let envelope: Envelope;
        try {
          envelope = JSON.parse(String(event.data)) as Envelope;
        } catch {
          return;
        }
        if (envelope.envelope_id)
          socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        if (envelope.type === 'hello') {
          onHello();
          events.state('online');
        } else if (envelope.type === 'disconnect') {
          socket.close(1000);
          finish(envelope.reason === 'link_disabled' ? 'link_disabled' : 'refresh');
        } else if (envelope.type === 'events_api') {
          void this.#event(envelope.payload, events);
        } else if (envelope.type === 'interactive') {
          void this.#interactive(envelope.payload, events);
        }
      });
      socket.addEventListener('close', () => finish('dropped'));
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) finish('dropped');
      });
    });
  }

  async #event(payload: Record<string, unknown> | undefined, events: ChannelEvents) {
    const event = payload?.event as
      | {
          type?: string;
          channel_type?: string;
          subtype?: string;
          bot_id?: string;
          user?: string;
          text?: string;
          channel?: string;
          ts?: string;
          files?: {
            name?: string;
            url_private_download?: string;
            mimetype?: string;
            size?: number;
          }[];
        }
      | undefined;
    // Mentioned in a channel (ADR 0075): answered there only once you turned that channel on.
    if (event?.type === 'app_mention') {
      if (event.bot_id || !event.user || !event.channel || !event.ts) return;
      const me = (payload?.authorizations as { user_id?: string }[] | undefined)?.[0]?.user_id;
      events.message({
        chatId: event.channel,
        messageId: event.ts,
        user: await this.#person(event.user),
        text: (me ? (event.text ?? '').replaceAll(`<@${me}>`, '') : (event.text ?? '')).trim(),
        files: [],
        direct: false,
        mentioned: true,
        group: await this.#place(event.channel),
      });
      return;
    }
    if (event?.type !== 'message' || event.bot_id || !event.user || !event.channel || !event.ts)
      return;
    if (event.subtype && event.subtype !== 'file_share') return;
    events.message({
      chatId: event.channel,
      messageId: event.ts,
      user: await this.#person(event.user),
      text: event.text ?? '',
      files: (event.files ?? []).flatMap((file) =>
        file.url_private_download
          ? [
              {
                name: file.name ?? 'file',
                ref: file.url_private_download,
                ...(file.mimetype && { mimeType: file.mimetype }),
                ...(file.size !== undefined && { size: file.size }),
              },
            ]
          : [],
      ),
      direct: event.channel_type === 'im',
    });
  }

  /** A channel's name ("#general"), for the groups on its page; Slack may not say without a scope. */
  async #place(channel: string): Promise<string> {
    const known = this.#places.get(channel);
    if (known) return known;
    const info = await this.web<SlackResponse & { channel?: { name?: string } }>(
      'conversations.info',
      {
        channel,
      },
    ).catch(() => undefined);
    const name = info?.channel?.name ? `#${info.channel.name}` : 'A Slack channel';
    if (info?.channel?.name) this.#places.set(channel, name);
    return name;
  }

  async #interactive(payload: Record<string, unknown> | undefined, events: ChannelEvents) {
    if (payload?.type !== 'block_actions') return;
    const user = payload.user as { id: string; name?: string } | undefined;
    const channel = payload.channel as { id: string } | undefined;
    const message = payload.message as { ts: string } | undefined;
    const action = (payload.actions as { value?: string; action_id?: string }[] | undefined)?.[0];
    const data = action?.value ?? action?.action_id;
    if (!user || !channel || !message || !data) return;
    events.press({
      chatId: channel.id,
      user: await this.#person(user.id),
      data,
      message: { chatId: channel.id, messageId: message.ts },
      ack: () => Promise.resolve(),
    });
  }
}
