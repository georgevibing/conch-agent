/**
 * The public door (ADR 0045): the one way in from the internet, for the chat
 * apps that only deliver messages to a web address (Microsoft Teams, WeChat).
 *
 * It is not the gateway. It's a second, tiny listener on this computer's
 * loopback (`127.0.0.1:4319`) that knows one kind of address,
 * `/hooks/<id>`, where `<id>` is an unguessable name a channel was given
 * when it was connected. Everything else is a 404, there are no cookies, no
 * sign-in, no app and no API behind it, so a request from the internet can
 * never reach Conch itself, however it's dressed. Each delivery must also
 * carry the app's own signature, checked by the channel before anything is
 * read (Teams: a Bot Framework JWT; WeChat: its SHA-1 signature, and AES for
 * the message).
 *
 * The internet reaches the door one of two ways:
 *
 * - **Tailscale Funnel** (one press): `https://<this computer>.ts.net/conch`
 *   is made public and sent to the door. On 443 when the phone's private
 *   address isn't using it, else 8443 (Funnel's other port), because Funnel
 *   makes a whole port public and the phone's address must stay private.
 * - **An address of your own**: a reverse proxy, frp or a tunnel you already
 *   run, forwarding to the door's port.
 *
 * Either way Conch checks that the address really reaches *this* door (a
 * nonce it sends itself, answered with an HMAC only this door can make), and
 * keeps checking: a door that stopped answering is reported and repaired.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import type { ChannelDoor as DoorView, ChannelKind, DoctorItem } from '@conch/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { DoctorCheck } from '../doctor/service';
import { writeJson } from '../lib/fs';
import { readStore } from '../lib/recover';
import type { FunnelStatus } from '../network/tailscale';

/** The door's own port when nothing says otherwise; the next few are tried if it's taken. */
export const DOOR_PORT = 4319;
/** Where Funnel mounts the door on this computer's tailnet name. */
export const DOOR_PATH = '/conch';
/** A delivery is at most this big (Teams activities and WeChat XML are a few kilobytes). */
const BODY_LIMIT = 1024 * 1024;
/** Deliveries per address per minute, before the door answers 429. */
const PER_MINUTE = 240;
/** How often a door that's on is checked from the outside. */
const CHECK_EVERY_MS = 10 * 60_000;

export interface HookRequest {
  method: 'GET' | 'POST';
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  /** The raw body, as text. */
  body: string;
}

export interface HookReply {
  status: number;
  body?: string;
  type?: string;
}

export type HookHandler = (request: HookRequest) => Promise<HookReply>;

/** What the door needs from Tailscale (`network/tailscale.ts`). */
export interface DoorTailscale {
  funnelStatus(path: string, target: string): Promise<FunnelStatus>;
  funnel(port: number, path: string, target: string): Promise<FunnelStatus>;
  unfunnel(port: number, path: string): Promise<void>;
}

const DoorFile = z.object({
  version: z.literal(1).default(1),
  /** How it's reached, as the person chose. */
  via: z.enum(['tailscale', 'own']).optional(),
  /** The address of their own, when `via` is `own`. */
  url: z.string().max(500).optional(),
  /**
   * The tailnet name of the computer it was turned on for. A Funnel that's
   * gone is put back only there: a backup restored on another computer
   * opens nothing by itself.
   */
  name: z.string().max(300).optional(),
  /** The port it ended up on (a taken 4319 moves it), so Funnel keeps pointing at it. */
  port: z.number().int().min(1).max(65535).optional(),
});
type DoorFile = z.infer<typeof DoorFile>;

/** An address of your own must be HTTPS, without a key or a fragment in it. */
export function ownAddress(raw: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new DoorError('That isn’t a web address. It looks like https://conch.example.com.');
  }
  if (url.protocol !== 'https:')
    throw new DoorError(
      'Teams and WeChat only deliver to HTTPS addresses. Use one starting https://.',
    );
  if (url.username || url.password || url.search || url.hash)
    throw new DoorError(
      'Use just the address, without a name, a password or anything after ? or #.',
    );
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export class DoorError extends Error {}

/**
 * One door per Conch. Channels mount their addresses on it when they
 * connect; it starts listening with the first, and says where it stands to
 * the page (`status()`, `onChange`).
 */
export class ChannelDoorService {
  #app?: FastifyInstance;
  #listening?: Promise<void>;
  #port?: number;
  /** `kind` is the chat app's; a routine's address (ADR 0056) has none. */
  #routes = new Map<string, { kind?: ChannelKind; handler: HookHandler }>();
  #counts = new Map<string, { minute: number; count: number }>();
  #file?: DoorFile;
  #state: DoorView = { state: 'off', apps: [] };
  #listeners = new Set<(door: DoorView) => void>();
  #secret = randomBytes(32);
  #timer?: NodeJS.Timeout;
  #checking?: Promise<DoorView>;
  /** The address being checked right now (it isn't the door's until it answers). */
  #candidate?: string;

  constructor(
    private readonly deps: {
      home: string;
      /** The port asked for (`CONCH_DOOR_PORT`); 0 picks any free one (tests). */
      port: number;
      tailscale: DoorTailscale;
      /** How Conch reaches its own public address for the check (tests point it home). */
      fetch?: typeof fetch;
      onHeal?: (message: string) => void;
      log?: (message: string) => void;
    },
  ) {}

  // ── Addresses ──────────────────────────────────────────────────────────

  /** Serve `handler` at `/hooks/<hookId>`. Returns what takes it away again. */
  mount(hookId: string, kind: ChannelKind | undefined, handler: HookHandler): () => void {
    this.#routes.set(hookId, { kind, handler });
    void this.#listen().catch((error: unknown) =>
      this.#set({ state: 'error', message: (error as Error).message }),
    );
    this.#apps();
    return () => {
      if (this.#routes.get(hookId)?.handler === handler) this.#routes.delete(hookId);
      this.#apps();
    };
  }

  /** The public address of a channel's hook, while the door is reachable. */
  hookUrl(hookId: string): string | undefined {
    const base = this.#state.state === 'ready' ? this.#state.url : undefined;
    return base ? `${base}/hooks/${hookId}` : undefined;
  }

  /**
   * The door's own address for a public one (the pretend apps in mock mode
   * deliver here, as the internet would through Funnel).
   */
  localFor(url: string): string {
    const base = this.#candidate ?? this.#state.url;
    const local = this.local;
    if (!base || !local || !url.startsWith(base)) return url;
    return `${local}${url.slice(base.length)}`;
  }

  /** The door's own address on this computer (tests, and the pretend apps in mock mode). */
  get local(): string | undefined {
    return this.#port ? `http://127.0.0.1:${this.#port}` : undefined;
  }

  status(): DoorView {
    return this.#state;
  }

  onChange(listener: (door: DoorView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(next: Omit<DoorView, 'apps'> & { apps?: ChannelKind[] }) {
    const view: DoorView = { ...next, apps: next.apps ?? this.#state.apps };
    const same = JSON.stringify(view) === JSON.stringify(this.#state);
    this.#state = view;
    if (!same) for (const listener of this.#listeners) listener(view);
  }

  #apps() {
    const apps = [
      ...new Set([...this.#routes.values()].flatMap((r) => (r.kind ? [r.kind] : []))),
    ].sort();
    if (apps.join() !== this.#state.apps.join()) this.#set({ ...this.#state, apps });
  }

  // ── Turning it on and off ──────────────────────────────────────────────

  /** Read how it was left and look where it stands (never opens anything by itself). */
  async start(): Promise<DoorView> {
    const file = await this.#read();
    if (file.via === 'tailscale' || file.via === 'own') await this.#listen();
    this.#timer ??= setInterval(() => void this.check().catch(() => undefined), CHECK_EVERY_MS);
    this.#timer.unref?.();
    return this.check();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
    void this.#app?.close();
    this.#app = undefined;
    this.#listening = undefined;
  }

  /** Make the door public with Tailscale Funnel. The person pressed the button. */
  async useTailscale(): Promise<DoorView> {
    await this.#listen();
    const target = this.#target();
    const now = await this.deps.tailscale.funnelStatus(DOOR_PATH, target);
    let funnel = now;
    if (now.state === 'off') {
      const port = pickPort(now.busy);
      if (!port) return this.#noPort();
      funnel = await this.deps.tailscale.funnel(port, DOOR_PATH, target);
    }
    await this.#write({ via: 'tailscale', ...(funnel.name && { name: funnel.name }) });
    return this.#fromFunnel(funnel);
  }

  /** Use an address of the person's own (a proxy that forwards to the door's port). */
  async useOwn(raw: string): Promise<DoorView> {
    const url = ownAddress(raw);
    await this.#listen();
    await this.#write({ via: 'own', url });
    return this.check();
  }

  /** Nothing from the internet reaches Conch any more. */
  async turnOff(): Promise<DoorView> {
    const file = await this.#read();
    if (file.via === 'tailscale') {
      const now = await this.deps.tailscale.funnelStatus(DOOR_PATH, this.#target());
      if (now.port) await this.deps.tailscale.unfunnel(now.port, DOOR_PATH);
    }
    await this.#write({ via: undefined, url: undefined, name: undefined });
    this.#set({ state: 'off' });
    return this.#state;
  }

  /**
   * Where it stands now, checked from the outside: the address must answer
   * with this door's own proof. A Funnel that lost its setting (Tailscale
   * reinstalled, another tool reset it) is put back.
   */
  check(): Promise<DoorView> {
    this.#checking ??= this.#check().finally(() => (this.#checking = undefined));
    return this.#checking;
  }

  async #check(): Promise<DoorView> {
    const file = await this.#read();
    if (!file.via) {
      this.#set({ state: 'off' });
      return this.#state;
    }
    try {
      await this.#listen();
    } catch (error) {
      this.#set({ state: 'error', via: file.via, message: (error as Error).message });
      return this.#state;
    }
    if (file.via === 'tailscale') {
      const target = this.#target();
      let funnel = await this.deps.tailscale.funnelStatus(DOOR_PATH, target);
      // Turned on for another computer (a restored backup): only a person opens it here.
      if (
        funnel.state === 'off' &&
        !funnel.waiting &&
        file.name &&
        funnel.name &&
        file.name !== funnel.name
      ) {
        this.#set({
          state: 'needs-you',
          via: 'tailscale',
          problem: {
            kind: 'other',
            message:
              'The public address was set up on another computer. Turn it on here to let Teams and WeChat reach this one.',
          },
        });
        return this.#state;
      }
      // It was on, and Tailscale forgot it (or the door moved port): put it back.
      if (funnel.state === 'off' && !funnel.waiting) {
        const port = pickPort(funnel.busy);
        if (!port) return this.#noPort();
        funnel = await this.deps.tailscale.funnel(port, DOOR_PATH, target);
        if (funnel.state === 'on')
          this.deps.onHeal?.(
            'The public address for Teams and WeChat had stopped; Conch turned it back on.',
          );
      }
      return this.#fromFunnel(funnel);
    }
    return this.#reach(file.url ?? '', 'own');
  }

  #noPort(): DoorView {
    this.#set({
      state: 'needs-you',
      via: 'tailscale',
      problem: {
        kind: 'other',
        message:
          'Tailscale’s three public ports (443, 8443 and 10000) are all used by other things on this computer. Free one in Tailscale, or use an address of your own.',
      },
    });
    return this.#state;
  }

  async #fromFunnel(funnel: FunnelStatus): Promise<DoorView> {
    if (funnel.state === 'on' && funnel.name && funnel.port)
      return this.#reach(
        `https://${funnel.name}${funnel.port === 443 ? '' : `:${funnel.port}`}${DOOR_PATH}`,
        'tailscale',
      );
    const problem: DoorView['problem'] =
      funnel.state === 'missing'
        ? { kind: 'need', need: 'tailscale', message: 'Needs Tailscale on this computer.' }
        : funnel.state === 'stopped'
          ? { kind: 'other', message: 'Tailscale isn’t running. Open it, then press Try again.' }
          : funnel.state === 'signed-out'
            ? { kind: 'other', message: 'Sign in to Tailscale, then press Try again.' }
            : funnel.problem
              ? {
                  kind: funnel.problem.url ? 'open' : funnel.problem.command ? 'command' : 'other',
                  message: funnel.problem.message,
                  ...(funnel.problem.url && { url: funnel.problem.url }),
                  ...(funnel.problem.command && { command: funnel.problem.command }),
                }
              : undefined;
    this.#set({
      state: funnel.waiting && !problem ? 'starting' : problem ? 'needs-you' : 'error',
      via: 'tailscale',
      ...(problem && { problem }),
      ...(!problem &&
        !funnel.waiting && {
          message: 'Tailscale didn’t make the address public. Press Repair to try again.',
        }),
    });
    return this.#state;
  }

  /** Does `url` reach this door? Asks it a nonce only this door can answer. */
  async #reach(url: string, via: 'tailscale' | 'own'): Promise<DoorView> {
    const nonce = randomBytes(16).toString('base64url');
    const fetcher = this.deps.fetch ?? fetch;
    let ok = false;
    this.#candidate = url;
    try {
      const response = await fetcher(`${url}/ping/${nonce}`, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      const said = response.ok ? (await response.text()).trim() : '';
      ok = equal(said, this.#proof(nonce));
    } catch {
      ok = false;
    } finally {
      this.#candidate = undefined;
    }
    if (ok) {
      this.#set({ state: 'ready', via, url, checkedAt: Date.now() });
      return this.#state;
    }
    // A Funnel that's set but doesn't answer yet is usually DNS catching up: ready, unchecked.
    this.#set({
      state: via === 'tailscale' ? 'ready' : 'error',
      via,
      url,
      ...(via === 'own' && {
        message: `${url} doesn’t reach Conch. Make it forward to http://127.0.0.1:${this.#port ?? DOOR_PORT} on this computer, then press Try again.`,
      }),
      ...(this.#state.checkedAt && { checkedAt: this.#state.checkedAt }),
    });
    return this.#state;
  }

  #proof(nonce: string) {
    return createHmac('sha256', this.#secret).update(`conch-door:${nonce}`).digest('base64url');
  }

  #target() {
    return `http://127.0.0.1:${this.#port ?? DOOR_PORT}`;
  }

  // ── The listener ───────────────────────────────────────────────────────

  #listen(): Promise<void> {
    this.#listening ??= this.#open().catch((error: unknown) => {
      this.#listening = undefined;
      throw error;
    });
    return this.#listening;
  }

  async #open() {
    const app = Fastify({
      logger: false,
      bodyLimit: BODY_LIMIT,
      // Nothing here trusts a header about who's asking: everything is signed.
      trustProxy: false,
      connectionTimeout: 20_000,
      requestTimeout: 20_000,
      return503OnClosing: true,
    });
    // Bodies are kept as text: each app checks its own signature over what it sent.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) =>
      done(null, body),
    );
    const handle = async (
      request: { method: string; query: unknown; headers: Record<string, unknown>; body: unknown },
      hookId: string,
    ): Promise<HookReply> => {
      const route = this.#routes.get(hookId);
      if (!route || (request.method !== 'GET' && request.method !== 'POST'))
        return { status: 404, body: 'Not found.' };
      if (!this.#allow(hookId)) return { status: 429, body: 'Too many requests.' };
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(request.headers))
        headers[key] = typeof value === 'string' ? value : undefined;
      const query: Record<string, string> = {};
      for (const [key, value] of Object.entries((request.query ?? {}) as Record<string, unknown>))
        if (typeof value === 'string') query[key] = value;
      try {
        return await route.handler({
          method: request.method,
          query,
          headers,
          body: typeof request.body === 'string' ? request.body : '',
        });
      } catch (error) {
        this.deps.log?.(`door: ${(error as Error).message}`);
        return { status: 500, body: 'Something went wrong.' };
      }
    };
    // With or without the mount path in front: Tailscale may or may not pass it on.
    for (const prefix of ['', DOOR_PATH]) {
      app.route<{ Params: { hookId: string } }>({
        method: ['GET', 'POST'],
        url: `${prefix}/hooks/:hookId`,
        handler: async (request, reply) => {
          const answer = await handle(request, request.params.hookId);
          return reply
            .code(answer.status)
            .header('cache-control', 'no-store')
            .header('x-content-type-options', 'nosniff')
            .type(answer.type ?? 'text/plain; charset=utf-8')
            .send(answer.body ?? '');
        },
      });
      app.get<{ Params: { nonce: string } }>(`${prefix}/ping/:nonce`, (request, reply) => {
        const nonce = request.params.nonce;
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return reply.code(404).send('Not found.');
        return reply
          .header('cache-control', 'no-store')
          .type('text/plain')
          .send(this.#proof(nonce));
      });
    }
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).type('text/plain').send('Not found.'),
    );
    app.setErrorHandler((error, _request, reply) => {
      const status = (error as { statusCode?: number }).statusCode;
      return reply
        .code(status && status < 500 ? status : 500)
        .type('text/plain')
        .send('Not accepted.');
    });
    const file = await this.#read();
    const first = this.deps.port || file.port || DOOR_PORT;
    // A port another program holds moves the door along a little (and Funnel follows it).
    const ports = this.deps.port === 0 ? [0] : Array.from({ length: 10 }, (_, i) => first + i);
    let lastError: unknown;
    for (const port of ports) {
      try {
        await app.listen({ port, host: '127.0.0.1' });
        this.#app = app;
        this.#port = (app.server.address() as AddressInfo).port;
        if (this.deps.port !== 0 && this.#port !== file.port)
          await this.#write({ port: this.#port });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    await app.close().catch(() => undefined);
    throw new Error(
      `Conch couldn’t open its public door: ports ${first}–${first + 9} are all in use (${(lastError as Error).message}).`,
    );
  }

  #allow(hookId: string): boolean {
    const minute = Math.floor(Date.now() / 60_000);
    const seen = this.#counts.get(hookId);
    if (!seen || seen.minute !== minute) {
      this.#counts.set(hookId, { minute, count: 1 });
      return true;
    }
    seen.count++;
    return seen.count <= PER_MINUTE;
  }

  // ── door.json ──────────────────────────────────────────────────────────

  async #read(): Promise<DoorFile> {
    this.#file ??= (await readStore(join(this.deps.home, 'door.json'), DoorFile)).value;
    return this.#file;
  }

  async #write(patch: Partial<DoorFile>) {
    const next = DoorFile.parse({ ...(await this.#read()), ...patch });
    this.#file = next;
    await writeJson(join(this.deps.home, 'door.json'), next);
  }
}

/** 443 if the phone's private address isn't on it (Funnel makes a whole port public), else 8443. */
export function pickPort(busy: number[]): number | undefined {
  return [443, 8443, 10000].find((port) => !busy.includes(port));
}

function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The public door in Repair everything (AGENTS.md agreement 12): off with
 * nothing using it says nothing; on, it must answer from the outside.
 * Repair checks again, which also puts a forgotten Funnel back.
 */
export function doorCheck(door: ChannelDoorService): DoctorCheck {
  const base = {
    id: 'channel-door',
    group: 'Talk to me here',
    title: 'Public address for Teams and WeChat',
  };
  return {
    ...base,
    async run({ repair }) {
      const before = door.status();
      if (before.state === 'off' && !before.apps.length) return [];
      const now = repair ? await door.check() : before;
      const item = (rest: Omit<DoctorItem, 'id' | 'group' | 'title'>): DoctorItem[] => [
        { ...base, ...rest },
      ];
      if (now.state === 'ready')
        return item({
          state: repair && before.state !== 'ready' ? 'fixed' : 'ok',
          message: now.checkedAt
            ? 'Reachable from the internet.'
            : 'On. Not checked from the outside yet.',
        });
      if (now.state === 'starting') return item({ state: 'warning', message: 'Turning on…' });
      if (now.state === 'off')
        return item({
          state: 'needs-you',
          message: 'Teams or WeChat is connected, but nothing lets their messages reach Conch.',
          action: { kind: 'open', label: 'Turn it on', place: 'channels' },
        });
      const problem = now.problem;
      return item({
        state: 'needs-you',
        message: problem?.message ?? now.message ?? 'It stopped working.',
        action:
          problem?.kind === 'need' && problem.need
            ? { kind: 'need', need: problem.need, label: 'Install Tailscale', mode: 'install' }
            : problem?.kind === 'command' && problem.command
              ? { kind: 'command', command: problem.command, label: 'Copy' }
              : { kind: 'open', label: 'Open', place: 'channels' },
      });
    },
  };
}
