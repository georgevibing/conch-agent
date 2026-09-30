/**
 * Is Conch online? (ADR 0023: offline, answer or wait.)
 *
 * Conch asks a few well-known addresses — the providers' own, and one made for
 * connectivity checks — and counts as offline only when none answers: one
 * service being down isn't the internet being down. It looks rarely while
 * online, often while offline, and at once when a provider stops answering, so
 * held messages go the moment the internet is back.
 */
import type { NetworkStatus } from '@conch/protocol';

/** Any HTTP answer at all means the internet works; only failing to connect counts. */
const PROBES = [
  'https://www.gstatic.com/generate_204',
  'https://api.anthropic.com/',
  'https://openrouter.ai/',
  'https://api.openai.com/',
];
const PROBE_TIMEOUT_MS = 4_000;
const ONLINE_EVERY_MS = 5 * 60_000;
const OFFLINE_EVERY_MS = 10_000;

/** Reachable if any address answers anything (a 401 or a 404 still means online). */
export async function reachable(
  fetchFn: typeof fetch = fetch,
  urls: readonly string[] = PROBES,
): Promise<boolean> {
  const attempts = urls.map(async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      await fetchFn(url, { method: 'HEAD', signal: controller.signal, redirect: 'manual' });
      return true;
    } finally {
      clearTimeout(timer);
    }
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return false;
  }
}

export interface NetworkWatchDeps {
  emit: (status: NetworkStatus) => void;
  probe?: () => Promise<boolean>;
  /** Leaves a "fixed on its own" style note when it comes back (held messages went). */
  onOnline?: () => void;
  now?: () => number;
}

export class NetworkWatch {
  #status: NetworkStatus = { online: true };
  #timer?: NodeJS.Timeout;
  #checking?: Promise<NetworkStatus>;
  #listeners = new Set<(status: NetworkStatus) => void>();

  constructor(private deps: NetworkWatchDeps) {}

  get status(): NetworkStatus {
    return this.#status;
  }

  get online(): boolean {
    return this.#status.online;
  }

  /** Called on every change (online ↔ offline). */
  onChange(listener: (status: NetworkStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    this.#schedule(15_000);
  }

  stop(): void {
    clearTimeout(this.#timer);
  }

  /**
   * Mock mode only (tests, demos): pretend to be offline or online. Probing
   * stops while pretending, so the pretence holds.
   */
  simulate(online: boolean): void {
    this.deps.probe = async () => online;
    this.#set(online);
  }

  /** Look now (a provider stopped answering; someone pressed Try again). Single-flight. */
  check(): Promise<NetworkStatus> {
    this.#checking ??= (this.deps.probe ?? (() => reachable()))()
      .catch(() => false)
      .then((online) => {
        this.#set(online);
        return this.#status;
      })
      .finally(() => {
        this.#checking = undefined;
        this.#schedule(this.#status.online ? ONLINE_EVERY_MS : OFFLINE_EVERY_MS);
      });
    return this.#checking;
  }

  #set(online: boolean) {
    if (online === this.#status.online) return;
    this.#status = { online, since: this.deps.now?.() ?? Date.now() };
    this.deps.emit(this.#status);
    for (const listener of this.#listeners) listener(this.#status);
  }

  #schedule(ms: number) {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.check(), ms);
    this.#timer.unref();
  }
}
