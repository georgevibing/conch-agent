/**
 * Claude Code processes started ahead of a short answer (ADR 0147). Starting
 * Claude Code and its handshake take about a second and a half, longer than
 * a fast model takes to answer one of Auto's reviews. The Agent SDK's
 * `startup()` does that part early: the process waits, initialised, for one
 * prompt. Each spare answers once and is gone, so no two answers share a
 * session; one nobody took is let go after a short while.
 */

/** How long a spare waits for a prompt before it's let go. */
export const SPARE_MS = 60_000;
/** At most this many wait at once, the oldest let go first. */
export const MAX_SPARES = 2;

interface Waiting<T> {
  key: string;
  spare: Promise<T>;
  timer: NodeJS.Timeout;
}

export class Spares<T> {
  #waiting: Waiting<T>[] = [];

  constructor(
    /** Let a spare go: close its process. */
    private readonly release: (spare: T) => void,
    private readonly options: { waitMs?: number; max?: number } = {},
  ) {}

  /** The spare started for exactly these options, now yours to use once; undefined if none. */
  take(key: string): Promise<T> | undefined {
    const at = this.#waiting.findIndex((w) => w.key === key);
    if (at < 0) return undefined;
    const [waiting] = this.#waiting.splice(at, 1);
    if (!waiting) return undefined;
    clearTimeout(waiting.timer);
    return waiting.spare;
  }

  /** Start one for these options, unless one already waits. */
  keep(key: string, start: () => Promise<T>): void {
    if (this.#waiting.some((w) => w.key === key)) return;
    let spare: Promise<T>;
    try {
      spare = start();
    } catch {
      return;
    }
    const waiting: Waiting<T> = {
      key,
      spare,
      timer: setTimeout(() => this.#drop(waiting), this.options.waitMs ?? SPARE_MS),
    };
    waiting.timer.unref();
    // One that couldn't start is simply not there.
    spare.catch(() => this.#forget(waiting));
    this.#waiting.push(waiting);
    while (this.#waiting.length > (this.options.max ?? MAX_SPARES)) {
      const oldest = this.#waiting[0];
      if (oldest) this.#drop(oldest);
    }
  }

  /** Let every spare go (a new sign-in, or Conch stopping). */
  clear(): void {
    for (const waiting of [...this.#waiting]) this.#drop(waiting);
  }

  get size(): number {
    return this.#waiting.length;
  }

  #forget(waiting: Waiting<T>): void {
    clearTimeout(waiting.timer);
    this.#waiting = this.#waiting.filter((w) => w !== waiting);
  }

  #drop(waiting: Waiting<T>): void {
    this.#forget(waiting);
    void waiting.spare.then(
      (spare) => {
        try {
          this.release(spare);
        } catch {
          /* Already gone. */
        }
      },
      () => undefined,
    );
  }
}
