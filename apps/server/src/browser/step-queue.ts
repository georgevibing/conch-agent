/** One browser operation per chat, shared by every provider. */
export class BrowserStepQueue {
  #tails = new Map<string, Promise<void>>();

  async run<T>(
    id: string,
    signal: AbortSignal,
    waiting: () => void,
    work: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    const before = this.#tails.get(id);
    if (before) waiting();
    const job = (before ?? Promise.resolve()).then(() => {
      signal.throwIfAborted();
      return work();
    });
    const settled = job.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(id, settled);
    void settled.then(() => {
      if (this.#tails.get(id) === settled) this.#tails.delete(id);
    });
    let stop!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    });
    try {
      return await Promise.race([job, cancelled]);
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
}
