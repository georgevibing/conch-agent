/**
 * Google Chat (ADR 0084): a Chat app of your own in a Google Workspace
 * account. Google Chat only delivers to a web address, so events come in
 * through the public door (ADR 0045); answers go out through the Chat API,
 * as the app, with a service account's key.
 *
 * - **Every delivery's bearer token is checked** before a word is read: a
 *   Google-signed ID token (RS256, Google's published keys), issued by
 *   accounts.google.com, for this channel's own address (the audience), for
 *   `chat@system.gserviceaccount.com`, and not expired. A repeated event is
 *   one event, and one more than an hour old is not read.
 * - **The service account's key** signs a short JWT that's traded for an
 *   access token (`chat.bot` scope) at Google's token endpoint, kept for its
 *   hour. The key never leaves this computer, and the token goes only to
 *   Google's Chat API.
 * - **Answers** are Chat's own formatting (`*bold*`, `_italic_`,
 *   `<url|label>`), and approvals a card with buttons whose clicks come back
 *   signed like any event.
 * - **Groups** (ADR 0075): in a space, Chat only delivers what @mentions the
 *   app; a space is answered only once you turn it on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ChannelBot, ChannelSecrets } from '@conch/protocol';
import {
  type JWK,
  SignJWT,
  decodeProtectedHeader,
  errors as joseErrors,
  importJWK,
  importPKCS8,
  importX509,
  jwtVerify,
} from 'jose';

import { writeFileAtomic } from '../lib/fs';
import type { ChannelEndpoints } from './adapters';
import type { HookReply, HookRequest } from './door';
import { blocks, fit, inline, prose } from './format';
import { TextChoices } from './linked';
import {
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelUser,
  type SendOptions,
  type SentRef,
  appId,
  personId,
  redact,
} from './types';

export const GOOGLE_CHAT_API = 'https://chat.googleapis.com';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google Chat's own service account's certificates (the "project number" audience). */
export const CHAT_CERTS =
  'https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com';
/** Who Google Chat's tokens are about. */
export const CHAT_SENDER = 'chat@system.gserviceaccount.com';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SCOPE = 'https://www.googleapis.com/auth/chat.bot';

type GoogleChatSecrets = Extract<ChannelSecrets, { kind: 'googlechat' }>;

/** Chat takes 4096 characters a message; parts this long stay under. */
const PART = 3900;
/** Events remembered, on disk, so none is taken twice. */
const SEEN = 2000;
/** For longer than a Google token lasts (an hour), with room to spare. */
const REMEMBER_MS = 2 * 60 * 60_000;
/** An event's own time must be this close to now. */
const FRESH_MS = 5 * 60_000;
const KEYS_FOR_MS = 6 * 60 * 60_000;
const REFRESH_AT_MOST_EVERY_MS = 5 * 60_000;

/** What a service account's key file holds that Conch uses. */
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** The service account in what was pasted (the whole key file), or why not. */
export function serviceAccountOf(raw: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new ChannelError(
      'auth',
      'That isn’t a key file. Download the service account’s key as JSON and paste the whole file.',
      { field: 'serviceAccount' },
    );
  }
  const account = parsed as Partial<ServiceAccount & { type: string }>;
  if (
    account.type !== 'service_account' ||
    typeof account.client_email !== 'string' ||
    !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(account.client_email) ||
    typeof account.private_key !== 'string' ||
    !account.private_key.includes('BEGIN PRIVATE KEY')
  )
    throw new ChannelError(
      'auth',
      'That isn’t a service account’s key. In Google Cloud, open IAM → Service accounts → your account → Keys → Add key → JSON.',
      { field: 'serviceAccount' },
    );
  return {
    client_email: account.client_email,
    private_key: account.private_key,
    ...(typeof account.project_id === 'string' && { project_id: account.project_id }),
  };
}

/** Google Chat's own formatting: Slack-like marks, no HTML escaping. */
export function toGoogleChat(markdown: string): string {
  const style = {
    escape: (s: string) => s,
    code: (s: string) => `\`${s}\``,
    bold: (s: string) => `*${s}*`,
    italic: (s: string) => `_${s}_`,
    strike: (s: string) => `~${s}~`,
    link: (label: string, url: string) =>
      label === url ? url : `<${url.replaceAll('|', '%7C')}|${label}>`,
  };
  return blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? `\`\`\`\n${block.text}\n\`\`\``
        : prose(block.text, {
            line: (s) => inline(s, style),
            heading: (s) => `*${s}*`,
            quote: (lines) => lines.map((l) => `> ${l}`).join('\n'),
            table: (rows) => `\`\`\`\n${rows}\n\`\`\``,
            bullet: '•',
          }),
    )
    .join('\n')
    .trim();
}

/**
 * Google's signing keys for ID tokens, cached by key id. Google is asked
 * again only when the keys are old, or for a key id it hasn't seen, and
 * never more than once every few minutes whatever arrives (so a flood of
 * made-up key ids can't make Conch hammer Google). If Google can't be
 * reached, what isn't known is refused: it fails closed.
 */
export class GoogleKeys {
  #keys = new Map<string, JWK>();
  #fetchedAt = 0;
  /** When Google was last asked, whether or not it answered. */
  #askedAt = 0;
  #loading?: Promise<void>;
  /** How many times Google was asked (for the tests). */
  fetches = 0;

  constructor(
    private readonly url = GOOGLE_CERTS,
    private readonly every = REFRESH_AT_MOST_EVERY_MS,
  ) {}

  async key(kid: string): Promise<JWK | undefined> {
    const now = Date.now();
    const stale = now - this.#fetchedAt > KEYS_FOR_MS;
    const unknown = !this.#keys.has(kid);
    if ((stale || unknown) && now - this.#askedAt > this.every)
      await this.#load().catch(() => undefined);
    else if (this.#loading) await this.#loading.catch(() => undefined);
    return this.#keys.get(kid);
  }

  #load(): Promise<void> {
    this.#loading ??= (async () => {
      this.#askedAt = Date.now();
      this.fetches++;
      if (!/^https:\/\//.test(this.url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(this.url))
        throw new Error('Google’s keys must come over HTTPS.');
      const response = await fetch(this.url, {
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`Google keys: ${response.status}`);
      const jwks = (await response.json()) as { keys?: (JWK & { kid?: string })[] };
      const keys = new Map<string, JWK>();
      for (const key of jwks.keys ?? []) if (key.kid && key.kty === 'RSA') keys.set(key.kid, key);
      this.#keys = keys;
      this.#fetchedAt = Date.now();
    })().finally(() => (this.#loading = undefined));
    return this.#loading;
  }
}

/**
 * Google Chat's other way of signing (the "project number" audience): a JWT
 * Google Chat's own service account signs, with its X.509 certificates.
 * Conch doesn't take events this way, because the project number isn't
 * something it knows; it only recognises a genuine one, to tell the person
 * which setting to change. Cached and rate-limited like `GoogleKeys`.
 */
export class ChatCerts {
  #certs = new Map<string, string>();
  #askedAt = 0;
  #loading?: Promise<void>;

  constructor(
    private readonly url = CHAT_CERTS,
    private readonly every = REFRESH_AT_MOST_EVERY_MS,
  ) {}

  async cert(kid: string): Promise<string | undefined> {
    if (!this.#certs.has(kid) && Date.now() - this.#askedAt > this.every)
      await this.#load().catch(() => undefined);
    return this.#certs.get(kid);
  }

  #load(): Promise<void> {
    this.#loading ??= (async () => {
      this.#askedAt = Date.now();
      if (!/^https:\/\//.test(this.url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(this.url))
        throw new Error('Google’s certificates must come over HTTPS.');
      const response = await fetch(this.url, {
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`Google certificates: ${response.status}`);
      const certs = (await response.json()) as Record<string, string>;
      this.#certs = new Map(Object.entries(certs).filter(([, pem]) => typeof pem === 'string'));
    })().finally(() => (this.#loading = undefined));
    return this.#loading;
  }
}

/**
 * Whether this is a genuine Google Chat token of the "project number" kind:
 * signed by Google Chat's service account, from it, whatever its audience.
 * Never a reason to accept an event; only to say which setting to change.
 */
export async function projectNumberToken(
  authorization: string | undefined,
  certs: ChatCerts,
): Promise<boolean> {
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    authorization ?? '',
  )?.[1];
  if (!token) return false;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const pem = await certs.cert(header.kid);
    if (!pem) return false;
    const { payload } = await jwtVerify(token, await importX509(pem, 'RS256'), {
      issuer: CHAT_SENDER,
      algorithms: ['RS256'],
      clockTolerance: 60,
      requiredClaims: ['exp', 'iss', 'aud'],
    });
    return /^\d{6,20}$/.test(String(payload.aud));
  } catch {
    return false;
  }
}

/**
 * Whether `authorization` is Google Chat's, for this address: a Google ID
 * token for `chat@system.gserviceaccount.com`, verified as Google documents
 * ("Verify requests from Google Chat", HTTP endpoint URL as the audience).
 */
export async function fromGoogleChat(
  authorization: string | undefined,
  audience: string,
  keys: GoogleKeys,
  issuers: string[] = ISSUERS,
): Promise<boolean> {
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    authorization ?? '',
  )?.[1];
  // No token, no address of its own to be for, or no issuer to come from: nothing is accepted.
  if (!token || !/^https:\/\/\S+$/.test(audience) || !issuers.length) return false;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const key = await keys.key(header.kid);
    if (!key) return false;
    const { payload } = await jwtVerify(token, await importJWK(key, 'RS256'), {
      issuer: issuers,
      audience,
      algorithms: ['RS256'],
      clockTolerance: 60,
      requiredClaims: ['exp', 'iss', 'aud'],
    });
    return payload.email === CHAT_SENDER && payload.email_verified === true;
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return false;
    return false;
  }
}

interface ChatUser {
  name: string;
  displayName?: string;
  type?: 'HUMAN' | 'BOT';
}

interface ChatMessage {
  name: string;
  sender?: ChatUser;
  text?: string;
  argumentText?: string;
  annotations?: { type?: string; userMention?: { user?: ChatUser } }[];
}

interface ChatEvent {
  type?: string;
  eventTime?: string;
  space?: {
    name: string;
    type?: string;
    spaceType?: string;
    displayName?: string;
    singleUserBotDm?: boolean;
  };
  user?: ChatUser;
  message?: {
    name: string;
    text?: string;
    argumentText?: string;
    annotations?: { type?: string; userMention?: { user?: ChatUser } }[];
  };
  action?: { actionMethodName?: string; parameters?: { key: string; value: string }[] };
  common?: { invokedFunction?: string; parameters?: Record<string, string> };
}

/** Google Chat through a Chat app and a service account's key (ADR 0084). */
export class GoogleChatAdapter implements ChannelAdapter {
  readonly kind = 'googlechat' as const;
  /** In a space, Chat delivers only what mentions the app (ADR 0075). */
  readonly groups = true;
  #token?: { value: string; expiresAt: number };
  #dms = new Map<string, string>();
  readonly #keys: GoogleKeys;
  readonly #chatCerts: ChatCerts;
  #seen?: Map<string, number>;
  #spaces = new Map<string, { direct: boolean; name: string }>();

  constructor(
    private readonly secrets: GoogleChatSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {
    this.#keys = new GoogleKeys(endpoints.googleCerts ?? GOOGLE_CERTS);
    this.#chatCerts = new ChatCerts(endpoints.googleChatCerts ?? CHAT_CERTS);
  }

  get #api() {
    return this.endpoints.googleChat ?? GOOGLE_CHAT_API;
  }

  /** An access token for the app, from the service account's key. */
  async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now() + 5 * 60_000) return this.#token.value;
    const account = serviceAccountOf(this.secrets.serviceAccount);
    const tokenUrl = this.endpoints.googleToken ?? GOOGLE_TOKEN_URL;
    let key;
    try {
      key = await importPKCS8(account.private_key, 'RS256');
    } catch {
      throw new ChannelError('auth', 'That key file’s private key can’t be read.', {
        field: 'serviceAccount',
      });
    }
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.client_email)
      .setAudience(tokenUrl)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChannelError('network', `Couldn’t reach Google (${(error as Error).message}).`);
    }
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      if (response.status >= 500)
        throw new ChannelError('network', `Google had a problem (${response.status}).`);
      throw new ChannelError(
        'auth',
        body.error === 'invalid_grant'
          ? 'Google doesn’t accept that service account’s key any more. It was probably deleted: add a new key and paste it.'
          : `Google didn’t accept that key (${body.error ?? response.status}).`,
        { field: 'serviceAccount' },
      );
    }
    this.#token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }

  async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = await this.accessToken(signal);
    let response: Response;
    try {
      response = await fetch(`${this.#api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach Google Chat (${(error as Error).message}).`, token),
      );
    }
    const data = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string; status?: string };
    };
    if (response.ok) return data;
    const said = redact(data.error?.message ?? '', token);
    if (response.status === 401) {
      this.#token = undefined;
      throw new ChannelError('auth', 'Google Chat doesn’t accept the app’s key any more.', {
        field: 'serviceAccount',
      });
    }
    if (response.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(said))
      throw new ChannelError(
        'setup',
        'The Google Chat API isn’t on in this Google Cloud project. Turn it on (APIs & Services → Library → Google Chat API), then press Repair.',
      );
    if (response.status === 404 && /chat app not found|bot/i.test(said))
      throw new ChannelError(
        'setup',
        'This project has no Chat app yet. In the Google Chat API’s Configuration, fill in the app’s name and address, then press Repair.',
      );
    if (response.status === 429)
      throw new ChannelError('rate-limit', 'Google Chat asked Conch to slow down.', {
        retryAfterMs: 2_000,
      });
    if (response.status >= 500)
      throw new ChannelError('network', `Google Chat had a problem (${response.status}).`);
    throw new ChannelError(
      'refused',
      `Google Chat said no (${response.status}${said ? `: ${said}` : ''}).`,
    );
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    const account = serviceAccountOf(this.secrets.serviceAccount);
    await this.accessToken(signal);
    // A call the app may make, to know the Chat API is on for its project.
    await this.call('GET', '/v1/spaces?pageSize=1', undefined, signal);
    return {
      id: account.client_email,
      name: account.project_id ? `Chat app in ${account.project_id}` : 'Google Chat app',
      ...(account.project_id && { workspace: account.project_id }),
      chatUrl: 'https://chat.google.com/',
    };
  }

  hook() {
    const url = this.endpoints.door?.hookUrl(this.secrets.hookId ?? '');
    return url ? { url } : {};
  }

  connect(events: ChannelEvents): ChannelConnection {
    const door = this.endpoints.door;

    let closed = false;
    const health = async () => {
      if (closed) return;
      if (!this.hook().url) {
        events.state('error', {
          message:
            door?.status().state === 'starting'
              ? 'Turning on the public address Google Chat delivers to…'
              : 'Google Chat can’t reach Conch yet: turn on its public address on this channel’s page.',
        });
        return;
      }
      try {
        await this.accessToken();
        if (!closed) events.state('online');
      } catch (error) {
        const failure =
          error instanceof ChannelError ? error : new ChannelError('network', String(error));
        events.state(failure.code === 'auth' ? 'needs-token' : 'error', {
          message: failure.message,
        });
      }
    };

    let toldAudience = false;
    // Approvals are numbered replies, read like any message: from Google Chat's own copy.
    const choices = new TextChoices();
    const ok = { status: 200, body: '{}', type: 'application/json' } as const;
    const deliver = async (request: HookRequest): Promise<HookReply> => {
      if (request.method !== 'POST') return { status: 405 };
      // The audience is this channel's own public address, as the door was set up:
      // never anything the request says about where it was sent (Host, X-Forwarded-*).
      const url = this.hook().url;
      // Nothing is read before Google's token for this address checks out.
      if (
        !url ||
        !(await fromGoogleChat(
          request.headers.authorization,
          url,
          this.#keys,
          this.endpoints.googleIssuers,
        ))
      ) {
        // Google Chat set to the "project number" audience: a genuine token, but never
        // taken. Say which setting to change, once.
        if (
          !toldAudience &&
          (await projectNumberToken(request.headers.authorization, this.#chatCerts))
        ) {
          toldAudience = true;
          events.state('error', {
            message:
              'Google Chat is set to sign with the project number. In the Google Chat API’s Configuration, set Authentication Audience to “HTTP endpoint URL”, then save.',
          });
        }
        return { status: 401 };
      }
      if (toldAudience) {
        toldAudience = false;
        events.state('online');
      }
      let event: ChatEvent;
      try {
        event = JSON.parse(request.body) as ChatEvent;
      } catch {
        return { status: 400 };
      }
      events.heard?.();
      // A token lasts an hour and isn't bound to the body: an event must be fresh, and
      // what it says is read back from Google Chat, where each one is claimed once.
      const time = event.eventTime ? Date.parse(event.eventTime) : Number.NaN;
      if (!Number.isFinite(time) || Math.abs(Date.now() - time) > FRESH_MS) return ok;
      void this.#event(event, events, choices).catch(() => undefined);
      return ok;
    };

    const unmount = door?.mount(this.secrets.hookId ?? '', 'googlechat', deliver);
    const offDoor = door?.onChange(() => {
      events.changed?.();
      void health();
    });
    events.state('connecting');
    void health();

    const send = async (chatId: string, markdown: string, options?: SendOptions) => {
      const refs: SentRef[] = [];
      const words = options?.buttons?.length
        ? TextChoices.render(markdown, options.buttons)
        : markdown;
      for (const part of fit(words, PART, (p) => toGoogleChat(p).length)) {
        const sent = await this.call<{ name: string }>('POST', `/v1/${chatId}/messages`, {
          text: toGoogleChat(part) || '…',
        });
        refs.push({ chatId, messageId: sent.name });
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
        await this.call('PATCH', `/v1/${ref.messageId}?updateMask=text`, {
          text: toGoogleChat(fit(words, PART, (p) => p.length)[0] ?? '…'),
        });
        if (options?.buttons?.length) choices.remember(ref, options.buttons);
      },
      // Chat shows no typing for apps.
      typing: () => Promise.resolve(),
      download: () =>
        Promise.reject(new ChannelError('refused', 'Conch can’t take files from Google Chat yet.')),
      directChat: (userId) => this.#directChat(userId),
      close: () => {
        closed = true;
        unmount?.();
        offDoor?.();
      },
    };
  }

  async #directChat(userId: string): Promise<string> {
    const user = appId(userId);
    const known = this.#dms.get(user);
    if (known) return known;
    const space = await this.call<{ name: string }>(
      'GET',
      `/v1/spaces:findDirectMessage?name=${encodeURIComponent(user)}`,
    );
    this.#dms.set(user, space.name);
    return space.name;
  }

  // ── Taking each event once ─────────────────────────────────────────────

  #seenPath() {
    const home = this.endpoints.home;
    return home && this.secrets.hookId
      ? join(home, 'channels', `googlechat-${this.secrets.hookId}.json`)
      : undefined;
  }

  /**
   * Claim an event as taken: true the first time, false ever after (for longer
   * than a token lasts, across a restart). Synchronous, so two copies arriving
   * together can't both pass; the disk only follows what's already claimed.
   */
  #claim(id: string): boolean {
    if (!this.#seen) {
      this.#seen = new Map();
      const path = this.#seenPath();
      if (path)
        try {
          const raw = JSON.parse(readFileSync(path, 'utf8')) as { seen?: [string, number][] };
          for (const [key, at] of raw.seen ?? [])
            if (typeof key === 'string' && typeof at === 'number') this.#seen.set(key, at);
        } catch {
          // Missing or damaged: freshness still turns away anything older than a few minutes.
        }
    }
    const now = Date.now();
    for (const [key, at] of this.#seen) if (now - at > REMEMBER_MS) this.#seen.delete(key);
    if (this.#seen.has(id)) return false;
    this.#seen.set(id, now);
    while (this.#seen.size > SEEN) this.#seen.delete(this.#seen.keys().next().value ?? '');
    const path = this.#seenPath();
    if (path)
      void writeFileAtomic(path, `${JSON.stringify({ seen: [...this.#seen] })}\n`).catch(
        () => undefined,
      );
    return true;
  }

  // ── Reading an event: the server's copy, never the posted body ──────────

  /** A message as Google Chat itself has it, read with the app's own token. */
  async #serverCopy(name: string): Promise<ChatMessage | undefined> {
    if (!/^spaces\/[\w-]+\/messages\/[\w.-]+$/.test(name)) return undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.call<ChatMessage>('GET', `/v1/${name}`);
      } catch (error) {
        if (
          error instanceof ChannelError &&
          error.code !== 'network' &&
          error.code !== 'rate-limit'
        )
          return undefined;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    return undefined;
  }

  /** A space as Google Chat itself has it: a direct message, or a space with its name. */
  async #space(name: string): Promise<{ direct: boolean; name: string } | undefined> {
    const known = this.#spaces.get(name);
    if (known) return known;
    if (!/^spaces\/[\w-]+$/.test(name)) return undefined;
    const space = await this.call<{
      spaceType?: string;
      type?: string;
      singleUserBotDm?: boolean;
      displayName?: string;
    }>('GET', `/v1/${name}`).catch(() => undefined);
    if (!space) return undefined;
    const found = {
      direct:
        space.spaceType === 'DIRECT_MESSAGE' ||
        space.type === 'DM' ||
        space.singleUserBotDm === true,
      name: space.displayName || 'A Google Chat space',
    };
    this.#spaces.set(name, found);
    return found;
  }

  /**
   * Act on an event. Google's token only proves Google sent it, not that the
   * body is the one it sent (a token captured in the hour it lasts could carry
   * another body). So who wrote what, and where, is read again from Google
   * Chat with the app's own token, only that copy is acted on, and it's
   * claimed by the name Google gives it, which the body can't change. Card
   * clicks aren't taken at all: who clicked is only ever in the body.
   */
  async #event(event: ChatEvent, events: ChannelEvents, choices: TextChoices) {
    if (event.type === 'MESSAGE' && event.message?.name) {
      const copy = await this.#serverCopy(event.message.name);
      const sender = copy?.sender;
      if (!copy || !sender?.name || sender.type === 'BOT') return;
      const spaceName = copy.name.replace(/\/messages\/.*$/, '');
      const space = await this.#space(spaceName);
      // Claimed after the reads, in one synchronous step: the first copy wins.
      if (!space || !this.#claim(`m:${copy.name}`)) return;
      // Its display name comes from the event, but the person is the server's.
      const shown = event.user?.name === sender.name ? event.user.displayName : sender.displayName;
      const user: ChannelUser = { id: personId(sender.name), name: shown || 'Someone' };
      if (space.direct) {
        this.#dms.set(sender.name, spaceName);
        // A numbered reply to a question: the person who answers is the server's sender.
        const answer = choices.match(spaceName, copy.text ?? '');
        if (answer) {
          events.press({
            chatId: spaceName,
            user,
            data: answer.data,
            message: answer.ref,
            ack: () => Promise.resolve(),
          });
          return;
        }
        events.message({
          chatId: spaceName,
          messageId: copy.name,
          user,
          text: copy.text ?? '',
          files: [],
          direct: true,
        });
        return;
      }
      // In a space, Chat delivers only what mentions the app; argumentText is the rest.
      const mentioned = (copy.annotations ?? []).some(
        (a) => a.type === 'USER_MENTION' && a.userMention?.user?.type === 'BOT',
      );
      events.message({
        chatId: spaceName,
        messageId: copy.name,
        user,
        text: (mentioned ? copy.argumentText : copy.text)?.trim() ?? '',
        files: [],
        direct: false,
        mentioned,
        group: space.name,
      });
      return;
    }
    // Added to a space: it shows on the channel's page, off (nothing more: nobody is let in).
    if (event.type === 'ADDED_TO_SPACE' && event.space?.name) {
      const space = await this.#space(event.space.name);
      if (!space || space.direct || !this.#claim(`a:${event.space.name}`)) return;
      events.message({
        chatId: event.space.name,
        messageId: `added-${event.space.name}`,
        user: {
          id: personId(event.user?.name ?? 'users/unknown'),
          name: 'Someone',
          anonymous: true,
        },
        text: '',
        files: [],
        direct: false,
        mentioned: false,
        group: space.name,
      });
    }
  }
}
