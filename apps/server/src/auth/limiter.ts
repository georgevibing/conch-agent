/**
 * Throttles failed sign-ins (NIST SP 800-63B-4 §3.2.2).
 *
 * - Per address: the first few mistakes are free, then each further failure
 *   doubles the wait (1 s, 2 s, 4 s … capped at 15 minutes).
 * - Overall: after 100 consecutive failures from anywhere, sign-in from other
 *   devices is locked until someone signs in on this computer or Conch restarts.
 *   Local sign-in keeps working, so an attacker can't lock the owner out.
 */
export const FREE_ATTEMPTS = 5;
export const MAX_DELAY_MS = 15 * 60 * 1000;
export const GLOBAL_LIMIT = 100;

interface Entry {
  failures: number;
  until: number;
  seen: number;
}

export class SignInLimiter {
  #entries = new Map<string, Entry>();
  #consecutive = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Milliseconds this address must wait before trying again (0 = go ahead). */
  retryAfter(address: string, local: boolean): number {
    if (!local && this.#consecutive >= GLOBAL_LIMIT) return MAX_DELAY_MS;
    const entry = this.#entries.get(address);
    return entry ? Math.max(0, entry.until - this.now()) : 0;
  }

  get locked() {
    return this.#consecutive >= GLOBAL_LIMIT;
  }

  fail(address: string): void {
    this.#consecutive++;
    const now = this.now();
    const entry = this.#entries.get(address) ?? { failures: 0, until: 0, seen: now };
    entry.failures++;
    entry.seen = now;
    if (entry.failures >= FREE_ATTEMPTS) {
      entry.until = now + Math.min(MAX_DELAY_MS, 1000 * 2 ** (entry.failures - FREE_ATTEMPTS));
    }
    this.#entries.set(address, entry);
    this.#prune(now);
  }

  succeed(address: string, local: boolean): void {
    this.#entries.delete(address);
    if (local || this.#consecutive < GLOBAL_LIMIT) this.#consecutive = 0;
  }

  /** Forget addresses idle for a day, so the map can't grow without bound. */
  #prune(now: number) {
    if (this.#entries.size < 1000) return;
    for (const [address, entry] of this.#entries) {
      if (now - entry.seen > 24 * 60 * 60 * 1000) this.#entries.delete(address);
    }
    // Still huge (e.g. rotating IPv6 addresses)? Drop the oldest.
    for (const address of this.#entries.keys()) {
      if (this.#entries.size <= 10_000) break;
      this.#entries.delete(address);
    }
  }
}
