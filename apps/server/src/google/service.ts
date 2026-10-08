import { createHash, randomBytes } from 'node:crypto';
import {
  accessOf,
  capabilitiesFor,
  GoogleAccessChange,
  GoogleConfigure,
  GoogleImport,
  GoogleComplete,
  GoogleConnect,
  GoogleProduct,
  GmailPasswordConnect,
  levelRank,
  lowerLevel,
  parseGoogleCredentials,
  productOf,
  type GoogleAccessMap,
  type GoogleAccount,
  type GoogleCapability,
  type GoogleLevel,
  type GoogleStatus,
} from '@conch/protocol';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { safeEqual } from '../auth/secrets';
import { ChannelError } from '../channels/types';
import { GmailImap, type GmailLogin } from './imap';
import { type GoogleStore, type Credential, type GoogleData, type GoogleLimits } from './store';

const AUTH = 'https://www.googleapis.com/auth/';
/**
 * What Conch asks Google for, per capability: the narrowest scopes that do
 * the job. Write asks for Gmail's compose (drafts and sending), Calendar's
 * events and Drive's per-file access (only files Conch makes), never a whole
 * Drive or a whole mailbox's settings.
 */
export const SCOPES: Record<GoogleCapability, string[]> = {
  'mail-read': [`${AUTH}gmail.readonly`],
  'mail-draft': [`${AUTH}gmail.readonly`, `${AUTH}gmail.compose`],
  'mail-send': [`${AUTH}gmail.readonly`, `${AUTH}gmail.compose`],
  'calendar-read': [`${AUTH}calendar.events.readonly`],
  'calendar-write': [`${AUTH}calendar.events`],
  'drive-read': [`${AUTH}drive.metadata.readonly`],
  'drive-write': [`${AUTH}drive.metadata.readonly`, `${AUTH}drive.file`],
};
/**
 * Every set of scopes that already does a job: a broader scope Google
 * granted (to this app, earlier) counts, so nobody is asked twice.
 */
const SATISFIED_BY: Record<GoogleCapability, string[][]> = {
  'mail-read': [[`${AUTH}gmail.readonly`], [`${AUTH}gmail.modify`], ['https://mail.google.com/']],
  'mail-draft': [
    [`${AUTH}gmail.readonly`, `${AUTH}gmail.compose`],
    [`${AUTH}gmail.modify`],
    ['https://mail.google.com/'],
  ],
  'mail-send': [
    [`${AUTH}gmail.readonly`, `${AUTH}gmail.compose`],
    [`${AUTH}gmail.modify`],
    ['https://mail.google.com/'],
  ],
  'calendar-read': [
    [`${AUTH}calendar.events.readonly`],
    [`${AUTH}calendar.events`],
    [`${AUTH}calendar.readonly`],
    [`${AUTH}calendar`],
  ],
  'calendar-write': [[`${AUTH}calendar.events`], [`${AUTH}calendar`]],
  'drive-read': [
    [`${AUTH}drive.metadata.readonly`],
    [`${AUTH}drive.metadata`],
    [`${AUTH}drive.readonly`],
    [`${AUTH}drive`],
  ],
  'drive-write': [[`${AUTH}drive.metadata.readonly`, `${AUTH}drive.file`], [`${AUTH}drive`]],
};
const ALL_CAPABILITIES = Object.keys(SCOPES) as GoogleCapability[];
/** Whether these scopes do this job. */
export const satisfies = (scopes: readonly string[], capability: GoogleCapability) =>
  SATISFIED_BY[capability].some((set) => set.every((s) => scopes.includes(s)));
export const APP_PASSWORD_ONLY_MAIL =
  'This account is signed in with a Gmail app password, which only reaches Gmail. Google Calendar and Google Drive need Google sign-in: add the same address with Google sign-in in Apps.';
/** A product's name, for messages. */
export const PRODUCT_NAMES: Record<GoogleProduct, string> = {
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  drive: 'Google Drive',
};
/** What each capability lets Conch do, in a person's words (and a model's). */
export const DOING: Record<GoogleCapability, string> = {
  'mail-read': 'read Gmail',
  'mail-draft': 'save Gmail drafts',
  'mail-send': 'send email',
  'calendar-read': 'read Google Calendar',
  'calendar-write': 'change Google Calendar',
  'drive-read': 'look in Google Drive',
  'drive-write': 'make files in Google Drive',
};
/** Everything an app password reaches: Gmail, all of it (IMAP and SMTP). */
const PASSWORD_GRANTS: GoogleAccessMap = { gmail: 'write' };

/**
 * Each account as the rest of Conch sees it: what the sign-in allows
 * (`granted`), held to what the person chose (`access`, and `capabilities`
 * from it). Never a credential.
 */
export function accountsOf(data: GoogleData): GoogleAccount[] {
  const shape = (profile: GoogleAccount, granted: GoogleAccessMap): GoogleAccount => {
    const limit: GoogleLimits = Object.hasOwn(data.limits, profile.id)
      ? (data.limits[profile.id] ?? {})
      : {};
    const access: GoogleAccessMap = {};
    for (const product of GoogleProduct.options) {
      const level = lowerLevel(granted[product], limit[product]);
      if (level !== 'off') access[product] = level;
    }
    return { ...profile, capabilities: capabilitiesFor(access), access, granted };
  };
  return [
    ...Object.values(data.accounts).map((a) =>
      shape(a.profile, accessOf(capabilities(a.credential.scopes))),
    ),
    ...Object.values(data.passwords).map((p) => shape(p.profile, PASSWORD_GRANTS)),
  ];
}
/** One account as `accountsOf` describes it. */
const accountOf = (data: GoogleData, id: string) => accountsOf(data).find((a) => a.id === id);
/** Why an account can't do this job in Conch, in words for the person and the model. */
export function notAllowed(account: GoogleAccount, capability: GoogleCapability): GoogleError {
  const product = productOf(capability);
  if (account.via === 'app-password' && product !== 'gmail')
    return new GoogleError('scope', APP_PASSWORD_ONLY_MAIL);
  const granted = levelRank(account.granted?.[product]);
  const needed = capability.endsWith('-read') ? 1 : 2;
  return new GoogleError(
    'scope',
    granted >= needed
      ? `${account.email} is set so Conch can’t ${DOING[capability]}. The person can change that in Apps → ${PRODUCT_NAMES[product]} → Google accounts (Read & write).${capability === 'mail-send' ? ' Offer that, or a draft instead.' : ''}`
      : `Google hasn’t allowed Conch to ${DOING[capability]} for ${account.email} yet${granted === 1 ? ': this sign-in is read only' : ''}. The person can allow it in Apps → ${PRODUCT_NAMES[product]} → Google accounts (Read & write asks Google once).${capability === 'mail-send' ? ' Offer that, or a draft instead.' : ''}`,
  );
}
/** An app-password account's id: the same address is the same account. */
export const passwordId = (address: string) =>
  `pw-${createHash('sha256').update(address.trim().toLowerCase()).digest('base64url').slice(0, 24)}`;
/** A failed IMAP call in Google's words: a refused password, a setting to change, or a blip. */
export function toGoogleError(error: unknown): GoogleError {
  if (error instanceof GoogleError) return error;
  if (error instanceof ChannelError)
    return new GoogleError(
      error.code === 'auth'
        ? 'expired'
        : error.code === 'setup'
          ? 'setup'
          : error.code === 'network'
            ? 'unavailable'
            : 'invalid',
      error.code === 'auth'
        ? 'Gmail didn’t take that app password. Make a new one at Google and paste it.'
        : error.message,
    );
  return new GoogleError('unavailable', 'Gmail could not be reached. Try again shortly.');
}
export class GoogleError extends Error {
  constructor(
    readonly kind:
      | 'setup'
      | 'expired'
      | 'scope'
      | 'consent'
      | 'unavailable'
      | 'invalid'
      | 'ambiguous'
      | 'not-executed',
    message: string,
  ) {
    super(message);
  }
}
const Profile = z.object({
  sub: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  email: z.email(),
  email_verified: z.literal(true),
  name: z.string().optional(),
});
type Config = NonNullable<GoogleData['config']>;
interface Pending {
  config: Config;
  origin: string;
  redirectUrl: string;
  mode: 'automatic' | 'manual';
  accountId?: string;
  generation?: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  capabilities: GoogleCapability[];
}
function capabilities(scopes: readonly string[]): GoogleCapability[] {
  return ALL_CAPABILITIES.filter((c) => satisfies(scopes, c));
}
const fail = () =>
  new GoogleError(
    'unavailable',
    'Google could not be reached. Your connection is kept; try again shortly.',
  );

function oauthErrorCode(error: unknown): string {
  const parsed = z
    .object({ response: z.object({ data: z.object({ error: z.string() }) }) })
    .safeParse(error);
  return parsed.success ? parsed.data.response.data.error : '';
}
/** Never reflect Google's description, which may contain credentials or user-controlled text. */
function consentMessage(code: string): string {
  switch (code) {
    case 'cancelled':
      return 'Google sign-in cancelled. Your existing accounts are unchanged.';
    case 'access_denied':
      return 'Google access was not approved. Sign in again when ready. If Google blocked the app, add your email under Google Auth Platform → Audience → Test users. Work accounts may need administrator approval.';
    case 'admin_policy_enforced':
    case 'org_internal':
      return 'Your Google Workspace organization restricts this app. Ask its administrator to allow it, or use your personal Google account.';
    case 'invalid_client':
    case 'deleted_client':
      return 'Google no longer accepts this app’s credentials. In Google Auth Platform → Clients, download a current OAuth client JSON and import it in Google app setup.';
    case 'redirect_uri_mismatch':
      return 'Google rejected the callback address. For a Web client, register the exact address shown in Google app setup, or import a Desktop app client.';
    case 'invalid_grant':
      return 'This Google sign-in code expired or was already used. Start a new sign-in from Conch.';
    default:
      return 'Google sign-in could not be verified. Start again from Conch. If Google shows an error, open Sign-in help below.';
  }
}

async function forbiddenMessage(
  response: Response,
  capability: GoogleCapability,
): Promise<{ kind: 'setup' | 'scope'; message: string }> {
  const product = productOf(capability);
  const service =
    product === 'gmail'
      ? 'Gmail API'
      : product === 'calendar'
        ? 'Google Calendar API'
        : 'Google Drive API';
  const reader = response.body?.getReader();
  let text = '';
  try {
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16_384) {
          await reader.cancel();
          break;
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
    }
    const data = z
      .object({
        error: z.object({
          errors: z.array(z.object({ reason: z.string().optional() })).optional(),
          details: z.array(z.object({ reason: z.string().optional() })).optional(),
        }),
      })
      .safeParse(JSON.parse(text));
    const reasons = data.success
      ? [...(data.data.error.errors ?? []), ...(data.data.error.details ?? [])].map((e) => e.reason)
      : [];
    if (reasons.some((reason) => reason === 'SERVICE_DISABLED' || reason === 'accessNotConfigured'))
      return {
        kind: 'setup',
        message: `Enable ${service} in your Google Cloud project, then press Check connection. Your sign-in is saved; no new consent is needed.`,
      };
    if (
      reasons.some((reason) => reason === 'domainPolicy' || reason === 'ORG_RESTRICTION_VIOLATION')
    )
      return {
        kind: 'setup',
        message: `Your Google Workspace administrator restricts ${service}. Ask them to allow this app, then press Check connection.`,
      };
  } catch {
    /* Upstream details stay private, including malformed errors. */
  } finally {
    reader?.releaseLock();
  }
  return {
    kind: 'scope',
    message: `Google refused ${service} access. Reconnect and allow the requested permissions; also check that this API is enabled in your Google project.`,
  };
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** A body that isn't JSON (a Drive upload): its exact bytes and type. */
  raw?: { contentType: string; body: string };
  query?: Record<string, string>;
  authorization?: string;
  signal?: AbortSignal;
  /** Statuses that are an answer, not a failure (409: it exists already; 410: it's gone). */
  expect?: number[];
}
/** What may be read: Gmail's messages and drafts, calendars' events, Drive's files. */
const READS =
  /^\/(gmail\/v1\/users\/me\/(messages|drafts)(\/|$)|calendar\/v3\/calendars\/|drive\/v3\/files)/;
const SEGMENT = '[A-Za-z0-9_.%@-]{1,1100}';
/** Every change Conch can make at Google, and the one capability each needs. */
const WRITES: { method: ApiOptions['method']; path: RegExp; capability: GoogleCapability }[] = [
  { method: 'POST', path: /^\/gmail\/v1\/users\/me\/drafts$/, capability: 'mail-draft' },
  { method: 'POST', path: /^\/gmail\/v1\/users\/me\/messages\/send$/, capability: 'mail-send' },
  // The same send, for an email too big for JSON (files): uploaded whole.
  {
    method: 'POST',
    path: /^\/upload\/gmail\/v1\/users\/me\/messages\/send$/,
    capability: 'mail-send',
  },
  {
    method: 'POST',
    path: new RegExp(`^/calendar/v3/calendars/${SEGMENT}/events$`),
    capability: 'calendar-write',
  },
  {
    method: 'PATCH',
    path: new RegExp(`^/calendar/v3/calendars/${SEGMENT}/events/[a-z0-9_]{1,1024}$`, 'i'),
    capability: 'calendar-write',
  },
  {
    method: 'DELETE',
    path: new RegExp(`^/calendar/v3/calendars/${SEGMENT}/events/[a-z0-9_]{1,1024}$`, 'i'),
    capability: 'calendar-write',
  },
  { method: 'POST', path: /^\/upload\/drive\/v3\/files$/, capability: 'drive-write' },
];

/** Native Google account connection. Credentials never enter a provider, model, tool result or URL. */
export class GoogleService {
  #pending = new Map<string, Pending>();
  #processing = new Map<string, Pending>();
  #finished = new Map<string, { accountId?: string; message?: string; expiresAt: number }>();
  #refreshing = new Map<string, Promise<Credential>>();
  /** Recent app-password tries: a few a minute is a person; more is someone guessing. */
  #tries: number[] = [];
  /** Told when an account is connected with these capabilities, so their apps show again. */
  onConnected?: (capabilities: GoogleCapability[]) => Promise<void>;
  constructor(
    readonly store: GoogleStore,
    private readonly clientFor: (config: Config) => OAuth2Client = (c) =>
      new OAuth2Client({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        redirectUri: c.redirectUrl,
        transporterOptions: { timeout: 20_000, maxRedirects: 0 },
      }),
    private readonly fetcher: typeof fetch = fetch,
    readonly imap: GmailImap = new GmailImap(),
  ) {}
  /**
   * Gmail's app password, so talking to you by email can be offered the same
   * one in a tap (ADR 0052), the way the email channel's is offered to Gmail
   * (ADR 0048). Only ever read on the gateway; the browser learns the address.
   * A password Gmail stopped taking isn't offered.
   */
  async gmailLogin(): Promise<{ address: string; password: string } | undefined> {
    const data = await this.store.read();
    if (data.apps.gmail?.hidden) return undefined;
    const login = Object.values(data.passwords).find(
      (p) =>
        p.profile.state === 'ready' &&
        accountOf(data, p.profile.id)?.capabilities.includes('mail-read'),
    );
    return login && { address: login.address, password: login.password };
  }

  async status(): Promise<GoogleStatus> {
    const data = await this.store.read();
    return {
      configured: !!data.config,
      clientType: data.config?.clientType,
      projectId: data.config?.projectId,
      callbackUrl: data.config?.redirectUrl,
      accounts: accountsOf(data),
    };
  }

  /**
   * One product's level for one account, as the person chose it. Lower is
   * always possible; higher only as far as the sign-in allows. Beyond that
   * Google must be asked (`consent`): the web app starts that sign-in.
   */
  async setAccess(id: string, raw: unknown): Promise<GoogleStatus> {
    const change = GoogleAccessChange.parse(raw);
    let raised = false;
    await this.store.update((data) => {
      const account = accountOf(data, id);
      if (!account)
        throw new GoogleError('invalid', 'That Google account isn’t connected any more.');
      const product = change.product;
      if (levelRank(change.level) > levelRank(account.granted?.[product]))
        throw new GoogleError(
          'consent',
          account.via === 'app-password' && product !== 'gmail'
            ? APP_PASSWORD_ONLY_MAIL
            : `Google needs to allow this first. Sign in to Google again for ${account.email} to give Conch ${change.level === 'write' ? 'read and write' : 'read'} access to ${PRODUCT_NAMES[product]}.`,
        );
      raised = levelRank(change.level) > levelRank(account.access?.[product]);
      data.limits[id] = { ...(data.limits[id] ?? {}), [product]: change.level };
    });
    const status = await this.status();
    if (raised) {
      const account = status.accounts.find((a) => a.id === id);
      if (account) await this.onConnected?.(account.capabilities).catch(() => undefined);
    }
    return status;
  }

  /** Whether this change would let Conch do more than it can now (a person confirms it's them). */
  async raises(id: string, raw: unknown): Promise<boolean> {
    const change = GoogleAccessChange.safeParse(raw);
    if (!change.success) return true;
    const account = accountOf(await this.store.read(), id);
    return levelRank(change.data.level) > levelRank(account?.access?.[change.data.product]);
  }

  // ── Gmail with an app password (ADR 0048) ───────────────────────────────

  /** Whether this account signs in with an app password (Gmail only, over IMAP). */
  async viaPassword(id: string): Promise<boolean> {
    return Boolean((await this.store.read()).passwords[id]);
  }

  /**
   * Check the app password by signing in to Gmail, then keep it sealed. The
   * same address again replaces its password (a new one after a revoke).
   */
  async connectPassword(raw: unknown): Promise<GoogleStatus> {
    const parsed = GmailPasswordConnect.safeParse(raw);
    if (!parsed.success)
      throw new GoogleError(
        'invalid',
        parsed.error.issues[0]?.path[0] === 'password'
          ? 'An app password is 16 letters, like “abcd efgh ijkl mnop”.'
          : 'Enter your Gmail address.',
      );
    const input = parsed.data;
    const now = Date.now();
    this.#tries = this.#tries.filter((t) => now - t < 10 * 60_000);
    if (this.#tries.length >= 10)
      throw new GoogleError(
        'invalid',
        'That’s a lot of tries. Wait a few minutes, then make a new app password and paste it.',
      );
    this.#tries.push(now);
    const id = passwordId(input.address);
    if (input.accountId && input.accountId !== id)
      throw new GoogleError(
        'invalid',
        'That app password is for another address. Connect it as a new account instead.',
      );
    try {
      await this.imap.verify({ address: input.address, password: input.password });
    } catch (error) {
      throw toGoogleError(error);
    }
    let level = (input.access ?? 'read') as GoogleLevel;
    await this.store.update((data) => {
      const known = Object.hasOwn(data.limits, id) ? data.limits[id] : undefined;
      // A new password for an account keeps what it was allowed; a new account gets what was chosen.
      level =
        input.access ?? (Object.hasOwn(data.passwords, id) ? known?.gmail : undefined) ?? 'read';
      data.limits[id] = { ...known, gmail: level };
      // "Use an app password instead": a Google sign-in for the same address stops using
      // Gmail, so Gmail has one account for it; its Calendar and Drive carry on.
      if (level !== 'off')
        for (const [googleId, google] of Object.entries(data.accounts))
          if (google.profile.email.toLowerCase() === input.address.toLowerCase())
            data.limits[googleId] = { ...data.limits[googleId], gmail: 'off' };
      data.passwords[id] = {
        profile: {
          id,
          email: input.address,
          name: input.address,
          capabilities: capabilitiesFor(PASSWORD_GRANTS),
          state: 'ready',
          checkedAt: Date.now(),
          via: 'app-password',
        },
        address: input.address,
        password: input.password,
        generation: randomBytes(24).toString('base64url'),
      };
    });
    if (level !== 'off')
      await this.onConnected?.(capabilitiesFor({ gmail: level })).catch(() => undefined);
    return this.status();
  }

  /** The sign-in a Gmail tool uses, for one job the person allows. Never leaves the gateway. */
  async passwordLogin(
    id: string,
    capability: GoogleCapability = 'mail-read',
  ): Promise<GmailLogin & { generation: string }> {
    const data = await this.store.read();
    const login = Object.hasOwn(data.passwords, id) ? data.passwords[id] : undefined;
    if (!login) throw new GoogleError('expired', 'That Gmail account isn’t connected any more.');
    const account = accountOf(data, id);
    if (account && !account.capabilities.includes(capability))
      throw notAllowed(account, capability);
    if (login.profile.state === 'needs-auth')
      throw new GoogleError(
        'expired',
        'Gmail stopped taking this app password. Paste a new one in Apps → Gmail.',
      );
    return { address: login.address, password: login.password, generation: login.generation };
  }

  /** What a failed Gmail call means for the account: a refused password needs a new one. */
  async passwordFailed(id: string, generation: string, error: unknown): Promise<GoogleError> {
    const failure = toGoogleError(error);
    const state =
      failure.kind === 'expired'
        ? 'needs-auth'
        : failure.kind === 'unavailable'
          ? 'unavailable'
          : undefined;
    if (state)
      await this.store.update((data) => {
        const login = data.passwords[id];
        if (login?.generation !== generation) return;
        login.profile.state = state;
        login.profile.message = failure.message;
        login.profile.checkedAt = Date.now();
      });
    return failure;
  }

  async #checkPassword(id: string) {
    const login = (await this.store.read()).passwords[id];
    if (!login) throw new GoogleError('invalid', 'That Google account is not connected.');
    let failure: GoogleError | undefined;
    try {
      await this.imap.verify(login);
    } catch (error) {
      failure = toGoogleError(error);
    }
    await this.store.update((data) => {
      const item = data.passwords[id];
      if (item?.generation !== login.generation) return;
      item.profile.checkedAt = Date.now();
      if (!failure) {
        item.profile.state = 'ready';
        delete item.profile.message;
      } else {
        item.profile.state = failure.kind === 'expired' ? 'needs-auth' : 'unavailable';
        item.profile.message = failure.message;
      }
    });
    return this.status();
  }
  async configure(raw: unknown, origin: string) {
    const config = GoogleConfigure.parse(raw);
    if (config.clientType === 'desktop') delete config.redirectUrl;
    const url = config.redirectUrl ? new URL(config.redirectUrl) : undefined;
    if (
      config.clientType === 'web' &&
      (!url ||
        url.origin !== origin ||
        url.pathname !== '/oauth/google/callback' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
      throw new GoogleError(
        'invalid',
        'Use this Conch address with /oauth/google/callback. Remote sign-in needs HTTPS.',
      );
    await this.store.update((data) => {
      if (Object.keys(data.accounts).length && data.config?.clientId !== config.clientId)
        throw new GoogleError(
          'invalid',
          'Disconnect your Google accounts before changing the Google app.',
        );
      data.config = config;
    });
    this.#pending.clear();
    this.#processing.clear();
  }
  async importCredentials(raw: unknown, origin: string) {
    const { credentials } = GoogleImport.parse(raw);
    let config: Config;
    try {
      config = parseGoogleCredentials(credentials, `${origin}/oauth/google/callback`);
    } catch (error) {
      throw new GoogleError(
        'setup',
        error instanceof Error ? error.message : 'Choose the OAuth client JSON from Google.',
      );
    }
    await this.configure(config, origin);
  }
  async start(
    raw: unknown,
    origin: string,
  ): Promise<{ url: string; nonce: string; flowId: string; mode: 'automatic' | 'manual' }> {
    const input = GoogleConnect.parse(raw),
      data = await this.store.read(),
      config = data.config;
    if (!config) throw new GoogleError('setup', 'Finish Google app setup in Apps first.');
    if (
      config.clientType === 'web' &&
      (!config.redirectUrl || new URL(config.redirectUrl).origin !== origin)
    )
      throw new GoogleError(
        'invalid',
        'Open Conch at the registered callback address before connecting Google.',
      );
    const account = input.accountId ? data.accounts[input.accountId] : undefined;
    if (input.accountId && !account)
      throw new GoogleError('invalid', 'That Google account is no longer connected. Add it again.');
    for (const [s, p] of this.#pending) if (p.expiresAt < Date.now()) this.#pending.delete(s);
    if (this.#pending.size >= 20)
      throw new GoogleError('invalid', 'Finish an open Google sign-in before starting another.');
    const local = new URL(origin);
    const automatic =
      config.clientType === 'web' ||
      (local.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(local.hostname));
    const mode = automatic ? 'automatic' : 'manual';
    const redirectUrl =
      config.clientType === 'web' && config.redirectUrl
        ? config.redirectUrl
        : automatic
          ? `${origin}/oauth/google/callback`
          : 'http://127.0.0.1:1/';
    const client = this.clientFor({ ...config, redirectUrl }),
      pkce = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString('base64url'),
      nonce = randomBytes(32).toString('base64url');
    this.#pending.set(state, {
      config,
      origin,
      redirectUrl,
      mode,
      accountId: input.accountId,
      generation: account?.credential.generation,
      nonce,
      verifier: pkce.codeVerifier,
      expiresAt: Date.now() + 600_000,
      capabilities: input.capabilities,
    });
    const scopes = [
      ...new Set([
        'openid',
        'email',
        'profile',
        ...input.capabilities.flatMap((c) => SCOPES[c]),
        ...(config.clientType === 'desktop' ? (account?.credential.scopes ?? []) : []),
      ]),
    ];
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account consent',
      ...(config.clientType === 'web' ? { include_granted_scopes: true } : {}),
      scope: scopes,
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      login_hint: account?.profile.email,
    });
    return { url, nonce, flowId: state, mode };
  }
  cancel(state: string, nonce: string, origin: string, reason = 'cancelled') {
    const flow = this.#pending.get(state) ?? this.#processing.get(state);
    if (!flow || !safeEqual(flow.nonce, nonce) || flow.origin !== origin) return;
    this.#pending.delete(state);
    this.#processing.delete(state);
    this.#finished.set(state, { expiresAt: Date.now() + 600_000, message: consentMessage(reason) });
  }
  flowStatus(state: string) {
    for (const [key, value] of this.#finished)
      if (value.expiresAt < Date.now()) this.#finished.delete(key);
    const pending = this.#pending.get(state) ?? this.#processing.get(state);
    if (pending && pending.expiresAt > Date.now())
      return { state: 'pending' as const, mode: pending.mode, expiresAt: pending.expiresAt };
    const finished = this.#finished.get(state);
    return finished?.accountId
      ? { state: 'ready' as const, accountId: finished.accountId }
      : { state: 'failed' as const, ...(finished?.message ? { message: finished.message } : {}) };
  }
  async complete(state: string, raw: unknown, nonce: string, origin: string): Promise<void> {
    const { redirectUrl } = GoogleComplete.parse(raw);
    const flow = this.#pending.get(state);
    if (
      !flow ||
      flow.mode !== 'manual' ||
      flow.expiresAt < Date.now() ||
      !safeEqual(flow.nonce, nonce) ||
      flow.origin !== origin
    )
      throw new GoogleError(
        'expired',
        'This sign-in belongs to another browser or has expired. Start again here.',
      );
    const url = new URL(redirectUrl),
      expected = new URL(flow.redirectUrl);
    if (
      url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.get('state') !== state ||
      url.searchParams.getAll('code').length > 1 ||
      url.searchParams.getAll('error').length > 1
    )
      throw new GoogleError(
        'invalid',
        'Paste the complete return address from the Google window for this sign-in, including everything after the question mark.',
      );
    const error = url.searchParams.get('error');
    if (error) {
      this.cancel(state, nonce, origin, error);
      throw new GoogleError('invalid', consentMessage(error));
    }
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096)
      throw new GoogleError(
        'invalid',
        'The return address has no sign-in code. Finish Google consent, then copy the full address from the address bar.',
      );
    await this.finish(state, code, nonce, origin, 'manual');
  }
  async finish(
    state: string,
    code: string,
    nonce: string,
    origin: string,
    mode: 'automatic' | 'manual' = 'automatic',
  ): Promise<void> {
    const flow = this.#pending.get(state);
    this.#pending.delete(state);
    if (
      !flow ||
      flow.expiresAt < Date.now() ||
      !safeEqual(flow.nonce, nonce) ||
      flow.origin !== origin ||
      flow.mode !== mode
    )
      throw new GoogleError(
        'expired',
        'This Google sign-in expired or belongs to another browser. Start again.',
      );
    this.#processing.set(state, flow);
    try {
      const client = this.clientFor({ ...flow.config, redirectUrl: flow.redirectUrl });
      const { tokens } = await client.getToken({
        code,
        codeVerifier: flow.verifier,
        redirect_uri: flow.redirectUrl,
      });
      if (!tokens.access_token || !tokens.id_token)
        throw new GoogleError('expired', 'Google did not complete sign-in. Try connecting again.');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: flow.config.clientId,
      });
      const profile = Profile.parse(ticket.getPayload());
      if (flow.accountId && profile.sub !== flow.accountId)
        throw new GoogleError(
          'invalid',
          'That is a different Google account. Reconnect with the original account or choose Add account.',
        );
      const info = await client.getTokenInfo(tokens.access_token);
      if (info.aud !== flow.config.clientId || (info.sub && info.sub !== profile.sub))
        throw new GoogleError(
          'invalid',
          'Google returned a different account. Start sign-in again.',
        );
      const granted = capabilities(info.scopes);
      if (!flow.capabilities.every((c) => granted.includes(c)))
        throw new GoogleError(
          'scope',
          'Google did not allow everything needed for this job. Reconnect and allow the requested access.',
        );
      const accessToken = tokens.access_token;
      await this.store.update((data) => {
        if (this.#processing.get(state) !== flow || flow.expiresAt < Date.now())
          throw new GoogleError(
            'expired',
            'Google sign-in was cancelled or expired. Start again when ready.',
          );
        if (
          data.config?.clientId !== flow.config.clientId ||
          data.config.clientSecret !== flow.config.clientSecret ||
          data.config.clientType !== flow.config.clientType ||
          data.config.redirectUrl !== flow.config.redirectUrl
        )
          throw new GoogleError('expired', 'Google setup changed. Start sign-in again.');
        const previous = data.accounts[profile.sub];
        if (flow.accountId && previous?.credential.generation !== flow.generation)
          throw new GoogleError('expired', 'This account changed while signing in. Start again.');
        if (
          previous &&
          !flow.accountId &&
          previous.profile.capabilities.some((c) => !granted.includes(c))
        )
          throw new GoogleError(
            'scope',
            'That account is already connected with more access. Choose its existing entry below, or reconnect from that entry to add permissions without replacing the saved connection.',
          );
        data.accounts[profile.sub] = {
          profile: {
            id: profile.sub,
            email: profile.email,
            name: profile.name ?? profile.email,
            capabilities: granted,
            state: 'ready',
            checkedAt: Date.now(),
            via: 'google',
          },
          credential: {
            accessToken,
            refreshToken: tokens.refresh_token ?? previous?.credential.refreshToken,
            expiresAt: tokens.expiry_date ?? info.expiry_date,
            scopes: info.scopes,
            generation: randomBytes(24).toString('base64url'),
          },
        };
        // What was asked for is what the person chose: raised to it, never past it. Google may
        // say yes to more (scopes granted to this app before); that stays unused until chosen.
        const limit: GoogleLimits = { ...(previous ? data.limits[profile.sub] : undefined) };
        for (const [product, level] of Object.entries(accessOf(flow.capabilities)))
          if (levelRank(level) > levelRank(limit[product as GoogleProduct]))
            limit[product as GoogleProduct] = level;
        // The same address with an app password is replaced by Google's sign-in when it can do
        // at least as much in Gmail: one entry per address.
        const gmail = accessOf(granted).gmail;
        const replaced = new Set<string>();
        for (const [id, login] of Object.entries(data.passwords)) {
          if (login.address.toLowerCase() !== profile.email.toLowerCase()) continue;
          const held = Object.hasOwn(data.limits, id) ? data.limits[id]?.gmail : undefined;
          if (levelRank(gmail) < levelRank(held)) continue;
          if (levelRank(held) > levelRank(limit.gmail)) limit.gmail = held;
          replaced.add(id);
        }
        if (replaced.size) {
          data.passwords = Object.fromEntries(
            Object.entries(data.passwords).filter(([id]) => !replaced.has(id)),
          );
          data.limits = Object.fromEntries(
            Object.entries(data.limits).filter(([id]) => !replaced.has(id)),
          );
        }
        data.limits[profile.sub] = limit;
      });
      await this.onConnected?.(flow.capabilities).catch(() => undefined);
      const checked = await this.check(profile.sub);
      const result = checked.accounts.find((a) => a.id === profile.sub);
      this.#finished.set(state, {
        accountId: result?.state === 'ready' ? result.id : undefined,
        message: result?.state === 'ready' ? undefined : result?.message,
        expiresAt: Date.now() + 600_000,
      });
    } catch (error) {
      const failure =
        error instanceof GoogleError
          ? error
          : new GoogleError('expired', consentMessage(oauthErrorCode(error)));
      this.#finished.set(state, { message: failure.message, expiresAt: Date.now() + 600_000 });
      throw failure;
    } finally {
      this.#processing.delete(state);
    }
  }
  async credential(id: string, required: GoogleCapability, force = false): Promise<Credential> {
    const data = await this.store.read(),
      account = Object.hasOwn(data.accounts, id) ? data.accounts[id] : undefined;
    if (!account && Object.hasOwn(data.passwords, id))
      throw new GoogleError('scope', APP_PASSWORD_ONLY_MAIL);
    if (!account || !data.config || account.profile.state === 'needs-auth')
      throw new GoogleError('expired', 'Reconnect this Google account in Apps.');
    const shown = accountOf(data, id);
    if (shown && !shown.capabilities.includes(required)) throw notAllowed(shown, required);
    if (!satisfies(account.credential.scopes, required))
      throw new GoogleError(
        'scope',
        `Google hasn’t allowed Conch to ${DOING[required]} for ${account.profile.email}. Sign in again in Apps to allow it.`,
      );
    if (!force && account.credential.expiresAt > Date.now() + 120_000) return account.credential;
    const ensure = (c: Credential) => {
      if (!satisfies(c.scopes, required))
        throw new GoogleError(
          'scope',
          'Google no longer allows access for this job. Reconnect in Apps.',
        );
      return c;
    };
    const running = this.#refreshing.get(id);
    if (running) return running.then(ensure);
    const task = this.#refresh(id, data.config, account.credential).finally(() =>
      this.#refreshing.delete(id),
    );
    this.#refreshing.set(id, task);
    return task.then(ensure);
  }
  async #refresh(id: string, config: Config, old: Credential): Promise<Credential> {
    if (!old.refreshToken) {
      await this.#needsAuth(id, old.generation);
      throw new GoogleError('expired', 'Reconnect Google to renew access.');
    }
    try {
      const client = this.clientFor(config);
      client.setCredentials({ refresh_token: old.refreshToken });
      const { credentials } = await client.refreshAccessToken();
      if (!credentials.access_token || !credentials.expiry_date) throw fail();
      const next: Credential = {
        ...old,
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token ?? old.refreshToken,
        expiresAt: credentials.expiry_date,
        scopes: credentials.scope?.split(' ') ?? old.scopes,
      };
      await this.store.update((data) => {
        if (!Object.hasOwn(data.accounts, id))
          throw new GoogleError('expired', 'Google account changed. Try your job again.');
        const current = data.accounts[id];
        if (!current || current.credential.generation !== old.generation)
          throw new GoogleError('expired', 'Google account changed. Try your job again.');
        current.credential = next;
        current.profile.capabilities = capabilities(next.scopes);
        current.profile.state = 'ready';
        delete current.profile.message;
      });
      return next;
    } catch (error) {
      if (error instanceof GoogleError) throw error;
      const oauthError = (error as { response?: { data?: { error?: unknown } } }).response?.data
        ?.error;
      if (oauthError === 'invalid_grant' || oauthError === 'invalid_client') {
        await this.#needsAuth(id, old.generation);
        throw new GoogleError(
          'expired',
          'Google access expired or was revoked. Reconnect in Apps.',
        );
      }
      throw fail();
    }
  }
  async #needsAuth(id: string, generation: string) {
    await this.store.update((data) => {
      const a = data.accounts[id];
      if (a?.credential.generation === generation) {
        a.profile.state = 'needs-auth';
        a.profile.message = 'Reconnect Google to continue.';
      }
    });
  }
  /**
   * Only fixed, Google-owned API endpoints. No caller-provided origin or
   * redirects. Reads are the paths below; each write is one row of `WRITES`,
   * with the one capability it needs. Writes never retry.
   */
  async api(
    id: string,
    capability: GoogleCapability,
    path: string,
    options: ApiOptions = {},
  ): Promise<unknown> {
    return (await this.request(id, capability, path, options)).data;
  }

  /**
   * `api`, with the status too, for the few answers a write expects that
   * aren't a success (`expect`: an event that already exists, one that's gone).
   */
  async request(
    id: string,
    capability: GoogleCapability,
    path: string,
    options: ApiOptions = {},
  ): Promise<{ status: number; data: unknown }> {
    const method = options.method ?? 'GET';
    const write = method !== 'GET';
    if (
      path.includes('..') ||
      path.includes('?') ||
      path.includes('#') ||
      (!write && !READS.test(path))
    )
      throw new GoogleError('invalid', 'Unsupported Google action.');
    if (write) {
      const row = WRITES.find((w) => w.method === method && w.path.test(path));
      if (!row) throw new GoogleError('invalid', 'Unsupported Google action.');
      if (row.capability !== capability)
        throw new GoogleError(
          'invalid',
          row.capability === 'mail-send'
            ? 'Conch cannot send mail with draft access.'
            : 'Conch cannot make that change with this access.',
        );
    }
    const url = new URL(`https://www.googleapis.com${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
    let credential = await this.credential(id, capability);
    if (options.authorization && options.authorization !== this.#authorization(credential))
      throw new GoogleError(
        'expired',
        'Google access changed after approval. Start the job again.',
      );
    const perform = () => {
      if (options.signal?.aborted)
        throw new GoogleError('not-executed', 'Stopped before the Google request was dispatched.');
      return this.fetcher(url, {
        method,
        redirect: 'error',
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': options.raw?.contentType ?? 'application/json',
        },
        ...(options.raw
          ? { body: options.raw.body }
          : options.body !== undefined
            ? { body: JSON.stringify(options.body) }
            : {}),
      });
    };
    const uncertain = () =>
      new GoogleError(
        'ambiguous',
        capability === 'mail-draft'
          ? 'Google may have saved this draft. Check its receipt before trying again.'
          : 'Google may have done this already. Check before trying again.',
      );
    let response: Response;
    try {
      response = await perform();
      if (response.status === 401 && !write) {
        credential = await this.credential(id, capability, true);
        if (options.authorization && options.authorization !== this.#authorization(credential))
          throw new GoogleError(
            'expired',
            'Google access changed after approval. Start the job again.',
          );
        response = await perform();
      }
    } catch (error) {
      if (error instanceof GoogleError) throw error;
      throw write ? uncertain() : fail();
    }
    if (response.status === 401) {
      await this.#needsAuth(id, credential.generation);
      throw new GoogleError(
        'expired',
        write
          ? 'Google asked to sign in again, so nothing was changed. Reconnect this account in Apps.'
          : 'Reconnect Google to continue.',
      );
    }
    if (response.status === 403) {
      const error = await forbiddenMessage(response, capability);
      throw new GoogleError(error.kind, error.message);
    }
    if (options.expect?.includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, data: {} };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      // Google turned the request down: nothing happened. A server error might have, after all.
      if (write && response.status >= 400 && response.status < 500)
        throw new GoogleError(
          'not-executed',
          response.status === 404
            ? 'Google couldn’t find that. Nothing was changed.'
            : 'Google turned this change down, so nothing was changed. Check what was asked for and try once more.',
        );
      throw write ? uncertain() : fail();
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 2_000_000) {
            await reader.cancel();
            throw new GoogleError(
              'invalid',
              'Google returned too much content. Narrow your search.',
            );
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    // A deletion answers with nothing at all.
    if (!text.trim()) return { status: response.status, data: {} };
    try {
      return { status: response.status, data: JSON.parse(text) as unknown };
    } catch {
      if (write) throw uncertain();
      throw fail();
    }
  }
  async check(id: string) {
    const data = await this.store.read(),
      a = data.accounts[id];
    if (!a && data.passwords[id]) return this.#checkPassword(id);
    if (!a) throw new GoogleError('invalid', 'That Google account is not connected.');
    try {
      // One small read per product the person uses it for: proof the API answers.
      const uses = accountOf(data, id)?.capabilities ?? [];
      if (uses.includes('mail-read'))
        await this.api(id, 'mail-read', '/gmail/v1/users/me/messages', {
          query: { maxResults: '1' },
        });
      if (uses.includes('calendar-read'))
        await this.api(id, 'calendar-read', '/calendar/v3/calendars/primary/events', {
          query: { maxResults: '1' },
        });
      if (uses.includes('drive-read'))
        await this.api(id, 'drive-read', '/drive/v3/files', {
          query: { pageSize: '1', fields: 'files(id)' },
        });
      await this.store.update((d) => {
        const item = d.accounts[id];
        if (item?.credential.generation === a.credential.generation) {
          item.profile.checkedAt = Date.now();
          item.profile.state = 'ready';
          delete item.profile.message;
        }
      });
    } catch (error) {
      await this.store.update((d) => {
        const item = d.accounts[id];
        if (item?.credential.generation === a.credential.generation) {
          item.profile.state =
            error instanceof GoogleError && ['scope', 'expired'].includes(error.kind)
              ? 'needs-auth'
              : 'unavailable';
          item.profile.message = error instanceof GoogleError ? error.message : fail().message;
        }
      });
    }
    return this.status();
  }
  async disconnect(id: string): Promise<void> {
    for (const [s, p] of this.#pending) if (p.accountId === id) this.#pending.delete(s);
    const data = await this.store.read(),
      account = data.accounts[id];
    // An app password has nothing to revoke from here: it's forgotten, and the person can
    // remove it at Google too (the page says where).
    if (!account && data.passwords[id]) {
      await this.store.update((d) => {
        d.passwords = Object.fromEntries(Object.entries(d.passwords).filter(([key]) => key !== id));
        d.limits = Object.fromEntries(Object.entries(d.limits).filter(([key]) => key !== id));
      });
      return;
    }
    if (!account) return;
    // Remote revoke first; if offline, retain the account so revocation can be retried knowingly.
    try {
      const response = await this.fetcher('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: account.credential.refreshToken ?? account.credential.accessToken,
        }),
      });
      if (!response.ok && response.status !== 400) throw fail();
    } catch {
      throw new GoogleError(
        'unavailable',
        'Google could not revoke access. Try disconnecting again when online, or remove Conch in your Google account permissions.',
      );
    }
    await this.store.update((d) => {
      if (d.accounts[id]?.credential.generation === account.credential.generation) {
        d.accounts = Object.fromEntries(Object.entries(d.accounts).filter(([key]) => key !== id));
        d.limits = Object.fromEntries(Object.entries(d.limits).filter(([key]) => key !== id));
      }
    });
  }
  #authorization(c: Credential) {
    return createHash('sha256')
      .update(c.generation + '\n' + [...c.scopes].sort().join(' '))
      .digest('hex');
  }
  async verificationScope(id: string, required: GoogleCapability) {
    if (await this.viaPassword(id)) {
      if (productOf(required) !== 'gmail') throw new GoogleError('scope', APP_PASSWORD_ONLY_MAIL);
      const login = await this.passwordLogin(id, required);
      return {
        account: id,
        authorization: createHash('sha256').update(`${login.generation}\nimap`).digest('hex'),
        // An app password doesn't expire; an approval still only holds for a while.
        expiresAt: Date.now() + 3_600_000,
      };
    }
    const c = await this.credential(id, required);
    return { account: id, authorization: this.#authorization(c), expiresAt: c.expiresAt };
  }
}
