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
import { createHash } from 'node:crypto';

import type { ChannelBot, ChannelSecrets } from '@conch/protocol';
import {
  type JWK,
  SignJWT,
  decodeProtectedHeader,
  errors as joseErrors,
  importJWK,
  importPKCS8,
  jwtVerify,
} from 'jose';

import type { ChannelEndpoints } from './adapters';
import type { HookReply, HookRequest } from './door';
import { blocks, fit, inline, prose } from './format';
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
/** Who Google Chat's tokens are about. */
export const CHAT_SENDER = 'chat@system.gserviceaccount.com';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SCOPE = 'https://www.googleapis.com/auth/chat.bot';

type GoogleChatSecrets = Extract<ChannelSecrets, { kind: 'googlechat' }>;

/** Chat takes 4096 characters a message; parts this long stay under. */
const PART = 3900;
const SEEN = 1000;
const STALE_MS = 60 * 60_000;
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

/** Google's signing keys for ID tokens, cached by key id. */
export class GoogleKeys {
  #keys = new Map<string, JWK>();
  #fetchedAt = 0;
  #loading?: Promise<void>;

  constructor(private readonly url = GOOGLE_CERTS) {}

  async key(kid: string): Promise<JWK | undefined> {
    const stale = Date.now() - this.#fetchedAt > KEYS_FOR_MS;
    if (stale || (!this.#keys.has(kid) && Date.now() - this.#fetchedAt > REFRESH_AT_MOST_EVERY_MS))
      await this.#load().catch(() => undefined);
    return this.#keys.get(kid);
  }

  #load(): Promise<void> {
    this.#loading ??= (async () => {
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
  if (!token) return false;
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

  constructor(
    private readonly secrets: GoogleChatSecrets,
    private readonly endpoints: ChannelEndpoints = {},
  ) {
    this.#keys = new GoogleKeys(endpoints.googleCerts ?? GOOGLE_CERTS);
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
    const seen = new Set<string>();

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

    const deliver = async (request: HookRequest): Promise<HookReply> => {
      if (request.method !== 'POST') return { status: 405 };
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
      )
        return { status: 401 };
      let event: ChatEvent;
      try {
        event = JSON.parse(request.body) as ChatEvent;
      } catch {
        return { status: 400 };
      }
      events.heard?.();
      const time = event.eventTime ? Date.parse(event.eventTime) : Date.now();
      if (Number.isFinite(time) && Date.now() - time > STALE_MS)
        return { status: 200, body: '{}', type: 'application/json' };
      const fingerprint = createHash('sha256').update(request.body).digest('base64url');
      if (seen.has(fingerprint)) return { status: 200, body: '{}', type: 'application/json' };
      seen.add(fingerprint);
      if (seen.size > SEEN) seen.delete(seen.values().next().value ?? '');
      this.#event(event, events);
      return { status: 200, body: '{}', type: 'application/json' };
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
      const parts = fit(markdown, PART, (p) => toGoogleChat(p).length);
      for (const [index, part] of parts.entries()) {
        const last = index === parts.length - 1;
        const sent = await this.call<{ name: string }>('POST', `/v1/${chatId}/messages`, {
          text: toGoogleChat(part) || '…',
          ...(last && options?.buttons?.length && { cardsV2: cards(options) }),
        });
        refs.push({ chatId, messageId: sent.name });
      }
      return refs;
    };

    return {
      send,
      edit: async (ref, markdown, options) => {
        await this.call('PATCH', `/v1/${ref.messageId}?updateMask=text,cardsV2`, {
          text: toGoogleChat(fit(markdown, PART, (p) => p.length)[0] ?? '…'),
          cardsV2: options?.buttons?.length ? cards(options) : [],
        });
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

  #event(event: ChatEvent, events: ChannelEvents) {
    const space = event.space;
    const sender = event.user;
    if (!space?.name || !sender?.name || sender.type === 'BOT') return;
    const user: ChannelUser = { id: personId(sender.name), name: sender.displayName || 'Someone' };
    const direct =
      space.type === 'DM' || space.spaceType === 'DIRECT_MESSAGE' || space.singleUserBotDm === true;
    if (direct) this.#dms.set(sender.name, space.name);
    if (event.type === 'CARD_CLICKED') {
      const data =
        event.common?.parameters?.data ??
        event.action?.parameters?.find((p) => p.key === 'data')?.value;
      if (!data) return;
      events.press({
        chatId: space.name,
        user,
        data,
        message: { chatId: space.name, messageId: event.message?.name ?? '' },
        ack: () => Promise.resolve(),
      });
      return;
    }
    // Added to a space: it shows on the channel's page, off.
    if (event.type === 'ADDED_TO_SPACE' && !direct) {
      events.message({
        chatId: space.name,
        messageId: `added-${event.eventTime ?? Date.now()}`,
        user,
        text: '',
        files: [],
        direct: false,
        mentioned: false,
        group: space.displayName || 'A Google Chat space',
      });
      return;
    }
    if (event.type !== 'MESSAGE' || !event.message) return;
    const message = event.message;
    if (direct) {
      events.message({
        chatId: space.name,
        messageId: message.name,
        user,
        text: message.text ?? '',
        files: [],
        direct: true,
      });
      return;
    }
    // In a space, Chat delivers only what mentions the app; argumentText is the rest.
    const mentioned = (message.annotations ?? []).some(
      (a) => a.type === 'USER_MENTION' && a.userMention?.user?.type === 'BOT',
    );
    events.message({
      chatId: space.name,
      messageId: message.name,
      user,
      text: (mentioned ? message.argumentText : message.text)?.trim() ?? '',
      files: [],
      direct: false,
      mentioned,
      group: space.displayName || 'A Google Chat space',
    });
  }
}

/** A card with the question's buttons; a click comes back with the button's data. */
function cards(options: SendOptions) {
  return [
    {
      cardId: 'conch-ask',
      card: {
        sections: [
          {
            widgets: [
              {
                buttonList: {
                  buttons: (options.buttons ?? []).map((b) => ({
                    text: b.label,
                    onClick: {
                      action: { function: 'conch', parameters: [{ key: 'data', value: b.data }] },
                    },
                    ...(b.style === 'primary' && {
                      color: { red: 0.1, green: 0.45, blue: 0.9, alpha: 1 },
                    }),
                  })),
                },
              },
            ],
          },
        ],
      },
    },
  ];
}
