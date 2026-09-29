import { randomBytes } from 'node:crypto';

import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { guardedFetch, safeAuthorizeUrl, type Reach } from './net';
import type { IntegrationStore, OAuthSecrets } from './store';

/** How long a sign-in page stays valid after you open it. */
export const FLOW_TTL_MS = 10 * 60_000;
/** Refresh this long before the access token expires. */
const REFRESH_EARLY_MS = 2 * 60_000;

export class NeedsAuthError extends Error {}

/** Where the sign-in page was opened: a popup closes itself afterwards, a tab goes back. */
export type FlowDisplay = 'popup' | 'tab';

interface Pending {
  integrationId: string;
  display: FlowDisplay;
  serverUrl: string;
  redirectUrl: string;
  reach: Reach;
  verifier?: string;
  expiresAt: number;
}

/**
 * One integration's OAuth state, read from and written to the secrets file.
 * The MCP SDK drives the protocol (RFC 9728 discovery, RFC 7591 dynamic
 * registration, PKCE S256, RFC 8707 resource indicators, refresh); this
 * class only decides where things are kept.
 */
class StoredProvider implements OAuthClientProvider {
  authorizeUrl?: URL;

  constructor(
    private readonly store: IntegrationStore,
    private readonly id: string,
    private readonly oauth: OAuthSecrets,
    readonly redirectUrl: string,
    private readonly flow?: Pending & { state: string },
  ) {}

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Conch',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // A public client: there's nowhere safe to keep a client secret, so PKCE does that job.
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    return this.flow?.state ?? randomBytes(32).toString('base64url');
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    // Registered for a different address (you opened Conch another way): register again.
    if (this.oauth.redirectUrl !== this.redirectUrl) return undefined;
    return this.oauth.client as OAuthClientInformationMixed | undefined;
  }

  async saveClientInformation(client: OAuthClientInformationMixed) {
    this.oauth.client = client as Record<string, unknown>;
    this.oauth.redirectUrl = this.redirectUrl;
    await this.#save();
  }

  tokens(): OAuthTokens | undefined {
    return this.oauth.tokens as OAuthTokens | undefined;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.oauth.tokens = tokens as Record<string, unknown>;
    this.oauth.expiresAt =
      typeof tokens.expires_in === 'number' ? Date.now() + tokens.expires_in * 1000 : undefined;
    await this.#save();
  }

  redirectToAuthorization(url: URL) {
    this.authorizeUrl = url;
  }

  saveCodeVerifier(verifier: string) {
    if (this.flow) this.flow.verifier = verifier;
  }

  codeVerifier(): string {
    if (!this.flow?.verifier) throw new NeedsAuthError('This sign-in has expired. Try again.');
    return this.flow.verifier;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.oauth.discovery as OAuthDiscoveryState | undefined;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState) {
    this.oauth.discovery = state as unknown as Record<string, unknown>;
    await this.#save();
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') delete this.oauth.client;
    if (scope === 'all' || scope === 'tokens') {
      delete this.oauth.tokens;
      delete this.oauth.expiresAt;
    }
    if (scope === 'all' || scope === 'discovery') delete this.oauth.discovery;
    await this.#save();
  }

  async #save() {
    await this.store.updateSecrets(this.id, (s) => ({ ...s, oauth: { ...this.oauth } }));
  }
}

/**
 * Sign-in flows for OAuth integrations. `state` is 256 random bits, kept
 * only in memory, single-use and valid for ten minutes; the PKCE verifier
 * never leaves the gateway. Refreshes are single-flight per integration, so
 * two turns starting at once can't both spend a rotating refresh token.
 */
export class OAuthFlows {
  #pending = new Map<string, Pending>();
  #refreshing = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly store: IntegrationStore,
    private readonly fetchFor: (reach: Reach) => typeof fetch = (reach) => guardedFetch(reach),
  ) {}

  /** Discover, register if needed, and return the page to sign in on. */
  async start(input: {
    integrationId: string;
    serverUrl: string;
    redirectUrl: string;
    reach: Reach;
    display: FlowDisplay;
  }): Promise<URL> {
    this.#sweep();
    const state = randomBytes(32).toString('base64url');
    const flow: Pending & { state: string } = {
      ...input,
      state,
      expiresAt: Date.now() + FLOW_TTL_MS,
    };
    const oauth = { ...(await this.store.secrets(input.integrationId)).oauth };
    // A fresh sign-in replaces old tokens; the SDK would otherwise try to refresh them.
    delete oauth.tokens;
    delete oauth.expiresAt;
    const provider = new StoredProvider(
      this.store,
      input.integrationId,
      oauth,
      input.redirectUrl,
      flow,
    );
    const result = await auth(provider, {
      serverUrl: input.serverUrl,
      fetchFn: this.fetchFor(input.reach),
    });
    const url = provider.authorizeUrl;
    if (result !== 'REDIRECT' || !url) throw new Error('The service didn’t offer a sign-in page.');
    if (!safeAuthorizeUrl(url, input.reach))
      throw new Error('The service’s sign-in page isn’t a secure address, so Conch won’t open it.');
    this.#pending.set(state, flow);
    return url;
  }

  /** Is there a sign-in waiting for this integration? */
  isPending(integrationId: string): boolean {
    this.#sweep();
    return [...this.#pending.values()].some((p) => p.integrationId === integrationId);
  }

  /** Which integration a sign-in is for (without using it up). */
  pendingFor(state: string): { integrationId: string; display: FlowDisplay } | undefined {
    const flow = this.#pending.get(state);
    return flow && { integrationId: flow.integrationId, display: flow.display };
  }

  cancel(integrationId: string) {
    for (const [state, flow] of this.#pending)
      if (flow.integrationId === integrationId) this.#pending.delete(state);
  }

  /** Finish a sign-in from the redirect. Returns the integration it was for. */
  async finish(
    state: string,
    code: string,
  ): Promise<{ integrationId: string; display: FlowDisplay }> {
    const flow = this.#pending.get(state);
    // Single use, whatever happens next: a replayed redirect finds nothing.
    this.#pending.delete(state);
    if (!flow || flow.expiresAt < Date.now())
      throw new NeedsAuthError('This sign-in link has expired or was already used. Try again.');
    const oauth = { ...(await this.store.secrets(flow.integrationId)).oauth };
    const provider = new StoredProvider(this.store, flow.integrationId, oauth, flow.redirectUrl, {
      ...flow,
      state,
    });
    await auth(provider, {
      serverUrl: flow.serverUrl,
      authorizationCode: code,
      fetchFn: this.fetchFor(flow.reach),
    });
    return { integrationId: flow.integrationId, display: flow.display };
  }

  /**
   * A usable access token, refreshed first if it's about to expire. Throws
   * `NeedsAuthError` when you have to sign in again.
   */
  accessToken(integrationId: string, serverUrl: string, reach: Reach): Promise<string | undefined> {
    const running = this.#refreshing.get(integrationId);
    if (running) return running;
    const task = this.#accessToken(integrationId, serverUrl, reach).finally(() =>
      this.#refreshing.delete(integrationId),
    );
    this.#refreshing.set(integrationId, task);
    return task;
  }

  async #accessToken(integrationId: string, serverUrl: string, reach: Reach) {
    const oauth = { ...(await this.store.secrets(integrationId)).oauth };
    const tokens = oauth.tokens as OAuthTokens | undefined;
    if (!tokens?.access_token) throw new NeedsAuthError('Not signed in yet.');
    const fresh = !oauth.expiresAt || oauth.expiresAt - REFRESH_EARLY_MS > Date.now();
    if (fresh) return tokens.access_token;
    if (!tokens.refresh_token || !oauth.redirectUrl)
      throw new NeedsAuthError('Your sign-in has expired.');
    const provider = new StoredProvider(this.store, integrationId, oauth, oauth.redirectUrl);
    const result = await auth(provider, { serverUrl, fetchFn: this.fetchFor(reach) }).catch(
      (error: unknown) => {
        throw new NeedsAuthError(`Couldn’t renew your sign-in: ${(error as Error).message}`);
      },
    );
    const renewed = provider.tokens()?.access_token;
    if (result !== 'AUTHORIZED' || !renewed) throw new NeedsAuthError('Your sign-in has expired.');
    return renewed;
  }

  /** Forget a token the server rejected, so the next attempt asks you to sign in. */
  async invalidate(integrationId: string) {
    await this.store.updateSecrets(integrationId, (s) => {
      if (!s.oauth) return s;
      const { tokens: _t, expiresAt: _e, ...rest } = s.oauth;
      return { ...s, oauth: rest };
    });
  }

  #sweep() {
    const now = Date.now();
    for (const [state, flow] of this.#pending)
      if (flow.expiresAt < now) this.#pending.delete(state);
  }
}
