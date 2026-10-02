import { createHash, randomBytes } from 'node:crypto';
import {
  GoogleConfigure,
  GoogleConnect,
  type GoogleCapability,
  type GoogleStatus,
} from '@conch/protocol';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { safeEqual } from '../auth/secrets';
import { type GoogleStore, type Credential, type GoogleData } from './store';

export const SCOPES: Record<GoogleCapability, string[]> = {
  'mail-read': ['https://www.googleapis.com/auth/gmail.readonly'],
  'mail-draft': [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
  ],
  'calendar-read': ['https://www.googleapis.com/auth/calendar.events.readonly'],
  'drive-read': ['https://www.googleapis.com/auth/drive.metadata.readonly'],
};
const ALL_CAPABILITIES = Object.keys(SCOPES) as GoogleCapability[];
export class GoogleError extends Error {
  constructor(
    readonly kind: 'setup' | 'expired' | 'scope' | 'unavailable' | 'invalid' | 'ambiguous',
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
  accountId?: string;
  generation?: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  capabilities: GoogleCapability[];
}
const capabilities = (scopes: string[]) =>
  ALL_CAPABILITIES.filter((c) => SCOPES[c].every((s) => scopes.includes(s)));
const fail = () =>
  new GoogleError(
    'unavailable',
    'Google could not be reached. Your connection is kept; try again shortly.',
  );

/** Native Google account connection. Credentials never enter a provider, model, tool result or URL. */
export class GoogleService {
  #pending = new Map<string, Pending>();
  #processing = new Set<string>();
  #finished = new Map<string, { accountId?: string; expiresAt: number }>();
  #refreshing = new Map<string, Promise<Credential>>();
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
  ) {}
  async status(): Promise<GoogleStatus> {
    const data = await this.store.read();
    return {
      configured: !!data.config,
      callbackUrl: data.config?.redirectUrl,
      accounts: Object.values(data.accounts).map((a) => a.profile),
    };
  }
  async configure(raw: unknown, origin: string) {
    const config = GoogleConfigure.parse(raw);
    const url = new URL(config.redirectUrl);
    if (
      url.origin !== origin ||
      url.pathname !== '/oauth/google/callback' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
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
  }
  async start(
    raw: unknown,
    origin: string,
  ): Promise<{ url: string; nonce: string; flowId: string }> {
    const input = GoogleConnect.parse(raw),
      data = await this.store.read(),
      config = data.config;
    if (!config) throw new GoogleError('setup', 'Finish Google app setup in Integrations first.');
    if (new URL(config.redirectUrl).origin !== origin)
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
    const client = this.clientFor(config),
      pkce = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString('base64url'),
      nonce = randomBytes(32).toString('base64url');
    this.#pending.set(state, {
      config,
      accountId: input.accountId,
      generation: account?.credential.generation,
      nonce,
      verifier: pkce.codeVerifier,
      expiresAt: Date.now() + 600_000,
      capabilities: input.capabilities,
    });
    const scopes = [
      ...new Set(['openid', 'email', 'profile', ...input.capabilities.flatMap((c) => SCOPES[c])]),
    ];
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account consent',
      include_granted_scopes: true,
      scope: scopes,
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      login_hint: account?.profile.email,
    });
    return { url, nonce, flowId: state };
  }
  cancel(state: string) {
    if (this.#pending.delete(state)) this.#finished.set(state, { expiresAt: Date.now() + 600_000 });
  }
  flowStatus(state: string) {
    for (const [key, value] of this.#finished)
      if (value.expiresAt < Date.now()) this.#finished.delete(key);
    if (this.#processing.has(state)) return { state: 'pending' as const };
    const pending = this.#pending.get(state);
    if (pending && pending.expiresAt > Date.now()) return { state: 'pending' as const };
    const finished = this.#finished.get(state);
    return finished?.accountId
      ? { state: 'ready' as const, accountId: finished.accountId }
      : { state: 'failed' as const };
  }
  async finish(state: string, code: string, nonce: string, origin: string): Promise<void> {
    const flow = this.#pending.get(state);
    this.#pending.delete(state);
    if (
      !flow ||
      flow.expiresAt < Date.now() ||
      !safeEqual(flow.nonce, nonce) ||
      new URL(flow.config.redirectUrl).origin !== origin
    )
      throw new GoogleError(
        'expired',
        'This Google sign-in expired or belongs to another browser. Start again.',
      );
    this.#processing.add(state);
    try {
      const client = this.clientFor(flow.config);
      const { tokens } = await client.getToken({
        code,
        codeVerifier: flow.verifier,
        redirect_uri: flow.config.redirectUrl,
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
        if (
          data.config?.clientId !== flow.config.clientId ||
          data.config.clientSecret !== flow.config.clientSecret ||
          data.config.redirectUrl !== flow.config.redirectUrl
        )
          throw new GoogleError('expired', 'Google setup changed. Start sign-in again.');
        const previous = data.accounts[profile.sub];
        if (flow.accountId && previous?.credential.generation !== flow.generation)
          throw new GoogleError('expired', 'This account changed while signing in. Start again.');
        data.accounts[profile.sub] = {
          profile: {
            id: profile.sub,
            email: profile.email,
            name: profile.name ?? profile.email,
            capabilities: granted,
            state: 'ready',
            checkedAt: Date.now(),
          },
          credential: {
            accessToken,
            refreshToken: tokens.refresh_token ?? previous?.credential.refreshToken,
            expiresAt: tokens.expiry_date ?? info.expiry_date,
            scopes: info.scopes,
            generation: randomBytes(24).toString('base64url'),
          },
        };
      });
      const checked = await this.check(profile.sub);
      this.#finished.set(state, {
        accountId: checked.accounts.find((a) => a.id === profile.sub && a.state === 'ready')?.id,
        expiresAt: Date.now() + 600_000,
      });
    } catch (error) {
      if (error instanceof GoogleError) throw error;
      throw new GoogleError(
        'expired',
        'Google sign-in could not be verified. Start again from Integrations.',
      );
    } finally {
      this.#processing.delete(state);
    }
  }
  async credential(id: string, required: GoogleCapability, force = false): Promise<Credential> {
    const data = await this.store.read(),
      account = data.accounts[id];
    if (!account || !data.config || account.profile.state === 'needs-auth')
      throw new GoogleError('expired', 'Reconnect this Google account in Integrations.');
    if (!SCOPES[required].every((s) => account.credential.scopes.includes(s)))
      throw new GoogleError(
        'scope',
        `Allow ${required} for this Google account in Integrations first.`,
      );
    if (!force && account.credential.expiresAt > Date.now() + 120_000) return account.credential;
    const ensure = (c: Credential) => {
      if (!SCOPES[required].every((scope) => c.scopes.includes(scope)))
        throw new GoogleError(
          'scope',
          'Google no longer allows access for this job. Reconnect in Integrations.',
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
          'Google access expired or was revoked. Reconnect in Integrations.',
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
  /** Only fixed, Google-owned API endpoints. No caller-provided origin or redirects. Writes never retry. */
  async api(
    id: string,
    capability: GoogleCapability,
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      query?: Record<string, string>;
      authorization?: string;
    } = {},
  ): Promise<unknown> {
    if (
      !/^\/(gmail\/v1\/users\/me\/(messages|drafts)(\/|$)|calendar\/v3\/calendars\/|drive\/v3\/files)/.test(
        path,
      ) ||
      path.includes('..') ||
      path.includes('?') ||
      path.includes('#')
    )
      throw new GoogleError('invalid', 'Unsupported Google action.');
    if (options.method === 'POST' && path !== '/gmail/v1/users/me/drafts')
      throw new GoogleError('invalid', 'Conch can only create drafts; it cannot send mail.');
    const url = new URL(`https://www.googleapis.com${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
    let credential = await this.credential(id, capability);
    if (options.authorization && options.authorization !== this.#authorization(credential))
      throw new GoogleError(
        'expired',
        'Google access changed after approval. Start the job again.',
      );
    const perform = () =>
      this.fetcher(url, {
        method: options.method ?? 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json',
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    let response: Response;
    try {
      response = await perform();
      if (response.status === 401 && options.method !== 'POST') {
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
      throw options.method === 'POST'
        ? new GoogleError(
            'ambiguous',
            'Google may have saved this draft. Check its receipt before trying again.',
          )
        : fail();
    }
    if (response.status === 401) {
      await this.#needsAuth(id, credential.generation);
      throw new GoogleError('expired', 'Reconnect Google to continue.');
    }
    if (response.status === 403)
      throw new GoogleError(
        'scope',
        'Google refused this access. Check the requested permissions and enabled API in Integrations.',
      );
    if (!response.ok)
      throw options.method === 'POST'
        ? new GoogleError(
            'ambiguous',
            'Google did not confirm the draft. Check its receipt before trying again.',
          )
        : fail();
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
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw fail();
    }
  }
  async check(id: string) {
    const data = await this.store.read(),
      a = data.accounts[id];
    if (!a) throw new GoogleError('invalid', 'That Google account is not connected.');
    try {
      for (const c of a.profile.capabilities) {
        if (c === 'mail-read' || c === 'mail-draft')
          await this.api(id, c, '/gmail/v1/users/me/messages', { query: { maxResults: '1' } });
        if (c === 'calendar-read')
          await this.api(id, c, '/calendar/v3/calendars/primary/events', {
            query: { maxResults: '1' },
          });
        if (c === 'drive-read')
          await this.api(id, c, '/drive/v3/files', {
            query: { pageSize: '1', fields: 'files(id)' },
          });
      }
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
      if (d.accounts[id]?.credential.generation === account.credential.generation)
        d.accounts = Object.fromEntries(Object.entries(d.accounts).filter(([key]) => key !== id));
    });
  }
  #authorization(c: Credential) {
    return createHash('sha256')
      .update(c.generation + '\n' + [...c.scopes].sort().join(' '))
      .digest('hex');
  }
  async verificationScope(id: string, required: GoogleCapability) {
    const c = await this.credential(id, required);
    return { account: id, authorization: this.#authorization(c), expiresAt: c.expiresAt };
  }
}
