import { createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { ChannelBot, ChannelSecrets } from '@conch/protocol';

import { botAvatar } from './assets';
import type { ChannelEndpoints } from './adapters';
import { fit, plain, toChatHtml } from './format';
import { STALE_MS, TextChoices } from './linked';
import {
  type MatrixMemory,
  cryptoSdk,
  dump,
  forget,
  memoryPath,
  present,
  readMemory,
  removeMemory,
  restore,
  writeMemory,
} from './matrix-crypto';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelProfile,
  type SendOptions,
  type SentRef,
  appId,
  dataUrl,
  pause,
  personId,
  redact,
} from './types';

type MatrixSecrets = Extract<ChannelSecrets, { kind: 'matrix' }>;
type Sdk = Awaited<ReturnType<typeof cryptoSdk>>;
type Olm = InstanceType<Sdk['OlmMachine']>;

/** A Matrix event is at most 64 KiB; parts this long stay well under it with their HTML. */
const PART = 12_000;
const FILE_LIMIT = 50 * 1024 * 1024;
/** How long one /sync waits for news (ms). */
const POLL_MS = 30_000;
/** Messages older than this when Conch comes back (it was off) aren't answered. */
/** Invites accepted per hour, so a flood of strangers can't make the bot join rooms forever. */
const JOINS_PER_HOUR = 20;
/** The reaction that stands for a button: Allow, Always, Don't allow. */
const emojiFor = (button: { style?: string }) =>
  button.style === 'primary' ? '✅' : button.style === 'danger' ? '❌' : '♾️';

interface MxEvent {
  type: string;
  sender?: string;
  event_id?: string;
  state_key?: string;
  origin_server_ts?: number;
  content?: Record<string, unknown>;
  room_id?: string;
}

interface SyncRoom {
  timeline?: { events?: MxEvent[]; limited?: boolean };
  state?: { events?: MxEvent[] };
  summary?: { 'm.joined_member_count'?: number; 'm.invited_member_count'?: number };
}

interface SyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, SyncRoom>;
    invite?: Record<string, { invite_state?: { events?: MxEvent[] } }>;
    leave?: Record<string, unknown>;
  };
  to_device?: { events?: unknown[] };
  device_lists?: { changed?: string[]; left?: string[] };
  device_one_time_keys_count?: Record<string, number>;
  device_unused_fallback_key_types?: string[];
}

/** What the bot knows about a room it's in. */
interface Room {
  members: Set<string>;
  names: Map<string, string>;
  encrypted: boolean;
}

/** A homeserver address: HTTPS, or plain HTTP only on this computer (a homeserver you run here). */
export function homeserverUrl(raw: string): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ChannelError('auth', 'That isn’t a homeserver address. It looks like matrix.org.', {
      field: 'homeserver',
    });
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new ChannelError('auth', 'Use the homeserver’s https:// address.', {
      field: 'homeserver',
    });
  if (url.username || url.password || url.search || url.hash)
    throw new ChannelError('auth', 'Use just the homeserver’s address.', { field: 'homeserver' });
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The homeserver named by a user id (`@ada:matrix.org` → `matrix.org`). */
const serverOf = (user: string) => /^@?[^:\s]+:([^\s/]+)$/.exec(user.trim())?.[1];

/**
 * What was typed, tidied: a user id names its homeserver when the box was
 * left empty, and what only Conch sets (its session, its store key) is
 * never taken from the page.
 */
export function normalizeMatrix(secrets: MatrixSecrets): MatrixSecrets {
  const user = secrets.user?.trim();
  const homeserver = secrets.homeserver.trim() || (user && serverOf(user)) || '';
  return {
    kind: 'matrix',
    homeserver,
    ...(user && { user }),
    ...(secrets.password && { password: secrets.password }),
    ...(secrets.accessToken && { accessToken: secrets.accessToken.trim() }),
    ...(secrets.deviceId &&
      secrets.storeKey &&
      !secrets.password && {
        deviceId: secrets.deviceId,
        storeKey: secrets.storeKey,
      }),
  };
}

/**
 * Matrix, through the client-server API: Conch long-polls `/sync` from this
 * computer, so no public address is needed. The assistant is its own Matrix
 * account (a password is used once, to sign in as a new session called
 * "Conch", and never kept), and you talk to it in a direct message.
 *
 * Encrypted rooms work: the crypto is Matrix's own Rust implementation
 * (`matrix-crypto.ts`), so a DM Element encrypts by default is read and
 * answered encrypted. Messages are accepted only from devices their owner
 * signed (or from accounts without cross-signing at all), like Element's own
 * "cross-signed or legacy" rule. If the crypto can't load, the bot says so in
 * an encrypted room rather than going quiet.
 *
 * Healing: drops and server errors retry with backoff; a rate limit waits as
 * long as the server asks; a session signed out elsewhere asks for a new
 * sign-in; a message whose key hasn't arrived yet is tried again on the next
 * syncs before the person is asked to send it again.
 */
export class MatrixAdapter implements ChannelAdapter {
  readonly kind = 'matrix' as const;
  #base?: string;

  constructor(
    private readonly secrets: MatrixSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {}

  get #home() {
    return this.endpoints.home;
  }

  /** The client-server API's address: the homeserver's own `.well-known` says where it is. */
  async #api(signal?: AbortSignal): Promise<string> {
    if (this.#base) return this.#base;
    const given = homeserverUrl(this.secrets.homeserver);
    let base = given;
    try {
      const known = await fetch(`${given}/.well-known/matrix/client`, {
        signal: AbortSignal.any([AbortSignal.timeout(8_000), ...(signal ? [signal] : [])]),
        redirect: 'follow',
      });
      if (known.ok) {
        const body = (await known.json()) as { 'm.homeserver'?: { base_url?: string } };
        const found = body['m.homeserver']?.base_url;
        if (found) base = homeserverUrl(found);
      }
    } catch {
      // No .well-known: the address given is the API.
    }
    this.#base = base;
    return base;
  }

  async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    options: {
      token?: string | null;
      signal?: AbortSignal;
      timeoutMs?: number;
      raw?: boolean;
    } = {},
  ): Promise<T> {
    const base = await this.#api(options.signal);
    const token = options.token === null ? undefined : (options.token ?? this.secrets.accessToken);
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(token && { authorization: `Bearer ${token}` }),
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(
          `Couldn’t reach the homeserver (${(error as Error).message}).`,
          token,
          this.secrets.password,
        ),
      );
    }
    if (response.ok) return (await response.json().catch(() => ({}))) as T;
    const failure = (await response.json().catch(() => ({}))) as {
      errcode?: string;
      error?: string;
      retry_after_ms?: number;
    };
    const code = failure.errcode ?? '';
    if (response.status === 429 || code === 'M_LIMIT_EXCEEDED')
      throw new ChannelError('rate-limit', 'The homeserver asked Conch to slow down.', {
        retryAfterMs:
          failure.retry_after_ms ?? Number(response.headers.get('retry-after') ?? 2) * 1000,
      });
    if (code === 'M_UNKNOWN_TOKEN' || code === 'M_MISSING_TOKEN')
      throw new ChannelError(
        'auth',
        'The homeserver signed Conch out (the session was ended, or the password changed). Sign in again.',
        { field: this.secrets.password ? 'password' : 'accessToken' },
      );
    if (code === 'M_FORBIDDEN' && path.endsWith('/login'))
      throw new ChannelError('auth', 'That username and password don’t match.', {
        field: 'password',
      });
    if (code === 'M_USER_DEACTIVATED')
      throw new ChannelError('auth', 'That Matrix account was deactivated.', { field: 'user' });
    if (response.status >= 500)
      throw new ChannelError('network', `The homeserver had a problem (${response.status}).`);
    if (response.status === 404 && options.raw) throw new ChannelError('refused', 'M_NOT_FOUND');
    throw new ChannelError(
      'refused',
      redact(`The homeserver said no (${failure.error ?? code ?? response.status}).`, token),
    );
  }

  // ── Who the bot is ─────────────────────────────────────────────────────

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    if (this.secrets.accessToken) return this.#who(this.secrets.accessToken, signal);
    if (!this.secrets.password)
      throw new ChannelError('auth', 'Type the assistant account’s password.', {
        field: 'password',
      });
    // Checking a password means signing in: a session made only for this ends at once.
    const session = await this.#login(signal);
    try {
      return await this.#who(session.access_token, signal);
    } finally {
      await this.call(
        'POST',
        '/_matrix/client/v3/logout',
        {},
        { token: session.access_token },
      ).catch(() => undefined);
    }
  }

  async #who(token: string, signal?: AbortSignal): Promise<ChannelBot> {
    const me = await this.call<{ user_id: string; device_id?: string }>(
      'GET',
      '/_matrix/client/v3/account/whoami',
      undefined,
      { token, signal },
    );
    const profile = await this.call<{ displayname?: string; avatar_url?: string }>(
      'GET',
      `/_matrix/client/v3/profile/${encodeURIComponent(me.user_id)}`,
      undefined,
      { token, signal },
    ).catch(() => ({}) as { displayname?: string; avatar_url?: string });
    const avatar = await this.#thumbnail(profile.avatar_url, token).catch(() => undefined);
    const local = /^@([^:]+):/.exec(me.user_id)?.[1] ?? me.user_id;
    return {
      id: me.user_id,
      name: profile.displayname || local,
      // Shown as "@…" by the page and in the group reply.
      username: me.user_id.replace(/^@/, ''),
      chatUrl: `https://matrix.to/#/${encodeURIComponent(me.user_id)}`,
      ...(avatar && { avatar }),
    };
  }

  async #login(signal?: AbortSignal) {
    const user = this.secrets.user?.trim();
    if (!user)
      throw new ChannelError('auth', 'Type the assistant account’s username.', { field: 'user' });
    return this.call<{
      access_token: string;
      device_id: string;
      user_id: string;
      well_known?: { 'm.homeserver'?: { base_url?: string } };
    }>(
      'POST',
      '/_matrix/client/v3/login',
      {
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user },
        password: this.secrets.password,
        initial_device_display_name: 'Conch',
      },
      { token: null, signal },
    );
  }

  /**
   * Sign in once and keep only the new session's token, or check that a
   * pasted token is a session of its own: one that Element already uses
   * has its own encryption keys, which Conch must not replace.
   */
  async settle(signal?: AbortSignal): Promise<MatrixSecrets> {
    const base = await this.#api(signal);
    const storeKey = randomBytes(32).toString('base64url');
    if (this.secrets.accessToken && !this.secrets.password) {
      const me = await this.call<{ user_id: string; device_id?: string }>(
        'GET',
        '/_matrix/client/v3/account/whoami',
        undefined,
        { signal },
      );
      if (!me.device_id)
        throw new ChannelError(
          'auth',
          'That token has no session of its own. Sign in with the password instead.',
          {
            field: 'accessToken',
          },
        );
      const keys = await this.call<{ device_keys?: Record<string, Record<string, unknown>> }>(
        'POST',
        '/_matrix/client/v3/keys/query',
        { device_keys: { [me.user_id]: [me.device_id] } },
        { signal },
      ).catch(() => ({}) as { device_keys?: Record<string, Record<string, unknown>> });
      if (keys.device_keys?.[me.user_id]?.[me.device_id])
        throw new ChannelError(
          'auth',
          'That token belongs to a session that’s already in use (Element’s, perhaps), and sharing it would break its encryption. Sign in with the password instead: Conch makes a session of its own.',
          { field: 'accessToken' },
        );
      return {
        kind: 'matrix',
        homeserver: base,
        user: me.user_id,
        accessToken: this.secrets.accessToken,
        deviceId: me.device_id,
        storeKey,
      };
    }
    const session = await this.#login(signal);
    const moved = session.well_known?.['m.homeserver']?.base_url;
    return {
      kind: 'matrix',
      homeserver: moved ? homeserverUrl(moved) : base,
      user: session.user_id,
      accessToken: session.access_token,
      deviceId: session.device_id,
      storeKey,
    };
  }

  async forget(): Promise<void> {
    if (this.secrets.accessToken && this.secrets.deviceId)
      await this.call('POST', '/_matrix/client/v3/logout', {}).catch(() => undefined);
    const path = this.#memoryPath();
    if (path) {
      await removeMemory(path);
      await forget(storeName(path)).catch(() => undefined);
    }
  }

  #memoryPath() {
    const home = this.#home;
    const user = this.secrets.user;
    const device = this.secrets.deviceId;
    return home && user && device ? memoryPath(home, user, device) : undefined;
  }

  /** A display name and Conch's pearl, for an account that has neither. */
  async prepare(profile: ChannelProfile): Promise<void> {
    const me = this.secrets.user;
    if (!me) return;
    const path = `/_matrix/client/v3/profile/${encodeURIComponent(me)}`;
    const now = await this.call<{ displayname?: string; avatar_url?: string }>('GET', path).catch(
      () => ({}) as { displayname?: string; avatar_url?: string },
    );
    const local = /^@([^:]+):/.exec(me)?.[1];
    if (!now.displayname || now.displayname === local)
      await this.call('PUT', `${path}/displayname`, { displayname: profile.assistant }).catch(
        () => undefined,
      );
    if (!now.avatar_url) {
      const base = await this.#api();
      const upload = await fetch(`${base}/_matrix/media/v3/upload?filename=avatar.jpg`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.secrets.accessToken}`,
          'content-type': 'image/jpeg',
        },
        body: new Uint8Array(await botAvatar()),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => undefined);
      const uri = upload?.ok
        ? ((await upload.json().catch(() => ({}))) as { content_uri?: string }).content_uri
        : undefined;
      if (uri)
        await this.call('PUT', `${path}/avatar_url`, { avatar_url: uri }).catch(() => undefined);
    }
  }

  async #thumbnail(mxc: string | undefined, token: string): Promise<string | undefined> {
    const parts = mxcParts(mxc);
    if (!parts) return undefined;
    const base = await this.#api();
    const response = await fetch(
      `${base}/_matrix/client/v1/media/thumbnail/${parts.server}/${parts.id}?width=96&height=96&method=crop`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) return undefined;
    return dataUrl(
      Buffer.from(await response.arrayBuffer()),
      response.headers.get('content-type') ?? 'image/png',
    );
  }

  // ── Connection ─────────────────────────────────────────────────────────

  connect(events: ChannelEvents): ChannelConnection {
    const session = new MatrixSession(this, this.secrets, events, this.#memoryPath());
    void session.run();
    return {
      send: (chatId, markdown, options) => session.send(chatId, markdown, options),
      edit: (ref, markdown) => session.edit(ref, markdown),
      typing: (chatId) => session.typing(chatId),
      seen: (ref, working) => session.seen(ref, working),
      download: (file) => session.download(file),
      directChat: (userId) => session.directChat(appId(userId)),
      close: () => session.close(),
    };
  }

  /** The homeserver's media, with the session's token, only from the homeserver itself. */
  async media(mxc: string): Promise<Response> {
    const parts = mxcParts(mxc);
    if (!parts)
      throw new ChannelError('refused', 'That file’s address isn’t one Conch recognises.');
    const base = await this.#api();
    const get = (path: string) =>
      fetch(`${base}${path}/${parts.server}/${parts.id}`, {
        headers: { authorization: `Bearer ${this.secrets.accessToken}` },
        signal: AbortSignal.timeout(60_000),
        redirect: 'follow',
      });
    let response = await get('/_matrix/client/v1/media/download');
    // An older homeserver without authenticated media.
    if (response.status === 404 || response.status === 405)
      response = await get('/_matrix/media/v3/download');
    return response;
  }
}

/** The name of a session's crypto databases. */
const storeName = (path: string) =>
  `conch-${createHash('sha256').update(path).digest('hex').slice(0, 16)}`;

/** One session's sync at a time, even across a reconnect (they share the crypto store). */
const running = new Map<string, Promise<void>>();

class MatrixSession {
  #stop = new AbortController();
  #memory: MatrixMemory = { rooms: {} };
  #rooms = new Map<string, Room>();
  #sdk?: Sdk;
  #olm?: Olm;
  /** Why the crypto isn't available, when it isn't. */
  #noCrypto?: string;
  #saved = '';
  #saving?: Promise<void>;
  #lock: Promise<unknown> = Promise.resolve();
  /** Encrypted messages whose key hasn't come yet: tried again for a few syncs. */
  #waiting: { roomId: string; event: MxEvent; tries: number }[] = [];
  /** Questions with answers, by the event they were asked in. */
  #questions = new Map<string, { roomId: string; answers: { emoji: string; data: string }[] }>();
  /** The latest question in each room, for answers typed as 1, 2 or 3. */
  /** Questions answered by typing their number (or yes / no), as on every app without buttons. */
  #choices = new TextChoices();
  #joins: number[] = [];
  #told = new Set<string>();
  #started = Date.now();
  #done?: () => void;
  #txn = 0;

  constructor(
    private readonly adapter: MatrixAdapter,
    private readonly secrets: MatrixSecrets,
    private readonly events: ChannelEvents,
    private readonly path: string | undefined,
  ) {}

  get #me() {
    return this.secrets.user ?? '';
  }

  close() {
    this.#stop.abort();
  }

  async run() {
    const key = this.path ?? this.#me;
    const before = running.get(key);
    const mine = new Promise<void>((resolve) => (this.#done = resolve));
    running.set(key, mine);
    await before;
    try {
      await this.#run();
    } finally {
      // Let go of the crypto once nothing is using it (closing it mid-call throws).
      await this.#lock.catch(() => undefined);
      try {
        this.#olm?.close();
      } catch {
        // Still borrowed by a call that outlived the session: it's freed with it.
      }
      this.#done?.();
      if (running.get(key) === mine) running.delete(key);
    }
  }

  async #run() {
    const signal = this.#stop.signal;
    this.events.state('connecting');
    if (!this.secrets.accessToken || !this.secrets.deviceId || !this.secrets.user) {
      this.events.state('needs-token', {
        message: 'Conch isn’t signed in to Matrix. Sign in again.',
      });
      return;
    }
    if (this.path) this.#memory = await readMemory(this.path);
    await this.#startCrypto();
    const backoff = new Backoff();
    let online = false;
    let first = !this.#memory.since;
    while (!signal.aborted) {
      try {
        const sync = await this.#sync(first, signal);
        if (!online) {
          online = true;
          this.events.state('online');
        }
        backoff.reset();
        await this.#handle(sync, first);
        this.#memory.since = sync.next_batch;
        first = false;
        await this.#save();
      } catch (error) {
        if (signal.aborted) break;
        online = false;
        const failure =
          error instanceof ChannelError ? error : new ChannelError('network', String(error));
        if (failure.code === 'auth') {
          this.events.state('needs-token', { message: failure.message });
          break;
        }
        const wait = failure.detail?.retryAfterMs ?? backoff.next();
        this.events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
        await pause(wait, signal);
      }
    }
    await this.#save().catch(() => undefined);
  }

  async #sync(first: boolean, signal: AbortSignal): Promise<SyncResponse> {
    const filter = {
      presence: { not_types: ['*'] },
      account_data: { types: ['m.direct'] },
      room: {
        timeline: { limit: first ? 1 : 30 },
        account_data: { not_types: ['*'] },
        ephemeral: { not_types: ['*'] },
      },
    };
    const query = new URLSearchParams({
      timeout: String(first ? 0 : POLL_MS),
      filter: JSON.stringify(filter),
      ...(this.#memory.since && { since: this.#memory.since }),
    });
    return this.adapter.call<SyncResponse>('GET', `/_matrix/client/v3/sync?${query}`, undefined, {
      signal,
      timeoutMs: POLL_MS + 30_000,
    });
  }

  // ── Encryption ─────────────────────────────────────────────────────────

  async #startCrypto() {
    try {
      const sdk = await cryptoSdk();
      this.#sdk = sdk;
      const name = this.path ? storeName(this.path) : `conch-${this.#me}`;
      // The freshest copy is the one already in memory (a reconnect); else the one on disk.
      if (!(await present(name)) && this.#memory.crypto) await restore(this.#memory.crypto);
      this.#olm = await sdk.OlmMachine.initialize(
        new sdk.UserId(this.#me),
        new sdk.DeviceId(this.secrets.deviceId ?? ''),
        name,
        this.secrets.storeKey,
      );
      await this.#outgoing();
    } catch (error) {
      this.#noCrypto = (error as Error).message;
      this.events.healed?.(
        'Matrix’s encryption couldn’t start on this computer, so encrypted rooms can’t be read. Conch says so in them.',
      );
    }
  }

  /** Send what the crypto wants sent (keys to upload, devices to look up, keys for others). */
  async #outgoing() {
    const olm = this.#olm;
    const sdk = this.#sdk;
    if (!olm || !sdk) return;
    for (let round = 0; round < 5; round++) {
      const requests = await olm.outgoingRequests();
      if (!requests.length) return;
      for (const request of requests) {
        const r = request as unknown as {
          id: string;
          type: number;
          body: string;
          event_type?: string;
          txn_id?: string;
          room_id?: string;
        };
        const T = sdk.RequestType;
        let response: unknown;
        const body = JSON.parse(r.body || '{}') as unknown;
        if (r.type === T.KeysUpload)
          response = await this.adapter.call('POST', '/_matrix/client/v3/keys/upload', body);
        else if (r.type === T.KeysQuery)
          response = await this.adapter.call('POST', '/_matrix/client/v3/keys/query', body);
        else if (r.type === T.KeysClaim)
          response = await this.adapter.call('POST', '/_matrix/client/v3/keys/claim', body);
        else if (r.type === T.ToDevice)
          response = await this.adapter.call(
            'PUT',
            `/_matrix/client/v3/sendToDevice/${encodeURIComponent(r.event_type ?? '')}/${encodeURIComponent(r.txn_id ?? '')}`,
            body,
          );
        else if (r.type === T.SignatureUpload)
          response = await this.adapter.call(
            'POST',
            '/_matrix/client/v3/keys/signatures/upload',
            body,
          );
        else if (r.type === T.RoomMessage)
          response = await this.adapter.call(
            'PUT',
            `/_matrix/client/v3/rooms/${encodeURIComponent(r.room_id ?? '')}/send/${encodeURIComponent(r.event_type ?? '')}/${encodeURIComponent(r.txn_id ?? '')}`,
            body,
          );
        else continue;
        await olm.markRequestAsSent(r.id, r.type, JSON.stringify(response ?? {}));
      }
    }
  }

  /** Serialise everything that touches the crypto: it isn't safe to interleave. */
  #crypto<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#lock.then(fn, fn);
    this.#lock = next.catch(() => undefined);
    return next;
  }

  async #save() {
    if (!this.path) return;
    const path = this.path;
    this.#saving = (this.#saving ?? Promise.resolve()).then(async () => {
      const crypto = this.#olm
        ? await this.#crypto(() => dump(storeName(path)))
        : this.#memory.crypto;
      const next = { ...this.#memory, ...(crypto && { crypto }) };
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ since: next.since, rooms: next.rooms }))
        .update(crypto ?? Buffer.alloc(0))
        .digest('hex');
      if (fingerprint === this.#saved) return;
      await writeMemory(path, next);
      this.#memory = next;
      this.#saved = fingerprint;
    });
    await this.#saving;
  }

  async #decrypt(
    roomId: string,
    event: MxEvent,
    tries: number,
  ): Promise<MxEvent | 'later' | { refused: string }> {
    const olm = this.#olm;
    const sdk = this.#sdk;
    if (!olm || !sdk) return { refused: 'no-crypto' };
    try {
      const result = await this.#crypto(() =>
        olm.decryptRoomEvent(
          JSON.stringify({ ...event, room_id: roomId }),
          new sdk.RoomId(roomId),
          new sdk.DecryptionSettings(sdk.TrustRequirement.CrossSignedOrLegacy),
        ),
      );
      const clear = JSON.parse(result.event) as MxEvent;
      return { ...event, type: clear.type, content: clear.content ?? {} };
    } catch (error) {
      const code = (error as { code?: number }).code;
      const D = sdk.DecryptionErrorCode;
      // A key not here yet, or a device not looked up yet: both arrive with the next sync.
      if (code === D.MissingRoomKey || code === D.UnknownMessageIndex) return 'later';
      if (code === D.UnknownSenderDevice) return tries < 2 ? 'later' : { refused: 'untrusted' };
      if (code === D.UnsignedSenderDevice || code === D.SenderIdentityVerificationViolation)
        return { refused: 'untrusted' };
      return { refused: 'unreadable' };
    }
  }

  async #encrypt(roomId: string, type: string, content: Record<string, unknown>) {
    const olm = this.#olm;
    const sdk = this.#sdk;
    if (!olm || !sdk)
      throw new ChannelError('refused', 'Encryption isn’t available on this computer.');
    const everyone = [...(await this.#room(roomId)).members];
    // The crypto takes what it's handed: each call gets ids of its own.
    const members = () => everyone.map((m) => new sdk.UserId(m));
    return this.#crypto(async () => {
      await olm.updateTrackedUsers(members());
      await this.#outgoing();
      const claim = await olm.getMissingSessions(members());
      if (claim) {
        const response = await this.adapter.call(
          'POST',
          '/_matrix/client/v3/keys/claim',
          JSON.parse(claim.body) as unknown,
        );
        await olm.markRequestAsSent(claim.id, claim.type, JSON.stringify(response));
      }
      const share = await olm.shareRoomKey(
        new sdk.RoomId(roomId),
        members(),
        new sdk.EncryptionSettings(),
      );
      for (const request of share) {
        const response = await this.adapter.call(
          'PUT',
          `/_matrix/client/v3/sendToDevice/${encodeURIComponent(request.event_type)}/${encodeURIComponent(request.txn_id)}`,
          JSON.parse(request.body) as unknown,
        );
        await olm.markRequestAsSent(request.id, request.type, JSON.stringify(response));
      }
      return JSON.parse(
        await olm.encryptRoomEvent(new sdk.RoomId(roomId), type, JSON.stringify(content)),
      ) as Record<string, unknown>;
    });
  }

  // ── What came in ───────────────────────────────────────────────────────

  async #handle(sync: SyncResponse, first: boolean) {
    const olm = this.#olm;
    const sdk = this.#sdk;
    if (olm && sdk) {
      await this.#crypto(async () => {
        await olm.receiveSyncChanges(
          JSON.stringify(sync.to_device?.events ?? []),
          new sdk.DeviceLists(
            (sync.device_lists?.changed ?? []).map((u) => new sdk.UserId(u)),
            (sync.device_lists?.left ?? []).map((u) => new sdk.UserId(u)),
          ),
          new Map(Object.entries(sync.device_one_time_keys_count ?? {})),
          new Set(sync.device_unused_fallback_key_types ?? []),
        );
        await this.#outgoing();
      });
    }
    for (const [roomId, invite] of Object.entries(sync.rooms?.invite ?? {}))
      await this.#invited(roomId, invite.invite_state?.events ?? []).catch(() => undefined);
    for (const roomId of Object.keys(sync.rooms?.leave ?? {})) this.#rooms.delete(roomId);
    for (const [roomId, room] of Object.entries(sync.rooms?.join ?? {})) {
      const known = await this.#room(roomId, room);
      for (const event of room.timeline?.events ?? []) {
        if (event.state_key !== undefined) this.#state(known, roomId, event);
        // The first sync after a sign-in only says where things are: nothing in it is answered.
        if (first) continue;
        await this.#event(roomId, event).catch(() => undefined);
      }
    }
    // Keys that arrived since: try what was waiting for them.
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const item of waiting)
      await this.#event(item.roomId, item.event, item.tries + 1).catch(() => undefined);
  }

  async #invited(roomId: string, state: MxEvent[]) {
    const mine = state.find((e) => e.type === 'm.room.member' && e.state_key === this.#me);
    const inviter = mine?.sender;
    if (!inviter) return;
    const others = new Set(
      state
        .filter((e) => e.type === 'm.room.member' && e.state_key && e.state_key !== this.#me)
        .filter((e) => ['join', 'invite'].includes(String(e.content?.membership)))
        .map((e) => e.state_key),
    );
    const direct = mine.content?.is_direct === true || others.size <= 1;
    const hour = Date.now() - 60 * 60_000;
    this.#joins = this.#joins.filter((at) => at > hour);
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`;
    if (!direct) {
      // Groups are declined, with the reason Element shows: anyone in them could speak for you.
      await this.adapter.call('POST', `${path}/leave`, {
        reason:
          'I only talk in private chats, so nobody can speak for anyone else. Start a direct message with me instead.',
      });
      return;
    }
    if (this.#joins.length >= JOINS_PER_HOUR) return;
    this.#joins.push(Date.now());
    await this.adapter.call('POST', `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {});
  }

  async #room(roomId: string, sync?: SyncRoom): Promise<Room> {
    let room = this.#rooms.get(roomId);
    if (!room) {
      room = { members: new Set(), names: new Map(), encrypted: false };
      this.#rooms.set(roomId, room);
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`;
      const [members, encryption] = await Promise.all([
        this.adapter
          .call<{ joined?: Record<string, { display_name?: string }> }>(
            'GET',
            `${path}/joined_members`,
          )
          .catch(() => ({}) as { joined?: Record<string, { display_name?: string }> }),
        this.adapter
          .call<{ algorithm?: string }>('GET', `${path}/state/m.room.encryption/`, undefined, {
            raw: true,
          })
          .catch(() => undefined),
      ]);
      for (const [user, info] of Object.entries(members.joined ?? {})) {
        room.members.add(user);
        if (info.display_name) room.names.set(user, info.display_name);
      }
      if (encryption?.algorithm) await this.#encrypted(room, roomId);
    }
    for (const event of sync?.state?.events ?? []) this.#state(room, roomId, event);
    return room;
  }

  #state(room: Room, roomId: string, event: MxEvent) {
    if (event.type === 'm.room.member' && event.state_key) {
      const membership = String(event.content?.membership ?? '');
      const fresh = !room.members.has(event.state_key);
      if (membership === 'join' || membership === 'invite') room.members.add(event.state_key);
      else room.members.delete(event.state_key);
      if (fresh && room.encrypted && room.members.has(event.state_key))
        void this.#encrypted(room, roomId);
      const name = event.content?.displayname;
      if (typeof name === 'string') room.names.set(event.state_key, name);
    } else if (event.type === 'm.room.encryption') void this.#encrypted(room, roomId);
  }

  async #encrypted(room: Room, roomId: string) {
    room.encrypted = true;
    const sdk = this.#sdk;
    const olm = this.#olm;
    if (!sdk || !olm) return;
    const settings = new sdk.RoomSettings();
    settings.algorithm = sdk.EncryptionAlgorithm.MegolmV1AesSha2;
    // Who's in it, so their devices are looked up before their first message is read.
    const members = [...room.members].map((m) => new sdk.UserId(m));
    await this.#crypto(async () => {
      await olm.setRoomSettings(new sdk.RoomId(roomId), settings);
      await olm.updateTrackedUsers(members);
      await this.#outgoing();
    }).catch(() => undefined);
  }

  async #event(roomId: string, raw: MxEvent, tries = 0) {
    if (!raw.sender || raw.sender === this.#me) return;
    // Back after being off: what's very old isn't answered.
    if (raw.origin_server_ts && raw.origin_server_ts < this.#started - STALE_MS) return;
    let event = raw;
    if (raw.type === 'm.room.encrypted') {
      if (this.#noCrypto) {
        await this.#tellOnce(
          roomId,
          'no-crypto',
          '🔒 This room is encrypted, and encryption couldn’t start on the computer I run on, so I can’t read your messages here. Open Conch on your computer and press Repair on Matrix.',
        );
        return;
      }
      const clear = await this.#decrypt(roomId, raw, tries);
      if (clear === 'later') {
        if (tries < 3) this.#waiting.push({ roomId, event: raw, tries });
        else
          await this.#tellOnce(
            roomId,
            `lost:${raw.event_id}`,
            'I couldn’t read your last message: its key never reached me. Could you send it again?',
          );
        return;
      }
      if ('refused' in clear) {
        await this.#tellOnce(
          roomId,
          clear.refused,
          clear.refused === 'untrusted'
            ? '🔒 That message came from a session of yours that isn’t verified, so I didn’t read it. Verify the session in your Matrix app (Settings → Sessions), then send it again.'
            : 'I couldn’t decrypt that message. Could you send it again?',
        );
        return;
      }
      event = clear;
    }
    const room = await this.#room(roomId);
    const content = event.content ?? {};
    const user = {
      id: personId(event.sender ?? ''),
      name:
        room.names.get(event.sender ?? '') ||
        (/^@([^:]+):/.exec(event.sender ?? '')?.[1] ?? 'Someone'),
      username: (event.sender ?? '').replace(/^@/, ''),
    };
    const direct = room.members.size <= 2;
    if (direct && event.sender) this.#memory.rooms[event.sender] = roomId;

    if (event.type === 'm.reaction') {
      const relates = content['m.relates_to'] as
        { event_id?: string; key?: string; rel_type?: string } | undefined;
      const question = relates?.event_id ? this.#questions.get(relates.event_id) : undefined;
      const data = question?.answers.find((a) => a.emoji === relates?.key)?.data;
      if (data && relates?.event_id) this.#press(roomId, user, data, relates.event_id);
      return;
    }
    if (event.type !== 'm.room.message') return;
    const relates = content['m.relates_to'] as { rel_type?: string } | undefined;
    if (relates?.rel_type === 'm.replace') return;
    const msgtype = String(content.msgtype ?? '');
    if (msgtype === 'm.notice') return;
    let text = typeof content.body === 'string' ? content.body : '';
    // A reply carries the message it answers as a quote first.
    if (content['m.relates_to'] && /^> </.test(text)) text = text.replace(/^(>.*\n)+\n?/, '');
    // A typed answer to a question (a reply to it answers that one).
    const quoted = (
      content['m.relates_to'] as { 'm.in_reply_to'?: { event_id?: string } } | undefined
    )?.['m.in_reply_to']?.event_id;
    const typed = this.#choices.match(roomId, text, quoted);
    if (typed) {
      this.#press(roomId, user, typed.data, typed.ref.messageId);
      return;
    }
    const files: ChannelFile[] = [];
    if (['m.image', 'm.file', 'm.audio', 'm.video'].includes(msgtype)) {
      const info = (content.info ?? {}) as { mimetype?: string; size?: number };
      const file = content.file as { url?: string } | undefined;
      const url = typeof content.url === 'string' ? content.url : file?.url;
      if (url)
        files.push({
          name: text || 'file',
          ref: JSON.stringify(file ? { file } : { url }),
          ...(info.mimetype && { mimeType: info.mimetype }),
          ...(info.size !== undefined && { size: info.size }),
        });
      // A file's body is its name; the caption, when there is one, is `filename`'s neighbour.
      text = typeof content.filename === 'string' && content.filename !== content.body ? text : '';
    }
    this.events.message({
      chatId: roomId,
      messageId: event.event_id ?? '',
      user,
      text,
      files,
      direct,
    });
  }

  #press(
    roomId: string,
    user: { id: string; name: string; username: string },
    data: string,
    eventId: string,
  ) {
    this.events.press({
      chatId: roomId,
      user,
      data,
      message: { chatId: roomId, messageId: eventId },
      ack: () => Promise.resolve(),
    });
  }

  /** Say something once per room and reason (a problem, not a conversation). */
  async #tellOnce(roomId: string, why: string, text: string) {
    const key = `${roomId}:${why}`;
    if (this.#told.has(key)) return;
    this.#told.add(key);
    await this.#post(roomId, { msgtype: 'm.notice', body: text }, { plainOnly: true }).catch(
      () => undefined,
    );
  }

  // ── What goes out ──────────────────────────────────────────────────────

  async #post(
    roomId: string,
    content: Record<string, unknown>,
    options: { plainOnly?: boolean; type?: string } = {},
  ) {
    const room = await this.#room(roomId);
    const type = options.type ?? 'm.room.message';
    let eventType = type;
    let body = content;
    if (room.encrypted && this.#olm && !options.plainOnly) {
      body = await this.#encrypt(roomId, type, content);
      eventType = 'm.room.encrypted';
      void this.#save().catch(() => undefined);
    }
    // The same transaction id on a retry: the homeserver sends it once, however often it's asked.
    const txn = `conch-${Date.now()}-${this.#txn++}`;
    const put = () =>
      this.adapter.call<{ event_id: string }>(
        'PUT',
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${txn}`,
        body,
      );
    let sent: { event_id: string };
    try {
      sent = await put();
    } catch (error) {
      if (
        !(error instanceof ChannelError) ||
        (error.code !== 'rate-limit' && error.code !== 'network')
      )
        throw error;
      await pause(Math.min(error.detail?.retryAfterMs ?? 1500, 30_000), this.#stop.signal);
      sent = await put();
    }
    return sent.event_id;
  }

  async send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const buttons = options?.buttons ?? [];
    // Reactions are Matrix's buttons; a typed number works too, as everywhere without buttons.
    const text = buttons.length
      ? `${TextChoices.render(markdown, buttons)}\n_Or tap ${buttons.map(emojiFor).join(' ')} below._`
      : markdown;
    const parts = fit(text, PART, (part) => toChatHtml(part).length);
    const sent: SentRef[] = [];
    for (const part of parts) {
      const id = await this.#post(chatId, {
        msgtype: 'm.text',
        body: plain(part),
        format: 'org.matrix.custom.html',
        formatted_body: toChatHtml(part),
      });
      sent.push({ chatId, messageId: id });
    }
    const last = sent.at(-1);
    if (buttons.length && last) {
      const answers = buttons.map((b) => ({ emoji: emojiFor(b), data: b.data }));
      this.#questions.set(last.messageId, { roomId: chatId, answers });
      this.#choices.remember(last, buttons);
      // The bot's own reactions are the buttons: one tap adds yours.
      for (const { emoji } of answers)
        await this.#post(
          chatId,
          { 'm.relates_to': { rel_type: 'm.annotation', event_id: last.messageId, key: emoji } },
          { type: 'm.reaction' },
        ).catch(() => undefined);
    }
    return sent;
  }

  /** Change a message (Matrix edits): its question, if it was one, is answered now. */
  async edit(ref: SentRef, markdown: string) {
    this.#questions.delete(ref.messageId);
    this.#choices.forget(ref);
    const part = fit(markdown, PART, (p) => toChatHtml(p).length)[0] ?? '…';
    const fresh = {
      msgtype: 'm.text',
      body: plain(part),
      format: 'org.matrix.custom.html',
      formatted_body: toChatHtml(part),
    };
    await this.#post(ref.chatId, {
      ...fresh,
      body: `* ${fresh.body}`,
      'm.new_content': fresh,
      'm.relates_to': { rel_type: 'm.replace', event_id: ref.messageId },
    });
  }

  async typing(chatId: string) {
    await this.adapter.call(
      'PUT',
      `/_matrix/client/v3/rooms/${encodeURIComponent(chatId)}/typing/${encodeURIComponent(this.#me)}`,
      { typing: true, timeout: 8_000 },
    );
  }

  /** Read receipts say a message was seen. */
  async seen(ref: SentRef, working: boolean) {
    if (!working || !ref.messageId) return;
    await this.adapter
      .call(
        'POST',
        `/_matrix/client/v3/rooms/${encodeURIComponent(ref.chatId)}/receipt/m.read/${encodeURIComponent(ref.messageId)}`,
        {},
      )
      .catch(() => undefined);
  }

  async download(file: ChannelFile) {
    if (file.size && file.size > FILE_LIMIT)
      throw new ChannelError('refused', 'That file is too big to take from Matrix.');
    let ref: { url?: string; file?: EncryptedFile };
    try {
      ref = JSON.parse(file.ref) as typeof ref;
    } catch {
      throw new ChannelError('refused', 'That file’s address isn’t one Conch recognises.');
    }
    const mxc = ref.file?.url ?? ref.url ?? '';
    const response = await this.adapter.media(mxc).catch((error: unknown) => {
      throw error instanceof ChannelError
        ? error
        : new ChannelError('network', `Couldn’t download that file (${(error as Error).message}).`);
    });
    if (!response.ok)
      throw new ChannelError('network', `Couldn’t download that file (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > FILE_LIMIT)
      throw new ChannelError('refused', 'That file is too big to take from Matrix.');
    return {
      name: file.name,
      bytes: ref.file ? decryptAttachment(bytes, ref.file) : bytes,
      ...(file.mimeType && { mimeType: file.mimeType }),
    };
  }

  /** The private room with someone, made (encrypted, when Conch can) if there isn't one. */
  async directChat(user: string): Promise<string> {
    const known = this.#memory.rooms[user];
    if (known && (await this.#room(known)).members.has(this.#me)) return known;
    const created = await this.adapter.call<{ room_id: string }>(
      'POST',
      '/_matrix/client/v3/createRoom',
      {
        preset: 'trusted_private_chat',
        is_direct: true,
        invite: [user],
        ...(this.#olm && {
          initial_state: [
            {
              type: 'm.room.encryption',
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ],
        }),
      },
    );
    this.#memory.rooms[user] = created.room_id;
    const room = await this.#room(created.room_id);
    room.members.add(user);
    if (this.#olm) await this.#encrypted(room, created.room_id);
    // Clients show it as a direct message.
    const path = `/_matrix/client/v3/user/${encodeURIComponent(this.#me)}/account_data/m.direct`;
    const direct = await this.adapter
      .call<Record<string, string[]>>('GET', path)
      .catch(() => ({}) as Record<string, string[]>);
    await this.adapter
      .call('PUT', path, { ...direct, [user]: [...(direct[user] ?? []), created.room_id] })
      .catch(() => undefined);
    void this.#save().catch(() => undefined);
    return created.room_id;
  }
}

interface EncryptedFile {
  url: string;
  key: { k: string; alg?: string };
  iv: string;
  hashes: { sha256: string };
  v?: string;
}

/** An encrypted attachment (Matrix spec § Sending encrypted attachments): check its hash, then AES-CTR. */
export function decryptAttachment(bytes: Buffer, file: EncryptedFile): Buffer {
  const digest = createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '');
  if (digest !== file.hashes.sha256.replace(/=+$/, ''))
    throw new ChannelError('refused', 'That file was changed on its way, so Conch didn’t take it.');
  const key = Buffer.from(file.key.k, 'base64url');
  const iv = Buffer.from(file.iv, 'base64');
  if (key.length !== 32 || iv.length !== 16)
    throw new ChannelError('refused', 'That file’s encryption isn’t one Conch can read.');
  const decipher = createDecipheriv('aes-256-ctr', key, iv);
  return Buffer.concat([decipher.update(bytes), decipher.final()]);
}

function mxcParts(mxc: string | undefined): { server: string; id: string } | undefined {
  const match = /^mxc:\/\/([A-Za-z0-9.:[\]-]+)\/([A-Za-z0-9_-]+)$/.exec(mxc ?? '');
  return match?.[1] && match[2] ? { server: match[1], id: match[2] } : undefined;
}
