/**
 * The always-on relay, from the gateway's side (ADR 0140).
 *
 * Pairing makes this Conch an X25519 key pair and a token, kept sealed
 * (`relay.secrets.json`); the relay is deployed with only the public key and
 * the token's SHA-256 (the setup code), so nothing secret is ever shown,
 * typed or copied. Once its address is given, the public door uses it
 * (`door.useRelay`): every address Conch hands out (Twilio's, Teams', a
 * routine's) is then the relay's.
 *
 * While Conch runs it long-polls the relay, and on start it drains what was
 * kept. Each delivery is opened here, checked (the id and time it was sealed
 * with, within a week, never seen before) and handed to `door.deliver`: the
 * same handler a live delivery reaches, which checks the sender's own
 * signature as it came. Only then is it acknowledged, so a crash in between
 * brings it back, and the ledger (`relay-seen.json`) takes it once.
 */
import { createHash, randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

import {
  b64url,
  generateKeyPair,
  hookTag,
  keyId as keyIdOf,
  open,
  RELAY_INFO,
  relayAad,
  setupCode,
} from '@conch/relay/envelope';
import {
  RelayDelivery,
  RelayNext,
  RelayWireStatus,
  type RelayItem,
  type RelayView,
} from '@conch/protocol';
import { z } from 'zod';

import type { ChannelDoorService, HookReply, HookRequest } from '../channels/door';
import { Mutex, writeJson } from '../lib/fs';
import { readStore } from '../lib/recover';

/** As long as the relay keeps a delivery, and an hour for clocks that disagree. */
export const RELAY_WINDOW_MS = 7 * 24 * 60 * 60_000 + 60 * 60_000;
/** A relay's clock a little ahead of this one is fine; further is a time it made up. */
const AHEAD_MS = 5 * 60_000;
/** Older than this, a delivery is measured from when it reached the relay, not from now. */
const KEPT_MS = 60_000;
/** A delivery for an address nothing serves, this long after starting: that address is gone. */
const NO_ROUTE_GRACE_MS = 10 * 60_000;
/** A delivery whose handler keeps failing is let go after this many tries. */
const MAX_TRIES = 5;
const LEDGER_MAX = 20_000;
const WAIT_S = 25;

export class RelayError extends Error {}

const Paired = z.object({
  version: z.literal(1).default(1),
  publicKey: z.string().max(64).optional(),
  keyId: z.string().max(64).optional(),
  url: z.string().max(500).optional(),
  /** The computer it was paired on: a backup restored elsewhere pulls nothing by itself. */
  host: z.string().max(300).optional(),
  pairedAt: z.number().optional(),
});
type Paired = z.infer<typeof Paired>;

const Secrets = z.object({
  privateKey: z.string().max(64).optional(),
  token: z.string().max(100).optional(),
});

const Ledger = z.object({
  /** Delivery ids and digests of what was delivered, each with when it may be forgotten. */
  seen: z.record(z.string(), z.number()).default({}),
});

type Door = Pick<
  ChannelDoorService,
  'status' | 'onChange' | 'onRoutes' | 'hookIds' | 'deliver' | 'useRelay' | 'turnOff' | 'check'
>;

export interface RelayDeps {
  home: string;
  door: Door;
  fetch?: typeof fetch;
  now?: () => number;
  /** This computer's name (tests pretend to be another one). */
  host?: () => string;
  /** Conch's version, to pin the relay's source to the same release. */
  version?: string;
  /** Tests and mock mode: a relay at http://127.0.0.1 is allowed. */
  allowLoopback?: boolean;
  /** Tests: no long poll of its own; they call `pull`. */
  loop?: boolean;
  onHeal?: (message: string) => void;
  log?: (message: string) => void;
}

/** What's opened and checked: the request for the door, and how to know it again. */
export interface Opened {
  delivery: RelayDelivery;
  request: HookRequest;
  digest: string;
}

export class RelayService {
  #paired?: Paired;
  #mutex = new Mutex();
  #ledger?: Record<string, number>;
  #loop?: AbortController;
  #startedAt: number;
  #tries = new Map<string, number>();
  #checkedAt?: number;
  #depth?: number;
  #oldestAt?: number;
  #drained = 0;
  #message?: string;
  #hooksTimer?: NodeJS.Timeout;
  #offDoor?: () => void;
  #offRoutes?: () => void;
  #listeners = new Set<(view: RelayView) => void>();

  constructor(private readonly deps: RelayDeps) {
    this.#startedAt = this.#now();
  }

  #now() {
    return this.deps.now?.() ?? Date.now();
  }

  #host() {
    return this.deps.host?.() ?? hostname();
  }

  get #paths() {
    return {
      paired: join(this.deps.home, 'relay.json'),
      secrets: join(this.deps.home, 'relay.secrets.json'),
      ledger: join(this.deps.home, 'relay-seen.json'),
    };
  }

  async #read(): Promise<Paired> {
    this.#paired ??= (await readStore(this.#paths.paired, Paired)).value;
    return this.#paired;
  }

  async #write(next: Paired) {
    this.#paired = Paired.parse(next);
    await writeJson(this.#paths.paired, this.#paired);
  }

  async #secrets() {
    return (await readStore(this.#paths.secrets, Secrets)).value;
  }

  // ── What Settings shows ────────────────────────────────────────────────

  onChange(listener: (view: RelayView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed() {
    void this.view().then((view) => {
      for (const listener of this.#listeners) listener(view);
    });
  }

  async view(): Promise<RelayView> {
    const paired = await this.#read();
    if (!paired.publicKey) return { state: 'off' };
    const door = this.deps.door.status();
    const counts = {
      ...(this.#depth !== undefined && { depth: this.#depth }),
      ...(this.#oldestAt !== undefined && { oldestAt: this.#oldestAt }),
      ...(this.#checkedAt !== undefined && { checkedAt: this.#checkedAt }),
      ...(this.#drained && { drained: this.#drained }),
    };
    if (!paired.url || door.via !== 'relay')
      return {
        state: 'pairing',
        ...(paired.url && { url: paired.url }),
        setup: await this.#setup(),
        ...counts,
      };
    const state =
      door.state === 'ready' ? 'ready' : door.state === 'needs-you' ? 'needs-you' : 'error';
    const message = state === 'ready' ? undefined : (door.message ?? this.#message);
    return { state, url: paired.url, ...counts, ...(message && { message }) };
  }

  async #setup(): Promise<NonNullable<RelayView['setup']>> {
    const paired = await this.#read();
    const { token } = await this.#secrets();
    const code = setupCode({
      publicKey: b64url.decode(paired.publicKey ?? ''),
      tokenHash: createHash('sha256')
        .update(token ?? '')
        .digest(),
    });
    const version = this.deps.version;
    const ref = version && /^\d+\.\d+\.\d+/.test(version) ? `v${version}` : 'main';
    const repo = 'georgevibing/conch-agent';
    return {
      code,
      worker: `npx wrangler@4 deploy --var CONCH_RELAY_SETUP:${code}`,
      node: `curl -fsSL https://raw.githubusercontent.com/${repo}/${ref}/apps/relay/install.sh | sh -s -- ${code} ${ref}`,
      docker: `docker run -d --restart unless-stopped -p 8787:8787 -v conch-relay:/data -e CONCH_RELAY_SETUP=${code} "$(docker build -q https://github.com/${repo}.git#${ref}:apps/relay)"`,
    };
  }

  /** The public name of this Conch's relay key, once there is one (Passwords lists it). */
  async keyId(): Promise<string | undefined> {
    return (await this.#read()).keyId;
  }

  // ── Pairing ────────────────────────────────────────────────────────────

  /**
   * Make this Conch's relay key and token, once (pressing it again shows the
   * same setup until the relay is forgotten). The person pressed the button.
   */
  pair(): Promise<RelayView> {
    return this.#mutex.run(async () => {
      const paired = await this.#read();
      const secrets = await this.#secrets();
      if (!paired.publicKey || !secrets.privateKey || !secrets.token) {
        const keys = await generateKeyPair();
        const token = randomBytes(32).toString('base64url');
        await writeJson(this.#paths.secrets, {
          privateKey: b64url.encode(keys.privateKey),
          token,
        });
        await this.#write({
          version: 1,
          publicKey: b64url.encode(keys.publicKey),
          keyId: await keyIdOf(keys.publicKey),
          host: this.#host(),
          pairedAt: this.#now(),
        });
      }
      const view = await this.view();
      this.#changed();
      return view;
    });
  }

  /** The address the person's relay answers at: checked, then used for every public address. */
  async connect(raw: string): Promise<RelayView> {
    const url = this.#address(raw);
    const paired = await this.#read();
    if (!paired.publicKey) throw new RelayError('Set up the relay first.');
    const problem = await this.probe(url);
    if (problem) throw new RelayError(problem.message);
    await this.#write({ ...paired, url, host: this.#host() });
    await this.deps.door.useRelay(url);
    await this.#pushHooks().catch(() => undefined);
    this.#ensureLoop();
    const view = await this.view();
    this.#changed();
    return view;
  }

  /** Stop using the relay and forget its keys: what it still keeps can never be opened. */
  async forget(): Promise<RelayView> {
    this.#stopLoop();
    if (this.deps.door.status().via === 'relay') await this.deps.door.turnOff();
    await rm(this.#paths.secrets, { force: true });
    await rm(this.#paths.ledger, { force: true });
    await this.#write({ version: 1 });
    this.#depth = undefined;
    this.#oldestAt = undefined;
    this.#checkedAt = undefined;
    this.#changed();
    return { state: 'off' };
  }

  #address(raw: string): string {
    let url: URL;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    } catch {
      throw new RelayError(
        'That isn’t a web address. It looks like https://conch-relay.example.workers.dev.',
      );
    }
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !(this.deps.allowLoopback && loopback))
      throw new RelayError('The relay must have an HTTPS address, starting https://.');
    if (url.username || url.password || url.search || url.hash)
      throw new RelayError(
        'Use just the address, without a name, a password or anything after ? or #.',
      );
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  }

  // ── Talking to the relay ───────────────────────────────────────────────

  async #call(url: string, path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const { token } = await this.#secrets();
    if (!token)
      throw new RelayError('The relay’s key isn’t on this computer any more. Set it up again.');
    const fetcher = this.deps.fetch ?? fetch;
    return fetcher(`${url}/relay/v1/${path}`, {
      ...init,
      redirect: 'error',
      signal: signal ?? AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
      },
    });
  }

  /**
   * Does the relay at `url` answer, sealing to this Conch's key? `undefined`
   * is yes. The door's own check for `via: 'relay'` (and Repair everything's).
   */
  async probe(url: string): Promise<undefined | { message: string; needsYou?: boolean }> {
    const paired = await this.#read();
    if (!paired.publicKey)
      return { message: 'The always-on relay isn’t set up here.', needsYou: true };
    if (paired.host && paired.host !== this.#host())
      return {
        message:
          'The always-on relay was set up on another computer. Set it up again here so its messages come to this one.',
        needsYou: true,
      };
    let response: Response;
    try {
      response = await this.#call(url, 'status');
    } catch (error) {
      if (error instanceof RelayError) return { message: error.message, needsYou: true };
      return { message: `The relay at ${url} doesn’t answer. Conch keeps trying.` };
    }
    if (response.status === 401)
      return {
        message: 'The relay was set up for another Conch. Deploy it again with this setup code.',
        needsYou: true,
      };
    const status = RelayWireStatus.safeParse(await response.json().catch(() => undefined));
    if (!response.ok || !status.success)
      return { message: `${url} isn’t a Conch relay, or it’s a version this Conch doesn’t know.` };
    if (status.data.keyId !== paired.keyId)
      return {
        message: 'The relay seals messages to another key. Deploy it again with this setup code.',
        needsYou: true,
      };
    this.#checkedAt = this.#now();
    this.#depth = status.data.depth;
    this.#oldestAt = status.data.oldestAt;
    return undefined;
  }

  /** Repair everything: the door looks again, the relay hears the addresses, and what it kept comes in. */
  async repair(): Promise<void> {
    await this.deps.door.check();
    await this.#pushHooks();
    this.#ensureLoop();
    await this.pull(0);
  }

  /** Tell the relay which addresses to take (by hash): anything else is turned away there. */
  async #pushHooks() {
    const url = await this.#url();
    if (!url) return;
    const tags = await Promise.all(this.deps.door.hookIds().map((id) => hookTag(id)));
    const response = await this.#call(url, 'hooks', {
      method: 'PUT',
      body: JSON.stringify({ tags: [...new Set(tags)] }),
    });
    if (!response.ok) throw new RelayError('The relay didn’t take the addresses.');
  }

  async #url(): Promise<string | undefined> {
    const door = this.deps.door.status();
    const paired = await this.#read();
    return door.via === 'relay' && door.url && paired.url === door.url ? door.url : undefined;
  }

  // ── Bringing deliveries in ─────────────────────────────────────────────

  /** Follow the door: pull from the relay while it's the way in. */
  start() {
    this.#offDoor ??= this.deps.door.onChange(() => {
      this.#ensureLoop();
      this.#changed();
    });
    this.#offRoutes ??= this.deps.door.onRoutes(() => {
      clearTimeout(this.#hooksTimer);
      this.#hooksTimer = setTimeout(() => void this.#pushHooks().catch(() => undefined), 500);
      this.#hooksTimer.unref?.();
    });
    this.#ensureLoop();
  }

  stop() {
    this.#offDoor?.();
    this.#offRoutes?.();
    this.#offDoor = undefined;
    this.#offRoutes = undefined;
    clearTimeout(this.#hooksTimer);
    this.#stopLoop();
  }

  #stopLoop() {
    this.#loop?.abort();
    this.#loop = undefined;
  }

  #ensureLoop() {
    const door = this.deps.door.status();
    if (door.via !== 'relay' || !door.url || door.state === 'off' || door.state === 'needs-you') {
      this.#stopLoop();
      return;
    }
    if (this.#loop || this.deps.loop === false) return;
    const stop = new AbortController();
    this.#loop = stop;
    void this.#run(stop.signal);
  }

  async #run(signal: AbortSignal) {
    let wait = 1_000;
    await this.#pushHooks().catch(() => undefined);
    while (!signal.aborted) {
      try {
        // Waits at the relay until something comes; a batch is followed at once by the next.
        await this.pull(WAIT_S, signal);
        wait = 1_000;
      } catch (error) {
        if (signal.aborted) return;
        this.#message = (error as Error).message;
        this.deps.log?.(`relay: ${this.#message}`);
        await new Promise((r) => setTimeout(r, wait).unref?.());
        wait = Math.min(wait * 2, 60_000);
        // Out of reach for a while: the door says so (and Repair everything).
        if (wait >= 16_000) void this.deps.door.check().catch(() => undefined);
      }
    }
  }

  /**
   * One `next` from the relay: open, check, deliver and acknowledge each.
   * Returns how many it brought in. Exposed for tests and Repair everything.
   */
  async pull(waitSeconds = 0, signal?: AbortSignal): Promise<number> {
    const url = await this.#url();
    if (!url) return 0;
    const timeout = AbortSignal.timeout((waitSeconds + 20) * 1000);
    const response = await this.#call(
      url,
      `next?wait=${waitSeconds}`,
      {},
      signal ? AbortSignal.any([signal, timeout]) : timeout,
    );
    if (!response.ok) throw new RelayError(`The relay answered ${response.status}.`);
    const next = RelayNext.parse(await response.json());
    this.#depth = next.depth;
    this.#checkedAt = this.#now();
    const acks: { id: string; reply?: HookReply }[] = [];
    for (const item of next.items) {
      const outcome = await this.#process(item);
      if (outcome !== 'keep')
        acks.push({ id: item.id, ...(outcome.reply && { reply: outcome.reply }) });
    }
    if (acks.length) {
      await this.#saveLedger();
      const acked = await this.#call(url, 'ack', {
        method: 'POST',
        body: JSON.stringify({ acks }),
      });
      if (acked.ok) {
        const body = (await acked.json().catch(() => ({}))) as { depth?: number };
        if (typeof body.depth === 'number') this.#depth = body.depth;
      }
      this.#changed();
    }
    return next.items.length;
  }

  /** Open one delivery with this Conch's key, and check what it says about itself. */
  async open(item: RelayItem): Promise<Opened> {
    const { privateKey } = await this.#secrets();
    if (!privateKey) throw new RelayError('No relay key on this computer.');
    const plain = await open(
      b64url.decode(privateKey),
      { enc: b64url.decode(item.enc), ct: b64url.decode(item.ct) },
      { info: RELAY_INFO, aad: relayAad(item.id, item.receivedAt) },
    );
    const delivery = RelayDelivery.parse(JSON.parse(new TextDecoder().decode(plain)));
    if (delivery.id !== item.id || delivery.receivedAt !== item.receivedAt)
      throw new RelayError('A delivery that says it’s another one.');
    const now = this.#now();
    const age = now - delivery.receivedAt;
    if (age > RELAY_WINDOW_MS || age < -AHEAD_MS)
      throw new RelayError('A delivery from outside the week a relay keeps them.');
    const headers: Record<string, string | undefined> = { ...delivery.headers };
    const request: HookRequest = {
      method: delivery.method,
      query: delivery.query,
      ...(delivery.search !== undefined && { search: delivery.search }),
      headers,
      body: delivery.body,
      // Kept a while: freshness is measured from when it reached the relay.
      ...(age > KEPT_MS && { receivedAt: delivery.receivedAt }),
    };
    return { delivery, request, digest: digestOf(delivery) };
  }

  async #process(item: RelayItem): Promise<'keep' | { reply?: HookReply }> {
    const ledger = await this.#loadLedger();
    if (ledger[`id:${item.id}`]) return {};
    let opened: Opened;
    try {
      opened = await this.open(item);
    } catch (error) {
      // Can't be opened or doesn't hold up: nothing more can come of it.
      this.deps.log?.(`relay: let a delivery go: ${(error as Error).message}`);
      return {};
    }
    const until = this.#now() + RELAY_WINDOW_MS + 24 * 60 * 60_000;
    if (ledger[`d:${opened.digest}`]) {
      ledger[`id:${item.id}`] = until;
      return { reply: { status: 200, body: 'Already received.' } };
    }
    const reply = await this.deps.door.deliver(opened.delivery.hookId, opened.request);
    if (reply === 'none') {
      // Channels and routines mount their addresses as they start: give them time.
      if (this.#now() - this.#startedAt < NO_ROUTE_GRACE_MS) return 'keep';
      this.deps.log?.('relay: let a delivery go: nothing serves its address any more');
      return {};
    }
    if (reply.status >= 500) {
      const tries = (this.#tries.get(item.id) ?? 0) + 1;
      this.#tries.set(item.id, tries);
      if (tries < MAX_TRIES) return 'keep';
    }
    this.#tries.delete(item.id);
    ledger[`id:${item.id}`] = until;
    if (reply.status < 400) ledger[`d:${opened.digest}`] = until;
    this.#drained++;
    return { reply };
  }

  async #loadLedger(): Promise<Record<string, number>> {
    this.#ledger ??= (await readStore(this.#paths.ledger, Ledger)).value.seen;
    return this.#ledger;
  }

  async #saveLedger() {
    const ledger = await this.#loadLedger();
    const now = this.#now();
    const kept = Object.entries(ledger)
      .filter(([, until]) => until > now)
      .sort((a, b) => b[1] - a[1])
      .slice(0, LEDGER_MAX);
    this.#ledger = Object.fromEntries(kept);
    await writeJson(this.#paths.ledger, { seen: this.#ledger });
  }
}

/**
 * How a delivery is known again, whatever id the relay gave it: the address,
 * the method, the query, the body, and the ids a sender signs (Standard
 * Webhooks' `webhook-id` and timestamp). A relay that replays something it
 * saw, under a new id or a new time, is refused here.
 */
export function digestOf(
  d: Pick<RelayDelivery, 'hookId' | 'method' | 'query' | 'headers' | 'body'>,
) {
  const query = Object.entries(d.query).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256')
    .update(
      JSON.stringify([
        d.hookId,
        d.method,
        query,
        d.headers['webhook-id'] ?? '',
        d.headers['webhook-timestamp'] ?? '',
        d.body,
      ]),
    )
    .digest('base64url');
}
