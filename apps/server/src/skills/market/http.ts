/**
 * How Discover talks to the places skills come from (ADR 0074): https only,
 * through the SSRF guard (`guardedFetch('public')`), to the hosts a source
 * names and nowhere else (a redirect anywhere else stops there), with a
 * timeout, and every body read only up to a cap. A refusal becomes a
 * `MarketError` a person can read; a caller's abort stays an abort.
 */
import { EndpointError, guardedFetch } from '../../integrations/net';

export type MarketErrorCode =
  'offline' | 'limited' | 'not-found' | 'refused' | 'too-big' | 'changed';

/** One plain sentence, and what kind of trouble it is. */
export class MarketError extends Error {
  constructor(
    readonly code: MarketErrorCode,
    message: string,
    /** For `limited`: when it may ask again (ms), when the place said. */
    readonly retryAt?: number,
  ) {
    super(message);
  }
}

export interface HttpDeps {
  /** What the guard sends through; tests hand in a fake. */
  fetch?: typeof fetch;
  /** Conch's version, for `user-agent`. */
  version: string;
  now?: () => number;
}

/** A JSON answer, or "nothing new" for a request that sent the last ETag. */
export type JsonAnswer = { status: 'fresh'; json: unknown; etag?: string } | { status: 'same' };

/** The body, stopping the moment it passes `cap`. */
export async function readCapped(response: Response, cap: number, what: string): Promise<Buffer> {
  const big = () => new MarketError('too-big', `${what} is bigger than Conch reads.`);
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel().catch(() => undefined);
    throw big();
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw big();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * A client held to `hosts`. `label` names the place in what a person reads:
 * "Conch couldn’t reach ClawHub."
 */
export class MarketHttp {
  readonly #via: typeof fetch;

  constructor(
    readonly label: string,
    hosts: readonly string[],
    private readonly deps: HttpDeps,
  ) {
    const base = deps.fetch ?? fetch;
    const only: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.protocol !== 'https:' || !hosts.includes(url.hostname))
        return Promise.reject(
          new MarketError(
            'refused',
            `${label} sent Conch on to ${url.hostname}, which isn’t ${label}, so Conch stopped there.`,
          ),
        );
      return base(input, init);
    };
    this.#via = guardedFetch('public', only);
  }

  offline(why = `Conch couldn’t reach ${this.label}.`) {
    return new MarketError('offline', why);
  }

  /** One request; its failures as `MarketError`s. */
  async send(
    url: string,
    init: { headers?: Record<string, string>; ms?: number; signal?: AbortSignal } = {},
  ): Promise<{ response: Response; signal: AbortSignal }> {
    const timeout = AbortSignal.timeout(init.ms ?? 15_000);
    const both = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await this.#via(url, {
        headers: { 'user-agent': `Conch/${this.deps.version}`, ...init.headers },
        signal: both,
      });
      return { response, signal: both };
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (error instanceof MarketError) throw error;
      if (error instanceof EndpointError)
        throw /Couldn’t find/.test(error.message)
          ? this.offline()
          : new MarketError('refused', error.message);
      throw timeout.aborted
        ? this.offline(`${this.label} took too long to answer.`)
        : this.offline();
    }
  }

  /** What a refusal means. */
  failure(response: Response): MarketError {
    const status = response.status;
    if (
      status === 429 ||
      (status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
    ) {
      const now = (this.deps.now ?? Date.now)();
      const after = Number(response.headers.get('retry-after'));
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      return new MarketError(
        'limited',
        `${this.label} asked Conch to wait a little before asking again.`,
        Number.isFinite(after) && after > 0
          ? now + after * 1000
          : Number.isFinite(reset) && reset > 0
            ? reset * 1000
            : now + 60_000,
      );
    }
    if (status === 404 || status === 410 || status === 451)
      return new MarketError('not-found', `${this.label} doesn’t have that any more.`);
    if (status >= 500) return this.offline(`${this.label} isn’t answering properly just now.`);
    return new MarketError('refused', `${this.label} refused that request (HTTP ${status}).`);
  }

  /** JSON, sending the last ETag so an unchanged answer costs nothing. */
  async json(
    url: string,
    init: {
      etag?: string;
      headers?: Record<string, string>;
      cap?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<JsonAnswer> {
    const { response, signal } = await this.send(url, {
      headers: {
        accept: 'application/json',
        ...init.headers,
        ...(init.etag && { 'if-none-match': init.etag }),
      },
      ...(init.signal && { signal: init.signal }),
    });
    if (response.status === 304) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 'same' };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw this.failure(response);
    }
    const bytes = await this.#read(response, init.cap ?? 4 * 1024 * 1024, signal, init.signal);
    try {
      const etag = response.headers.get('etag') ?? undefined;
      return {
        status: 'fresh',
        json: JSON.parse(bytes.toString('utf8')) as unknown,
        ...(etag && { etag }),
      };
    } catch {
      throw this.offline(`${this.label} answered with something Conch couldn’t read.`);
    }
  }

  /** Bytes, up to `cap`. */
  async bytes(
    url: string,
    init: { cap: number; what: string; headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<Buffer> {
    const { response, signal } = await this.send(url, {
      ms: 60_000,
      ...(init.headers && { headers: init.headers }),
      ...(init.signal && { signal: init.signal }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw this.failure(response);
    }
    try {
      return await readCapped(response, init.cap, init.what);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (error instanceof MarketError) throw error;
      throw signal.aborted ? this.offline('The download took too long.') : this.offline();
    }
  }

  async #read(response: Response, cap: number, both: AbortSignal, signal?: AbortSignal) {
    try {
      return await readCapped(response, cap, `What ${this.label} sent`);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof MarketError) throw error;
      throw both.aborted ? this.offline(`${this.label} took too long to answer.`) : this.offline();
    }
  }
}
