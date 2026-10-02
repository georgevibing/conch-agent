/**
 * Is this delivery really from Microsoft Teams? (ADR 0045)
 *
 * Every activity the Bot Framework sends a bot carries a JWT in its
 * `Authorization` header. It's checked exactly as Microsoft documents
 * (Bot Framework REST API, "Authenticate requests from the Bot Connector
 * service to your bot"), and as botbuilder's `ChannelValidation` does:
 *
 * 1. The signing key comes from Bot Framework's own OpenID metadata
 *    (`login.botframework.com`), fetched over HTTPS and cached for a day;
 *    a `kid` we don't know refreshes it, at most every five minutes.
 * 2. The key must be endorsed for the activity's channel (`msteams`).
 * 3. The signature (RS256/384/512 only: never `none`, never HMAC), the
 *    issuer (`https://api.botframework.com`), the audience (this bot's App
 *    ID) and the lifetime (five minutes of clock skew) are checked by `jose`.
 * 4. The token's `serviceurl` claim must equal the activity's `serviceUrl`,
 *    so a token for one place can't be replayed with an activity that sends
 *    replies (and the bot's own token) somewhere else.
 */
import {
  type JWK,
  type JWTPayload,
  decodeProtectedHeader,
  errors as joseErrors,
  importJWK,
  jwtVerify,
} from 'jose';

export const BOT_FRAMEWORK_OPENID =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';
export const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';
/** Allowed clock skew, as Microsoft's own validation allows. */
const SKEW_SECONDS = 5 * 60;
const KEYS_FOR_MS = 24 * 60 * 60_000;
const REFRESH_AT_MOST_EVERY_MS = 5 * 60_000;
const ALGORITHMS = ['RS256', 'RS384', 'RS512'];

export class TeamsAuthError extends Error {}

type EndorsedKey = JWK & { kid?: string; endorsements?: unknown };

/** Bot Framework's signing keys, from its OpenID metadata. */
export class BotFrameworkKeys {
  #keys = new Map<string, EndorsedKey>();
  #fetchedAt = 0;
  #loading?: Promise<void>;

  constructor(
    private readonly metadata = BOT_FRAMEWORK_OPENID,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async key(kid: string): Promise<EndorsedKey | undefined> {
    const stale = Date.now() - this.#fetchedAt > KEYS_FOR_MS;
    if (stale || (!this.#keys.has(kid) && Date.now() - this.#fetchedAt > REFRESH_AT_MOST_EVERY_MS))
      await this.#load().catch(() => undefined);
    return this.#keys.get(kid);
  }

  #load(): Promise<void> {
    this.#loading ??= (async () => {
      const get = async (url: string) => {
        if (!/^https:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(url))
          throw new TeamsAuthError('Bot Framework keys must come over HTTPS.');
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        if (!response.ok) throw new TeamsAuthError(`Bot Framework keys: ${response.status}`);
        return (await response.json()) as unknown;
      };
      const config = (await get(this.metadata)) as { jwks_uri?: string };
      if (!config.jwks_uri) throw new TeamsAuthError('Bot Framework metadata has no keys.');
      const jwks = (await get(config.jwks_uri)) as { keys?: EndorsedKey[] };
      const keys = new Map<string, EndorsedKey>();
      for (const key of jwks.keys ?? []) if (key.kid && key.kty === 'RSA') keys.set(key.kid, key);
      this.#keys = keys;
      this.#fetchedAt = Date.now();
    })().finally(() => (this.#loading = undefined));
    return this.#loading;
  }
}

/**
 * Check the `Authorization` header of a delivery for `activity`. Throws
 * `TeamsAuthError` (answered with 401/403, saying nothing more) on anything
 * short of every rule above.
 */
export async function verifyActivity(
  authorization: string | undefined,
  activity: { channelId?: unknown; serviceUrl?: unknown },
  appId: string,
  keys: BotFrameworkKeys,
  options: { issuer?: string } = {},
): Promise<JWTPayload> {
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    authorization ?? '',
  )?.[1];
  if (!token) throw new TeamsAuthError('No bearer token.');
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new TeamsAuthError('Not a JWT.');
  }
  if (typeof header.alg !== 'string' || !ALGORITHMS.includes(header.alg))
    throw new TeamsAuthError('Unexpected algorithm.');
  if (typeof header.kid !== 'string') throw new TeamsAuthError('No key id.');
  const key = await keys.key(header.kid);
  if (!key) throw new TeamsAuthError('Unknown signing key.');
  const channel = typeof activity.channelId === 'string' ? activity.channelId : '';
  // A key Microsoft endorsed for other channels doesn't speak for this one.
  if (Array.isArray(key.endorsements) && !key.endorsements.includes(channel))
    throw new TeamsAuthError('Key not endorsed for this channel.');
  const { endorsements: _, ...jwk } = key;
  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(token, await importJWK(jwk, header.alg), {
      issuer: options.issuer ?? BOT_FRAMEWORK_ISSUER,
      audience: appId,
      algorithms: ALGORITHMS,
      clockTolerance: SKEW_SECONDS,
      requiredClaims: ['exp', 'iss', 'aud'],
    });
    payload = verified.payload;
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) throw new TeamsAuthError(error.code);
    throw new TeamsAuthError('Invalid token.');
  }
  const claimed = payload.serviceurl ?? payload.serviceUrl;
  if (typeof claimed !== 'string' || claimed !== activity.serviceUrl)
    throw new TeamsAuthError('Service URL mismatch.');
  return payload;
}
