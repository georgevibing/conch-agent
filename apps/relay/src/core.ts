/**
 * The always-on relay (ADR 0140): a tiny program somewhere that's always on
 * (a free Cloudflare Worker, a Raspberry Pi, a small VPS) that takes the
 * webhooks meant for Conch while the computer Conch runs on is off, and keeps
 * them, sealed to a key only the gateway holds, until the gateway is back.
 *
 * It is one fetch handler (`Request` in, `Response` out), the same on every
 * platform; `node.ts` and `worker.ts` only adapt it.
 *
 * - `GET|POST /hooks/<id>`: a delivery. Only addresses the gateway registered
 *   (by hash) are taken; it's sealed at once (`envelope.ts`) and queued. When
 *   the gateway is listening, it is handed over straight away and the
 *   gateway's own answer goes back to the sender; otherwise the sender gets a
 *   plain 200 and the delivery waits (at most a week).
 * - `/relay/v1/…`: the gateway's side, with the token whose hash the relay was
 *   set up with: `next` (long poll), `ack`, `hooks`, `status`.
 *
 * Nothing it keeps can be read by whoever runs it: deliveries are ciphertext,
 * the token is a hash, the addresses are hashes. What it does see, and what it
 * could do if it were taken over, is in the ADR's threat model.
 */
import {
  b64url,
  hookTag,
  RELAY_INFO,
  relayAad,
  sameBytes,
  seal,
  sha256,
  keyId as keyIdOf,
  type RelaySetup,
} from './envelope.ts';
import type { RelayStore, StoredItem } from './store.ts';

export const RELAY_PROTOCOL = 1;

export interface RelayLimits {
  /** Deliveries kept at most. */
  maxItems: number;
  /** Bytes of ciphertext kept at most. */
  maxBytes: number;
  /** Deliveries kept for one address at most, so one busy address can't crowd out the rest. */
  perHook: number;
  /** How long a delivery is kept. */
  ttlMs: number;
  /** The biggest delivery taken. */
  bodyLimit: number;
  /** Deliveries per address per minute. */
  perHookPerMinute: number;
  /** Deliveries per minute, all addresses together. */
  perMinute: number;
  /** A delivery handed to the gateway and not acknowledged in this long is handed over again. */
  leaseMs: number;
  /** How long a sender waits for the gateway's own answer when the gateway is listening. */
  replyWaitMs: number;
  /** The longest a `next` may wait for something to arrive. */
  maxWaitMs: number;
  /** Addresses the gateway may register. */
  maxHooks: number;
}

export const DEFAULT_LIMITS: RelayLimits = {
  maxItems: 2_000,
  maxBytes: 32 * 1024 * 1024,
  perHook: 500,
  ttlMs: 7 * 24 * 60 * 60_000,
  bodyLimit: 1024 * 1024,
  perHookPerMinute: 240,
  perMinute: 1_200,
  leaseMs: 60_000,
  replyWaitMs: 9_000,
  maxWaitMs: 25_000,
  maxHooks: 500,
};

/** What the sender hears when the gateway answered it itself. */
export interface HookAnswer {
  status: number;
  body?: string;
  type?: string;
}

/** What the gateway opens: the request as the sender made it, and when it reached the relay. */
export interface Delivery {
  v: 1;
  id: string;
  receivedAt: number;
  hookId: string;
  method: 'GET' | 'POST';
  query: Record<string, string>;
  /** What came after `?`, exactly as sent: a signature may cover it (Twilio's does). */
  search?: string;
  headers: Record<string, string>;
  body: string;
}

/** Headers about the connection, not the message: never kept. */
const DROP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-authorization',
  'proxy-connection',
  'content-length',
  'host',
  'cookie',
  'forwarded',
  'x-real-ip',
  'true-client-ip',
  'cdn-loop',
]);
const DROP_PREFIX = ['x-forwarded-', 'cf-', 'fly-'];
const HEADER_BYTES = 32 * 1024;
const HOOK_ID = /^[A-Za-z0-9_-]{16,128}$/;
const TAG = /^[A-Za-z0-9_-]{43}$/;
const MAX_BATCH = 20;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

const plain = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });

interface Waiter {
  resolve: () => void;
}

export class Relay {
  readonly limits: RelayLimits;
  #items = new Map<string, StoredItem>();
  #tags = new Set<string>();
  #bytes = 0;
  #leases = new Map<string, number>();
  #pollers = new Set<Waiter>();
  #answers = new Map<string, (answer: HookAnswer) => void>();
  #counts = new Map<string, { minute: number; count: number }>();
  #loaded?: Promise<void>;
  #swept = 0;
  #keyId?: string;

  readonly #setup: RelaySetup;
  readonly #store: RelayStore;
  readonly #clock: () => number;

  constructor(
    setup: RelaySetup,
    store: RelayStore,
    limits: Partial<RelayLimits> = {},
    clock: () => number = () => Date.now(),
  ) {
    this.#setup = setup;
    this.#store = store;
    this.#clock = clock;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /** Read what was kept (once). */
  load(): Promise<void> {
    this.#loaded ??= (async () => {
      const { items, tags } = await this.#store.load();
      for (const item of items.sort((a, b) => a.receivedAt - b.receivedAt)) {
        this.#items.set(item.id, item);
        this.#bytes += item.size;
      }
      this.#tags = new Set(tags.filter((t) => TAG.test(t)));
      this.#keyId = await keyIdOf(this.#setup.publicKey);
    })();
    return this.#loaded;
  }

  get depth(): number {
    return this.#items.size;
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    await this.#sweep();
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' && request.method === 'GET') return plain(200, 'Conch relay');
    const hook = /^\/hooks\/([^/]+)$/.exec(path);
    if (hook) return this.#deliver(request, url, decodeURIComponent(hook[1] ?? ''));
    if (path.startsWith('/relay/v1/')) {
      if (!(await this.#authorized(request))) return json(401, { error: 'unauthorized' });
      const route = `${request.method} ${path.slice('/relay/v1/'.length)}`;
      if (route === 'GET next') return this.#next(url);
      if (route === 'POST ack') return this.#ack(request);
      if (route === 'PUT hooks') return this.#hooks(request);
      if (route === 'GET status') return this.#status();
      return json(404, { error: 'not-found' });
    }
    return plain(404, 'Not found.');
  }

  // ── Deliveries ─────────────────────────────────────────────────────────

  async #deliver(request: Request, url: URL, hookId: string): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'POST') return plain(404, 'Not found.');
    if (!HOOK_ID.test(hookId)) return plain(404, 'Not found.');
    const tag = await hookTag(hookId);
    // Only addresses the gateway serves: anything else is turned away before it costs a byte.
    if (!this.#tags.has(tag)) return plain(404, 'Not found.');
    if (
      !this.#allow(`hook:${tag}`, this.limits.perHookPerMinute) ||
      !this.#allow('all', this.limits.perMinute)
    )
      return plain(429, 'Too many requests.', { 'retry-after': '60' });
    // Full: the sender is told to come back later, rather than something older being lost.
    const forHook = [...this.#items.values()].filter((i) => i.tag === tag).length;
    if (this.#items.size >= this.limits.maxItems || forHook >= this.limits.perHook)
      return this.#full();
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > this.limits.bodyLimit) return plain(413, 'Too big.');
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.length > this.limits.bodyLimit) return plain(413, 'Too big.');

    const headers: Record<string, string> = {};
    let headerBytes = 0;
    request.headers.forEach((value, name) => {
      const key = name.toLowerCase();
      if (DROP.has(key) || DROP_PREFIX.some((p) => key.startsWith(p))) return;
      headerBytes += key.length + value.length;
      if (headerBytes <= HEADER_BYTES) headers[key] = value;
    });
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) query[key] = value;

    const now = this.#clock();
    const id = b64url.encode(crypto.getRandomValues(new Uint8Array(16)));
    const delivery: Delivery = {
      v: 1,
      id,
      receivedAt: now,
      hookId,
      method: request.method === 'GET' ? 'GET' : 'POST',
      query,
      ...(url.search.length > 1 && { search: url.search.slice(1) }),
      headers,
      body: new TextDecoder().decode(raw),
    };
    const sealed = await seal(
      this.#setup.publicKey,
      new TextEncoder().encode(JSON.stringify(delivery)),
      { info: RELAY_INFO, aad: relayAad(id, now) },
    );
    const item: StoredItem = {
      id,
      receivedAt: now,
      expiresAt: now + this.limits.ttlMs,
      tag,
      size: sealed.ct.length + sealed.enc.length,
      enc: b64url.encode(sealed.enc),
      ct: b64url.encode(sealed.ct),
    };
    if (this.#bytes + item.size > this.limits.maxBytes) return this.#full();
    await this.#store.put(item);
    this.#items.set(id, item);
    this.#bytes += item.size;

    // The gateway is listening: hand it over, and give the sender its real answer.
    if (this.#pollers.size) {
      const answered = new Promise<HookAnswer | undefined>((resolve) => {
        const timer = setTimeout(() => {
          this.#answers.delete(id);
          resolve(undefined);
        }, this.limits.replyWaitMs);
        this.#answers.set(id, (answer) => {
          clearTimeout(timer);
          this.#answers.delete(id);
          resolve(answer);
        });
      });
      this.#wake();
      const answer = await answered;
      if (answer)
        return new Response(answer.body ?? '', {
          status: answer.status,
          headers: {
            'content-type': answer.type ?? 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        });
    }
    return this.#later(headers);
  }

  #full(): Response {
    return plain(503, 'Busy. Try again later.', { 'retry-after': '600' });
  }

  /** The answer for a delivery that waits: what each app takes as "got it". */
  #later(headers: Record<string, string>): Response {
    // Twilio wants TwiML; an empty one means "no reply".
    if (headers['x-twilio-signature'])
      return new Response(EMPTY_TWIML, {
        status: 200,
        headers: { 'content-type': 'text/xml', 'cache-control': 'no-store' },
      });
    return plain(200, '');
  }

  #wake() {
    const pollers = [...this.#pollers];
    this.#pollers.clear();
    for (const poller of pollers) poller.resolve();
  }

  #allow(key: string, limit: number): boolean {
    const minute = Math.floor(this.#clock() / 60_000);
    const seen = this.#counts.get(key);
    if (!seen || seen.minute !== minute) {
      // Old minutes are dropped as they pass, so the map stays as small as the addresses.
      if (this.#counts.size > this.limits.maxHooks + 10)
        for (const [k, v] of this.#counts) if (v.minute !== minute) this.#counts.delete(k);
      this.#counts.set(key, { minute, count: 1 });
      return true;
    }
    seen.count++;
    return seen.count <= limit;
  }

  async #sweep() {
    const now = this.#clock();
    if (now - this.#swept < 60_000) return;
    this.#swept = now;
    const gone = [...this.#items.values()].filter((i) => i.expiresAt <= now).map((i) => i.id);
    if (gone.length) await this.#drop(gone);
  }

  async #drop(ids: string[]) {
    await this.#store.remove(ids);
    for (const id of ids) {
      const item = this.#items.get(id);
      if (!item) continue;
      this.#items.delete(id);
      this.#leases.delete(id);
      this.#bytes -= item.size;
    }
  }

  // ── The gateway's side ─────────────────────────────────────────────────

  async #authorized(request: Request): Promise<boolean> {
    const header = request.headers.get('authorization') ?? '';
    const token = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header)?.[1];
    if (!token) return false;
    return sameBytes(await sha256(new TextEncoder().encode(token)), this.#setup.tokenHash);
  }

  #ready(now: number): StoredItem[] {
    const out: StoredItem[] = [];
    let bytes = 0;
    for (const item of this.#items.values()) {
      if ((this.#leases.get(item.id) ?? 0) > now || item.expiresAt <= now) continue;
      if (out.length && (out.length >= MAX_BATCH || bytes + item.size > MAX_BATCH_BYTES)) break;
      out.push(item);
      bytes += item.size;
    }
    return out;
  }

  async #next(url: URL): Promise<Response> {
    const wait = Math.min(
      Math.max(Number(url.searchParams.get('wait') ?? 0) * 1000 || 0, 0),
      this.limits.maxWaitMs,
    );
    let ready = this.#ready(this.#clock());
    if (!ready.length && wait > 0) {
      await new Promise<void>((resolve) => {
        const waiter: Waiter = {
          resolve: () => {
            clearTimeout(timer);
            this.#pollers.delete(waiter);
            resolve();
          },
        };
        const timer = setTimeout(waiter.resolve, wait);
        this.#pollers.add(waiter);
      });
      ready = this.#ready(this.#clock());
    }
    const now = this.#clock();
    for (const item of ready) this.#leases.set(item.id, now + this.limits.leaseMs);
    return json(200, {
      items: ready.map(({ id, receivedAt, enc, ct }) => ({ id, receivedAt, enc, ct })),
      depth: this.#items.size,
    });
  }

  async #ack(request: Request): Promise<Response> {
    const body = await readJson(request, 256 * 1024);
    const acks = (body as { acks?: unknown } | undefined)?.acks;
    if (!Array.isArray(acks) || acks.length > 100) return json(400, { error: 'bad-request' });
    const ids: string[] = [];
    for (const ack of acks as unknown[]) {
      const a = ack as { id?: unknown; reply?: unknown };
      if (typeof a.id !== 'string' || a.id.length > 64) return json(400, { error: 'bad-request' });
      ids.push(a.id);
      const reply = answerOf(a.reply);
      if (reply) this.#answers.get(a.id)?.(reply);
    }
    // Acknowledged means done: an id it doesn't have (already acknowledged, expired) is fine.
    await this.#drop(ids.filter((id) => this.#items.has(id)));
    return json(200, { depth: this.#items.size });
  }

  async #hooks(request: Request): Promise<Response> {
    const body = await readJson(request, 64 * 1024);
    const tags = (body as { tags?: unknown } | undefined)?.tags;
    if (
      !Array.isArray(tags) ||
      tags.length > this.limits.maxHooks ||
      !tags.every((t) => typeof t === 'string' && TAG.test(t))
    )
      return json(400, { error: 'bad-request' });
    this.#tags = new Set(tags as string[]);
    await this.#store.setTags([...this.#tags]);
    return json(200, { hooks: this.#tags.size });
  }

  #status(): Response {
    const oldest = this.#items.values().next().value as StoredItem | undefined;
    return json(200, {
      protocol: RELAY_PROTOCOL,
      keyId: this.#keyId,
      depth: this.#items.size,
      bytes: this.#bytes,
      ...(oldest && { oldestAt: oldest.receivedAt }),
      hooks: this.#tags.size,
      maxItems: this.limits.maxItems,
      ttlMs: this.limits.ttlMs,
    });
  }
}

function answerOf(value: unknown): HookAnswer | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { status?: unknown; body?: unknown; type?: unknown };
  if (
    typeof v.status !== 'number' ||
    !Number.isInteger(v.status) ||
    v.status < 200 ||
    v.status > 599
  )
    return undefined;
  return {
    status: v.status,
    ...(typeof v.body === 'string' && v.body.length <= 64 * 1024 && { body: v.body }),
    ...(typeof v.type === 'string' &&
      /^[\w.+-]+\/[\w.+-]+(;[\w =.-]*)?$/.test(v.type) && { type: v.type }),
  };
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > limit) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return undefined;
  }
}
