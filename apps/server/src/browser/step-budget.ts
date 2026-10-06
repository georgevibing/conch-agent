/** Active browser work is bounded; time spent waiting for the person is not. */
export class BrowserStepStopped extends Error {
  constructor(readonly timedOut: boolean) {
    super(
      timedOut
        ? 'The browser took too long and this step was stopped. It may have acted on the site before stopping. Check the page before repeating the action.'
        : 'Stopped.',
    );
  }
}

export class BrowserStepBudget {
  readonly #stop = new AbortController();
  readonly signal = this.#stop.signal;
  #timer?: ReturnType<typeof setTimeout>;
  #remaining: number;
  #started = 0;
  #waiting: string[] = [];
  #finished = false;
  #reject!: (reason: unknown) => void;
  readonly #cancelled = new Promise<never>((_, reject) => {
    this.#reject = reject;
  });

  constructor(
    readonly parent: AbortSignal,
    readonly options: {
      timeoutMs: number;
      state: (waiting?: string) => void;
      cancel: (waiting: boolean) => void;
    },
  ) {
    this.#remaining = options.timeoutMs;
    // A cancellation may precede run(), or race a completed operation.
    void this.#cancelled.catch(() => {});
  }

  check(): void {
    // A busy event loop may delay the timer: checkpoints enforce the elapsed budget too.
    if (
      !this.#finished &&
      !this.#waiting.length &&
      this.#timer &&
      performance.now() - this.#started >= this.#remaining
    )
      this.#cancel(true);
    this.signal.throwIfAborted();
    this.parent.throwIfAborted();
  }

  #cancel(timedOut: boolean): void {
    if (this.signal.aborted || this.#finished) return;
    const reason = new BrowserStepStopped(timedOut);
    this.#stop.abort(reason);
    clearTimeout(this.#timer);
    this.#reject(reason);
    this.options.cancel(this.#waiting.length > 0);
  }

  #arm(): void {
    if (this.#finished || this.signal.aborted || this.#waiting.length) return;
    this.#started = performance.now();
    this.#timer = setTimeout(() => this.#cancel(true), Math.max(0, this.#remaining));
    this.#timer.unref?.();
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const stopped = () => this.#cancel(false);
    this.parent.addEventListener('abort', stopped, { once: true });
    if (this.parent.aborted) stopped();
    this.#arm();
    try {
      return await Promise.race([
        this.#cancelled,
        Promise.resolve().then(() => {
          this.check();
          return work();
        }),
      ]);
    } finally {
      this.#finished = true;
      clearTimeout(this.#timer);
      this.parent.removeEventListener('abort', stopped);
    }
  }

  async wait<T>(label: string, work: () => Promise<T>): Promise<T> {
    this.check();
    if (!this.#waiting.length) {
      clearTimeout(this.#timer);
      this.#remaining -= performance.now() - this.#started;
    }
    this.#waiting.push(label);
    this.options.state(label);
    try {
      const result = await Promise.race([this.#cancelled, work()]);
      this.check();
      return result;
    } finally {
      this.#waiting.pop();
      if (!this.#finished && !this.signal.aborted) {
        this.options.state(this.#waiting.at(-1));
        this.#arm();
      }
    }
  }
}
