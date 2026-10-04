/**
 * Mattermost (ADR 0081): a bot account on your Mattermost server, reached
 * over its WebSocket API, which Conch opens itself, so no public address is
 * needed. Mattermost writes Markdown, so answers keep theirs.
 *
 * - **Who it is**: a bot account (System Console → Integrations → Bot
 *   Accounts) and its access token. `GET /api/v4/users/me` checks the token.
 * - **The connection**: `/api/v4/websocket`, authenticated with the
 *   `authentication_challenge` action right after it opens, so the token is
 *   never in an address. `posted` events carry the post, the channel's type
 *   (`D` is a direct message) and who it mentions.
 * - **Groups** (ADR 0075): a channel the bot was added to is a group,
 *   answered only when it's @mentioned and you turned that channel on.
 * - **No buttons**: interactive buttons need Mattermost to reach Conch, so
 *   approvals are a numbered question answered with a number (`TextChoices`).
 * - **Healing**: the socket reconnects with backoff; a missed `hello` or a
 *   dead socket is noticed by pings; a refused token stops this channel only.
 */
import type { ChannelBot, ChannelSecrets } from '@conch/protocol';

import { fit } from './format';
import { TextChoices } from './linked';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelProfile,
  type ChannelUser,
  type SendOptions,
  type SentRef,
  pause,
  redact,
} from './types';

type MattermostSecrets = Extract<ChannelSecrets, { kind: 'mattermost' }>;

/** Mattermost's default post size is 16383 characters; keep well under. */
const PART = 8000;
const FILE_LIMIT = 25 * 1024 * 1024;
/** A ping this often; two without an answer replace the socket. */
const PING_MS = 30_000;

interface MmUser {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  is_bot?: boolean;
  delete_at?: number;
}

interface MmPost {
  id: string;
  channel_id: string;
  user_id: string;
  message: string;
  root_id?: string;
  type?: string;
  file_ids?: string[];
  props?: Record<string, unknown>;
}

/** A server's address as Conch keeps it: `https://chat.example.com`, nothing after the host's path. */
export function serverUrl(raw: string): string | undefined {
  try {
    const trimmed = raw.trim().replace(/\/+$/, '');
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
    // Pasted from a page in it (`/team/channels/town-square`): the server is the origin.
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Find the server and the token in whatever was pasted. */
export function normalizeMattermost(secrets: MattermostSecrets): MattermostSecrets {
  return {
    kind: 'mattermost',
    server: serverUrl(secrets.server) ?? secrets.server.trim(),
    token: /\b([a-z0-9]{26})\b/.exec(secrets.token)?.[1] ?? secrets.token.trim(),
  };
}

const nameOf = (user: MmUser) =>
  [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
  user.nickname ||
  user.username;

/** Mattermost, through a bot account's token and the server's WebSocket. */
export class MattermostAdapter implements ChannelAdapter {
  readonly kind = 'mattermost' as const;
  /** Mentions in channels are told apart (ADR 0075). */
  readonly groups = true;
  #me?: MmUser;
  #people = new Map<string, ChannelUser>();
  #places = new Map<string, string>();
  #dms = new Map<string, string>();

  constructor(private readonly secrets: MattermostSecrets) {}

  get #server(): string {
    const server = serverUrl(this.secrets.server);
    if (!server)
      throw new ChannelError(
        'setup',
        'That isn’t a server address. It looks like https://chat.example.com.',
        { field: 'server' },
      );
    // A key goes over plain HTTP only on this computer or the network at home.
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
    if (!/^[\x21-\x7e]{20,200}$/.test(this.secrets.token))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a bot’s access token. Copy it from the bot’s page (it’s shown once).',
        { field: 'token' },
      );
    let response: Response;
    try {
      response = await fetch(`${server}/api/v4${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.secrets.token}`,
          ...(body !== undefined && { 'content-type': 'application/json' }),
          'x-requested-with': 'XMLHttpRequest',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
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
    if (response.ok) return (await response.json().catch(() => ({}))) as T;
    const said = (await response.json().catch(() => ({}))) as { message?: string; id?: string };
    const message = redact(said.message ?? '', this.secrets.token);
    if (response.status === 401)
      throw new ChannelError(
        'auth',
        'Mattermost doesn’t accept that token. Make a new one on the bot’s page (Integrations → Bot Accounts → Create New Token).',
        { field: 'token' },
      );
    if (response.status === 429)
      throw new ChannelError('rate-limit', 'Mattermost asked Conch to slow down.', {
        retryAfterMs: Number(response.headers.get('x-ratelimit-reset') ?? 1) * 1000 || 1000,
      });
    if (response.status >= 500)
      throw new ChannelError('network', `Mattermost had a problem (${response.status}).`);
    if (response.status === 404 && path === '/users/me')
      throw new ChannelError(
        'setup',
        'There’s no Mattermost at that address. Check it’s the one you open Mattermost at.',
        { field: 'server' },
      );
    if (response.status === 403)
      throw new ChannelError(
        'refused',
        `Mattermost won’t let the bot do that${message ? ` (${message})` : ''}. Add it to the team or channel first.`,
      );
    throw new ChannelError(
      'refused',
      `Mattermost said no (${response.status}${message ? ` ${message}` : ''}).`,
    );
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    const me = await this.call<MmUser>('GET', '/users/me', undefined, signal);
    if (me.delete_at)
      throw new ChannelError('auth', 'That bot account was turned off on the server.', {
        field: 'token',
      });
    this.#me = me;
    const server = this.#server;
    return {
      id: me.id,
      name: nameOf(me),
      username: me.username,
      workspace: new URL(server).host,
      chatUrl: `${server}/messages/@${me.username}`,
    };
  }

  async prepare(profile: ChannelProfile): Promise<void> {
    const me = this.#me ?? (await this.call<MmUser>('GET', '/users/me'));
    if (!me.is_bot) return;
    const who = profile.owner ? `${profile.owner}’s` : 'your';
    await this.call('PUT', `/bots/${me.id}`, {
      username: me.username,
      display_name: profile.assistant,
      description: `${profile.assistant}, ${who} assistant on Conch. Private.`,
    }).catch(() => undefined);
  }

  async #person(id: string): Promise<ChannelUser> {
    const known = this.#people.get(id);
    if (known) return known;
    const user = await this.call<MmUser>('GET', `/users/${encodeURIComponent(id)}`).catch(
      () => undefined,
    );
    const found: ChannelUser = {
      id,
      name: user ? nameOf(user) : 'Someone',
      ...(user?.username && { username: user.username }),
    };
    this.#people.set(id, found);
    return found;
  }

  async #place(channelId: string, given?: string): Promise<string> {
    const known = this.#places.get(channelId);
    if (known) return known;
    const channel = given
      ? undefined
      : await this.call<{ display_name?: string; name?: string }>(
          'GET',
          `/channels/${encodeURIComponent(channelId)}`,
        ).catch(() => undefined);
    const name = given || channel?.display_name || channel?.name;
    const place = name ? `~${name}` : 'A Mattermost channel';
    if (name) this.#places.set(channelId, place);
    return place;
  }

  async #directChat(userId: string): Promise<string> {
    const known = this.#dms.get(userId);
    if (known) return known;
    const me = this.#me ?? (await this.call<MmUser>('GET', '/users/me'));
    const channel = await this.call<{ id: string }>('POST', '/channels/direct', [me.id, userId]);
    this.#dms.set(userId, channel.id);
    return channel.id;
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
        const post = await this.#withRetry(() =>
          this.call<MmPost>('POST', '/posts', { channel_id: chatId, message: part }),
        );
        refs.push({ chatId, messageId: post.id });
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
        await this.call('PUT', `/posts/${encodeURIComponent(ref.messageId)}/patch`, {
          message: fit(words, PART, (p) => p.length)[0] ?? '…',
        });
        if (options?.buttons?.length) choices.remember(ref, options.buttons);
      },
      typing: async (chatId) => {
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify({
              action: 'user_typing',
              seq: Date.now(),
              data: { channel_id: chatId },
            }),
          );
      },
      seen: async (ref, working) => {
        const me = this.#me;
        if (!me) return;
        const path = `/users/${me.id}/posts/${encodeURIComponent(ref.messageId)}/reactions/eyes`;
        if (working)
          await this.call('POST', '/reactions', {
            user_id: me.id,
            post_id: ref.messageId,
            emoji_name: 'eyes',
          });
        else await this.call('DELETE', path);
      },
      download: (file) => this.#download(file),
      directChat: (userId) => this.#directChat(userId),
      close: () => {
        stop.abort();
        socket?.close(1000);
      },
    };
  }

  async #withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof ChannelError)) throw error;
      if (error.code !== 'rate-limit' && error.code !== 'network') throw error;
      await new Promise((r) => setTimeout(r, Math.min(error.detail?.retryAfterMs ?? 1500, 30_000)));
      return fn();
    }
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
        this.#me = await this.call<MmUser>('GET', '/users/me', undefined, signal);
        const why = await this.#session(events, signal, choices, onSocket, () => backoff.reset());
        if (signal.aborted) return;
        if (why === 'auth') {
          events.state('needs-token', {
            message: 'Mattermost stopped accepting the bot’s token. It was probably revoked.',
          });
          return;
        }
        const wait = backoff.next();
        events.state('reconnecting', {
          message: 'The connection to Mattermost dropped.',
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

  /** One WebSocket session, until it drops (or the token is refused). */
  #session(
    events: ChannelEvents,
    signal: AbortSignal,
    choices: TextChoices,
    onSocket: (socket: WebSocket) => void,
    onHello: () => void,
  ): Promise<'dropped' | 'auth'> {
    const url = `${this.#server.replace(/^http/, 'ws')}/api/v4/websocket`;
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
      let missed = 0;
      const ping = setInterval(() => {
        if (++missed > 2) socket.close(4000);
        else if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ action: 'ping', seq: Date.now() }));
      }, PING_MS);
      ping.unref?.();
      const finish = (why: 'dropped' | 'auth') => {
        if (settled) return;
        settled = true;
        clearInterval(ping);
        signal.removeEventListener('abort', abort);
        resolve(why);
      };
      const abort = () => {
        socket.close(1000);
        finish('dropped');
      };
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', () => {
        // The token goes in the first message, never in the address.
        socket.send(
          JSON.stringify({
            seq: 1,
            action: 'authentication_challenge',
            data: { token: this.secrets.token },
          }),
        );
      });
      socket.addEventListener('message', (message) => {
        missed = 0;
        let frame: {
          event?: string;
          status?: string;
          seq_reply?: number;
          error?: { id?: string };
          data?: Record<string, unknown>;
          broadcast?: { channel_id?: string };
        };
        try {
          frame = JSON.parse(String(message.data)) as typeof frame;
        } catch {
          return;
        }
        if (frame.seq_reply === 1 && frame.status === 'FAIL') {
          socket.close(1000);
          finish('auth');
          return;
        }
        if (frame.event === 'hello') {
          onHello();
          events.state('online');
          return;
        }
        if (frame.event === 'posted' && frame.data)
          void this.#posted(frame.data, events, choices).catch(() => undefined);
      });
      socket.addEventListener('close', () => finish('dropped'));
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) finish('dropped');
      });
    });
  }

  async #posted(data: Record<string, unknown>, events: ChannelEvents, choices: TextChoices) {
    const me = this.#me;
    let post: MmPost;
    try {
      post = JSON.parse(String(data.post)) as MmPost;
    } catch {
      return;
    }
    // Its own posts, system messages and other bots are never read.
    if (!me || post.user_id === me.id || (post.type && post.type !== '')) return;
    if ((post.props as { from_bot?: string } | undefined)?.from_bot === 'true') return;
    const direct = data.channel_type === 'D';
    const user = await this.#person(post.user_id);
    const text = post.message ?? '';
    const files: ChannelFile[] = (post.file_ids ?? []).map((id) => ({ name: id, ref: id }));
    if (direct) {
      const answer = files.length ? undefined : choices.match(post.channel_id, text);
      if (answer) {
        events.press({
          chatId: post.channel_id,
          user,
          data: answer.data,
          message: answer.ref,
          ack: () => Promise.resolve(),
        });
        return;
      }
      this.#dms.set(post.user_id, post.channel_id);
      events.message({
        chatId: post.channel_id,
        messageId: post.id,
        user,
        text,
        files,
        direct: true,
      });
      return;
    }
    let mentions: string[] = [];
    try {
      mentions = JSON.parse(String(data.mentions ?? '[]')) as string[];
    } catch {
      mentions = [];
    }
    const mentioned = mentions.includes(me.id);
    const handle = new RegExp(`(^|\\s)@${me.username.replace(/[.-]/g, '\\$&')}\\b[,:]?`, 'gi');
    events.message({
      chatId: post.channel_id,
      messageId: post.id,
      user,
      text: mentioned ? text.replace(handle, '$1').replace(/ {2,}/g, ' ').trim() : text,
      files,
      direct: false,
      mentioned,
      group: await this.#place(
        post.channel_id,
        typeof data.channel_display_name === 'string' ? data.channel_display_name : undefined,
      ),
    });
  }

  /** A file someone attached: only from this server, with the bot's token. */
  async #download(file: ChannelFile) {
    if (!/^[a-z0-9]{26}$/.test(file.ref))
      throw new ChannelError('refused', 'That file isn’t on this Mattermost server.');
    const info = await this.call<{ name?: string; size?: number; mime_type?: string }>(
      'GET',
      `/files/${file.ref}/info`,
    );
    if ((info.size ?? 0) > FILE_LIMIT)
      throw new ChannelError('refused', 'Files from Mattermost can be 25 MB at most.');
    let response: Response;
    try {
      response = await fetch(`${this.#server}/api/v4/files/${file.ref}`, {
        headers: { authorization: `Bearer ${this.secrets.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new ChannelError(
        'network',
        redact(`Couldn’t download that file (${(error as Error).message}).`, this.secrets.token),
      );
    }
    if (!response.ok)
      throw new ChannelError(
        'network',
        `Mattermost didn’t hand over that file (${response.status}).`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > FILE_LIMIT)
      throw new ChannelError('refused', 'Files from Mattermost can be 25 MB at most.');
    return {
      name: info.name ?? file.name,
      bytes,
      ...(info.mime_type && { mimeType: info.mime_type }),
    };
  }
}
