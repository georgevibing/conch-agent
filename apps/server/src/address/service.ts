/**
 * Your own address, end to end (ADR 0064): the name you chose, the two
 * listeners, the certificate and its renewal.
 *
 * Lives in the gateway (it owns the ports). `set` checks the name from the
 * outside, gets a certificate and starts answering at `https://<name>`;
 * after that it renews by itself, following the authority's advice (ACME
 * Renewal Information) or at a third of the lifetime left, backing off on
 * failure and never letting go of the certificate that still works. A
 * backup restored on another computer opens nothing until a person says so
 * there (`turnOnHere`).
 */
import type { Server } from 'node:http';

// @peculiar/x509 needs the Reflect metadata API before it loads.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import type { JWK } from 'jose';

import type { Heal } from '../lib/recover';
import {
  AcmeClient,
  AcmeError,
  newAccountKey,
  leaf,
  renewAt,
  renewalId,
  type ChallengeResponder,
  type IssuedCertificate,
  type RenewalWindow,
} from './acme';
import {
  explainPointing,
  lookupName,
  pointing,
  publicAddresses,
  recordAdvice,
  type Found,
  type Mine,
  type Pointing,
  type RecordAdvice,
} from './dns';
import { AddressListeners, type ListenerOptions } from './listeners';
import { AddressProblemError, type AddressProblem } from './problems';
import { checkReach, type ReachResult } from './reach';
import { isPrivateNode, setcapCommand } from './runtime';
import { AddressStore, normaliseName, type AddressFile, type StoredCertificate } from './store';

export type AddressState = 'off' | 'checking' | 'getting-certificate' | 'ready' | 'problem';

export interface AddressStatus {
  state: AddressState;
  name?: string;
  /** Where Conch answers: `https://conch.example.com`. */
  url?: string;
  certificate?: { notAfter: number; issuer: string; renewsAt?: number };
  /** What stands in the way, or (with `ready`) why renewing hasn't worked yet. */
  problem?: AddressProblem;
}

/** Where a name points, for the person setting it up. */
export interface DnsReport {
  name: string;
  mine: Mine;
  found: Found;
  pointing: Pointing;
  message: string;
  /** The records to add, when it doesn't point here yet. */
  advice: RecordAdvice[];
}

export interface AcmeLike {
  issue(
    name: string,
    responder: ChallengeResponder,
    options?: { replaces?: string },
  ): Promise<IssuedCertificate>;
  renewalWindow(chainPem: string): Promise<(RenewalWindow & { retryAfter?: number }) | undefined>;
}

export type ListenersLike = Pick<
  AddressListeners,
  'startHttp' | 'startHttps' | 'updateCertificate' | 'stop' | 'listening'
>;

export interface AddressServiceDeps {
  home: string;
  config: { CONCH_HTTPS_PORT: number; CONCH_HTTP_PORT: number; CONCH_ACME_DIRECTORY: string };
  /** The gateway's own server, to hand HTTPS requests to (Fastify's `app.server`). */
  gateway: () => Server;
  /** The public door's port on loopback, when it's listening (ADR 0045). */
  door?: () => number | undefined;
  acme?: (accountKey: JWK) => AcmeLike;
  listeners?: (gateway: Server, options: ListenerOptions) => ListenersLike;
  reach?: (name: string, checks: Map<string, string>) => Promise<ReachResult>;
  lookup?: (name: string) => Promise<Found>;
  mine?: () => Promise<Mine>;
  /** The command that lets Conch answer on ports 80 and 443, when one would (Linux). */
  privilege?: () => Promise<string | undefined>;
  now?: () => number;
  /** Runs `fn` after `ms`; returns how to cancel it. */
  schedule?: (ms: number, fn: () => void) => () => void;
  heal?: Heal;
}

/**
 * Where a name points, and the records to add when it doesn't point here yet.
 * Needs no gateway: `conch setup` asks it before Conch answers on the name.
 */
export async function dnsReport(
  raw: string,
  deps: { mine?: () => Promise<Mine>; lookup?: (name: string) => Promise<Found> } = {},
): Promise<DnsReport> {
  const name = normaliseName(raw);
  const [mine, found] = await Promise.all([
    (deps.mine ?? publicAddresses)(),
    (deps.lookup ?? lookupName)(name),
  ]);
  const verdict = pointing(found, mine);
  return {
    name,
    mine,
    found,
    pointing: verdict,
    message: explainPointing(name, verdict, found),
    advice: verdict === 'here' ? [] : recordAdvice(name, mine),
  };
}

/** Look at the certificate at least this often, for the authority's advice. */
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const defaultSchedule = (ms: number, fn: () => void) => {
  const timer = setTimeout(fn, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
  timer.unref();
  return () => clearTimeout(timer);
};

/** The names a certificate is for. */
function namesOf(cert: x509.X509Certificate): string[] {
  // By its OID: looking it up by class depends on which copy of the class registered it.
  const raw = cert.extensions.find((e) => e.type === '2.5.29.17');
  const san = raw && new x509.SubjectAlternativeNameExtension(raw.rawData);
  const names =
    san?.names.toJSON().flatMap((n) => (n.type === 'dns' ? [n.value.toLowerCase()] : [])) ?? [];
  return names;
}

/** RFC 9773's id for the certificate being replaced, when it has one. */
function safeRenewalId(chainPem: string): string | undefined {
  try {
    return renewalId(chainPem);
  } catch {
    return undefined;
  }
}

/** "Let's Encrypt" from "C=US, O=Let's Encrypt, CN=R11". */
function issuerName(cert: x509.X509Certificate): string {
  const parts = cert.issuer.split(/,\s*/);
  const org = parts.find((p) => p.startsWith('O='))?.slice(2);
  const cn = parts.find((p) => p.startsWith('CN='))?.slice(3);
  return org ?? cn ?? cert.issuer;
}

export class AddressService {
  readonly store: AddressStore;
  /** `http-01` answers while a challenge is out. */
  readonly challenges = new Map<string, string>();
  /** Conch's own reachability check. */
  readonly checks = new Map<string, string>();
  #status: AddressStatus = { state: 'off' };
  #listeners?: ListenersLike;
  #cancel?: () => void;
  #busy?: Promise<AddressStatus>;
  /** The address file as Conch last wrote or acted on it: a change it didn't make is a person's. */
  #applied?: AddressFile;
  #watcher?: ReturnType<typeof setInterval>;
  /** status.json is written one at a time, the newest last. */
  #saving: Promise<void> = Promise.resolve();
  #watchers = new Set<(status: AddressStatus) => void>();
  #acme?: AcmeLike;
  readonly #now: () => number;
  readonly #schedule: (ms: number, fn: () => void) => () => void;

  constructor(private readonly deps: AddressServiceDeps) {
    this.store = new AddressStore(deps.home);
    this.#now = deps.now ?? Date.now;
    this.#schedule = deps.schedule ?? defaultSchedule;
  }

  status(): AddressStatus {
    return structuredClone(this.#status);
  }

  /** Told whenever the status changes. Returns how to stop being told. */
  onChange(listener: (status: AddressStatus) => void): () => void {
    this.#watchers.add(listener);
    return () => this.#watchers.delete(listener);
  }

  /** The name being served (for the gateway's allowed hosts), when there is one. */
  name(): string | undefined {
    return this.#status.state === 'off' || this.#status.problem?.kind === 'another-computer'
      ? undefined
      : this.#status.name;
  }

  /** On gateway start: put back what was on. */
  async start(): Promise<AddressStatus> {
    return this.#single(async () => {
      const file = await this.store.read();
      this.#applied = file;
      return this.#begin(file, false);
    });
  }

  /**
   * What the file says, brought up: off, waiting for a person on another
   * computer (a restored backup), or answering at the name.
   */
  async #begin(file: AddressFile, force: boolean): Promise<AddressStatus> {
    if (!file.name) return this.#set({ state: 'off' });
    const machine = await this.store.machine();
    if (file.setOn && file.setOn !== machine)
      return this.#set({
        state: 'problem',
        name: file.name,
        problem: {
          kind: 'another-computer',
          message: `${file.name} was set up on another computer. Point it at this one, then turn it on here.`,
        },
      });
    if (!file.setOn) await this.#write({ ...file, setOn: machine });
    return this.#bring(file.name, force);
  }

  /** Write the address file, remembering it as Conch's own change. */
  async #write(file: AddressFile): Promise<void> {
    await this.store.write(file);
    this.#applied = file;
  }

  /**
   * `conch setup` and `conch address` change the address by writing its file,
   * as `conch devices` writes access.json: being able to write in ~/.conch is
   * the proof it's the person, and no key ever goes over the port (ADR 0063).
   * Conch looks now and then, and acts once on whatever changed.
   */
  watch(everyMs = 750): void {
    this.#watcher ??= setInterval(() => void this.#look().catch(() => undefined), everyMs);
    this.#watcher.unref?.();
  }

  async #look(): Promise<void> {
    // A change under way writes the file itself: look again once it's done.
    if (this.#busy) return;
    const file = await this.store.read();
    const before = this.#applied;
    const key = (f: AddressFile | undefined) =>
      JSON.stringify([f?.name ?? null, f?.since ?? null, f?.setOn ?? null, f?.ask?.at ?? null]);
    if (key(file) === key(before)) return;
    this.#applied = file;
    if (!file.name) {
      void this.#single(async () => {
        this.#cancel?.();
        await this.#listeners?.stop();
        this.#listeners = undefined;
        await this.store.clear();
        return this.#set({ state: 'off' });
      });
      return;
    }
    if (file.ask && file.ask.at !== before?.ask?.at && file.name === before?.name) {
      void this.renew();
      return;
    }
    const name = file.name;
    this.#set({ state: 'checking', name, url: this.#url(name) });
    void this.#single(async () => {
      if (before?.name !== name) {
        await this.#listeners?.stop();
        this.#listeners = undefined;
      } else await this.store.saveState({ failures: 0 });
      return this.#begin(file, true);
    });
  }

  /** Answer at this name from now on: checked, certified, served. */
  async set(raw: string): Promise<AddressStatus> {
    const name = normaliseName(raw);
    this.#set({ state: 'checking', name, url: this.#url(name) });
    return this.#single(async () => {
      const before = await this.store.read();
      if (before.name !== name) {
        await this.store.clear();
        await this.#listeners?.stop();
        this.#listeners = undefined;
      } else await this.store.saveState({ failures: 0 });
      await this.#write({
        version: 1,
        name,
        since: this.#now(),
        setOn: await this.store.machine(),
      });
      return this.#bring(name, true);
    });
  }

  /** A backup from another computer: the person says this is the one now. */
  async turnOnHere(): Promise<AddressStatus> {
    if (this.#status.name)
      this.#set({ state: 'checking', name: this.#status.name, url: this.#url(this.#status.name) });
    return this.#single(async () => {
      const file = await this.store.read();
      if (!file.name) return this.#set({ state: 'off' });
      await this.#write({ ...file, setOn: await this.store.machine() });
      await this.store.saveState({ failures: 0 });
      return this.#bring(file.name, true);
    });
  }

  /** Stop answering at the address, and forget it (and its certificate). */
  async remove(): Promise<AddressStatus> {
    return this.#single(async () => {
      this.#cancel?.();
      await this.#listeners?.stop();
      this.#listeners = undefined;
      await this.store.clear();
      this.#applied = { version: 1 };
      return this.#set({ state: 'off' });
    });
  }

  /** Get a new certificate now (Repair everything), unless the authority said to wait. */
  async renew(): Promise<AddressStatus> {
    // Renewing keeps serving the certificate it has; it says it's at work meanwhile.
    if (this.#status.name && this.#status.state === 'ready')
      this.#set({ ...this.#status, state: 'getting-certificate' });
    return this.#single(async () => {
      const file = await this.store.read();
      if (!file.name) return this.#set({ state: 'off' });
      const state = await this.store.state();
      const waiting =
        state.error?.kind === 'rate-limited' && (state.nextAttempt ?? 0) > this.#now();
      return this.#obtain(file.name, !waiting);
    });
  }

  /** Close the listeners and open them again (Repair everything). */
  async restart(): Promise<AddressStatus> {
    return this.#single(async () => {
      await this.#listeners?.stop();
      this.#listeners = undefined;
      const file = await this.store.read();
      return file.name ? this.#bring(file.name, false) : this.#set({ state: 'off' });
    });
  }

  async stop(): Promise<void> {
    clearInterval(this.#watcher);
    this.#watcher = undefined;
    this.#cancel?.();
    await this.#listeners?.stop();
    this.#listeners = undefined;
    // What it last said reaches status.json before it goes.
    await this.#saving;
  }

  /** Where a name points, and what to add when it doesn't point here. */
  async dns(raw: string): Promise<DnsReport> {
    return dnsReport(raw, {
      ...(this.deps.mine && { mine: this.deps.mine }),
      ...(this.deps.lookup && { lookup: this.deps.lookup }),
    });
  }

  // ── Inside ─────────────────────────────────────────────────────────────

  /** One change at a time: a second caller waits for the first and then runs. */
  #single(task: () => Promise<AddressStatus>): Promise<AddressStatus> {
    const run = (this.#busy ?? Promise.resolve(this.#status))
      .catch(() => undefined)
      .then(task)
      .catch((error: unknown) => this.#crashed(error));
    this.#busy = run;
    return run.finally(() => {
      if (this.#busy === run) this.#busy = undefined;
    });
  }

  /**
   * Something nobody planned for (a dropped connection mid-answer, a full disk):
   * it's said in a sentence, the certificate that works keeps serving, and Conch
   * tries again within the hour. It never reaches the gateway as a crash.
   */
  async #crashed(error: unknown): Promise<AddressStatus> {
    const name = this.#status.name ?? (await this.store.read().catch(() => undefined))?.name;
    if (!name) return this.#set({ state: 'off' });
    this.#later(HOUR, () => this.#retry(name));
    const message = `Something went wrong with ${name} (${(error as Error).message || 'no reason given'}). Conch tries again within the hour.`;
    return this.#set({
      ...this.#status,
      state: this.#status.certificate ? 'ready' : 'problem',
      name,
      url: this.#url(name),
      problem: { kind: 'other', message, retryAt: this.#now() + HOUR },
    });
  }

  /** A retry Conch scheduled: only while the address is still the one it was for (review #8). */
  #retry(name: string): void {
    void this.#single(async () => {
      const file = await this.store.read();
      if (file.name !== name) return this.status();
      return this.#obtain(name, false);
    });
  }

  #set(status: AddressStatus): AddressStatus {
    this.#status = status;
    for (const watcher of this.#watchers) watcher(this.status());
    this.#saving = this.#saving
      .then(() =>
        this.store.saveStatus({
          status: this.status(),
          ...(this.#applied?.since !== undefined && { since: this.#applied.since }),
          ...(this.#applied?.ask && { ask: this.#applied.ask.at }),
        }),
      )
      .catch(() => undefined);
    return this.status();
  }

  #url(name: string): string {
    const port = this.deps.config.CONCH_HTTPS_PORT;
    return `https://${name}${port === 443 ? '' : `:${port}`}`;
  }

  #ensureListeners(): ListenersLike {
    this.#listeners ??= (this.deps.listeners ?? ((g, o) => new AddressListeners(g, o)))(
      this.deps.gateway(),
      {
        name: () => this.#status.name,
        httpsPort: this.deps.config.CONCH_HTTPS_PORT,
        httpPort: this.deps.config.CONCH_HTTP_PORT,
        challenges: this.challenges,
        checks: this.checks,
        ...(this.deps.door && { door: this.deps.door }),
      },
    );
    return this.#listeners;
  }

  async #privilegeProblem(problem: AddressProblem): Promise<AddressProblem> {
    if (problem.kind !== 'ports-privilege') return problem;
    const command = await (
      this.deps.privilege ??
      (async () =>
        (await isPrivateNode(process.execPath, this.deps.home))
          ? setcapCommand(process.execPath)
          : undefined)
    )().catch(() => undefined);
    return command
      ? { ...problem, command }
      : {
          ...problem,
          message: `${problem.message} Run conch setup on this server: it gets Conch its own copy of Node and asks once.`,
        };
  }

  /** Bring the address up: the port 80 listener, then the certificate (kept or new), then 443. */
  async #bring(name: string, force: boolean): Promise<AddressStatus> {
    this.#cancel?.();
    this.#set({ state: 'checking', name, url: this.#url(name) });
    try {
      await this.#ensureListeners().startHttp();
    } catch (error) {
      if (!(error instanceof AddressProblemError)) throw error;
      return this.#set({
        state: 'problem',
        name,
        url: this.#url(name),
        problem: await this.#privilegeProblem(error.problem),
      });
    }
    const cert = await this.store.certificate();
    const usable = cert && this.#usable(cert, name);
    if (cert && usable) {
      try {
        await this.#ensureListeners().startHttps(cert);
      } catch (error) {
        if (!(error instanceof AddressProblemError)) throw error;
        return this.#set({
          state: 'problem',
          name,
          url: this.#url(name),
          problem: await this.#privilegeProblem(error.problem),
        });
      }
      const state = await this.store.state();
      this.#set({
        state: 'ready',
        name,
        url: this.#url(name),
        certificate: this.#describe(cert),
        ...(state.error && {
          problem: {
            kind: state.error.kind as AddressProblem['kind'],
            message: state.error.message,
          },
        }),
      });
      await this.#plan(name, cert);
      return this.status();
    }
    return this.#obtain(name, force);
  }

  #usable(cert: StoredCertificate, name: string): boolean {
    try {
      const parsed = leaf(cert.certPem);
      return parsed.notAfter.getTime() > this.#now() && namesOf(parsed).includes(name);
    } catch {
      return false;
    }
  }

  #describe(cert: StoredCertificate, renewsAt?: number): AddressStatus['certificate'] {
    const parsed = leaf(cert.certPem);
    return {
      notAfter: parsed.notAfter.getTime(),
      issuer: issuerName(parsed),
      ...(renewsAt && { renewsAt }),
    };
  }

  async #client(): Promise<AcmeLike> {
    if (this.#acme) return this.#acme;
    let key = (await this.store.accountKey()) as JWK | undefined;
    if (!key) {
      key = await newAccountKey();
      await this.store.saveAccountKey(key as Record<string, unknown>);
    }
    this.#acme = (
      this.deps.acme ??
      ((accountKey) =>
        new AcmeClient({ directoryUrl: this.deps.config.CONCH_ACME_DIRECTORY, accountKey }))
    )(key);
    return this.#acme;
  }

  /** When to look again, or renew now if it's time. */
  async #plan(name: string, cert: StoredCertificate): Promise<void> {
    const client = await this.#client();
    const window = await client.renewalWindow(cert.certPem).catch(() => undefined);
    const at = renewAt(cert.certPem, window);
    const now = this.#now();
    const state = await this.store.state();
    if (state.nextAttempt && state.nextAttempt > now) {
      this.#later(state.nextAttempt - now, () => this.#retry(name));
      return;
    }
    if (at <= now) {
      await this.#obtain(name, false);
      return;
    }
    if (this.#status.state === 'ready' && this.#status.certificate)
      this.#set({ ...this.#status, certificate: { ...this.#status.certificate, renewsAt: at } });
    const askAgain = window?.retryAfter ? window.retryAfter - now : CHECK_EVERY_MS;
    this.#later(
      Math.min(at - now, CHECK_EVERY_MS, Math.max(askAgain, HOUR)),
      () =>
        void this.#single(async () => {
          if ((await this.store.read()).name !== name) return this.status();
          const current = await this.store.certificate();
          if (current) await this.#plan(name, current);
          return this.status();
        }),
    );
  }

  #later(ms: number, fn: () => void) {
    this.#cancel?.();
    this.#cancel = this.#schedule(ms, fn);
  }

  /** Get a certificate (checking the way in from outside first), and serve it. */
  async #obtain(name: string, force: boolean): Promise<AddressStatus> {
    const now = this.#now();
    const state = await this.store.state();
    const old = await this.store.certificate();
    const serving = old && this.#usable(old, name) ? old : undefined;
    if (!force && state.nextAttempt && state.nextAttempt > now) {
      this.#later(state.nextAttempt - now, () => this.#retry(name));
      const problem = state.error && {
        kind: state.error.kind as AddressProblem['kind'],
        message: state.error.message,
        ...(state.error.command && { command: state.error.command }),
        retryAt: state.nextAttempt,
      };
      return this.#set({
        state: serving ? 'ready' : 'problem',
        name,
        url: this.#url(name),
        ...(serving && { certificate: this.#describe(serving) }),
        ...(problem && { problem }),
      });
    }

    if (!serving) {
      this.#set({ state: 'checking', name, url: this.#url(name) });
      const reach = await (this.deps.reach ?? ((n, checks) => checkReach(n, { checks })))(
        name,
        this.checks,
      );
      // A timeout may only be this server failing to reach itself (no hairpin):
      // Let's Encrypt, from outside, settles it. The rest are certain.
      if (!reach.ok && reach.why !== 'timeout')
        return this.#failed(name, reach.problem, state.failures, { short: true });
    }

    this.#set({
      state: serving ? 'ready' : 'getting-certificate',
      name,
      url: this.#url(name),
      ...(serving && { certificate: this.#describe(serving) }),
    });
    let issued: IssuedCertificate;
    try {
      const client = await this.#client();
      const replaces = serving && safeRenewalId(serving.certPem);
      issued = await client.issue(
        name,
        {
          put: (token, answer) => this.challenges.set(token, answer),
          remove: (token) => this.challenges.delete(token),
        },
        replaces ? { replaces } : {},
      );
    } catch (error) {
      const problem =
        error instanceof AddressProblemError
          ? error.problem
          : {
              kind: 'ca-unavailable' as const,
              message: `Let’s Encrypt couldn’t be reached just now (${(error as Error).message || 'no reason given'}). Conch tries again by itself.`,
            };
      return this.#failed(name, problem, state.failures, {
        short: false,
        ...(error instanceof AcmeError &&
          error.problem.retryAt && { retryAt: error.problem.retryAt }),
      });
    }
    await this.store.saveCertificate(issued);
    await this.store.saveState({ failures: 0, lastAttempt: now });
    try {
      await this.#ensureListeners().startHttps(issued);
    } catch (error) {
      if (!(error instanceof AddressProblemError)) throw error;
      return this.#set({
        state: 'problem',
        name,
        url: this.#url(name),
        problem: await this.#privilegeProblem(error.problem),
      });
    }
    if (serving) this.deps.heal?.('gateway', `Conch renewed the certificate for ${name}.`);
    this.#set({
      state: 'ready',
      name,
      url: this.#url(name),
      certificate: this.#describe(issued),
    });
    await this.#plan(name, issued);
    return this.status();
  }

  async #failed(
    name: string,
    problem: AddressProblem,
    failures: number,
    options: { short: boolean; retryAt?: number },
  ): Promise<AddressStatus> {
    const now = this.#now();
    const count = failures + 1;
    // Checks Conch makes itself retry sooner than ones that count at Let's Encrypt.
    const backoff = options.short
      ? Math.min(5 * 60_000 * 2 ** (count - 1), HOUR)
      : Math.min(HOUR * 2 ** (count - 1), DAY);
    const nextAttempt = options.retryAt ?? now + backoff;
    const full = await this.#privilegeProblem({ ...problem, retryAt: nextAttempt });
    await this.store.saveState({
      failures: count,
      lastAttempt: now,
      nextAttempt,
      error: {
        kind: full.kind,
        message: full.message,
        ...(full.command && { command: full.command }),
      },
    });
    this.#later(nextAttempt - now, () => this.#retry(name));
    const old = await this.store.certificate();
    const serving = old && this.#usable(old, name) ? old : undefined;
    return this.#set({
      state: serving ? 'ready' : 'problem',
      name,
      url: this.#url(name),
      ...(serving && { certificate: this.#describe(serving) }),
      problem: full,
    });
  }
}
