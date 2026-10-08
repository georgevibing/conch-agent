/**
 * How far a file being made has come, as `tool.progress` (the contract is
 * `@conch/protocol` `ToolProgress`, the same one pictures use). Real steps
 * where a maker can count them (pages, sheets, files), an honest estimate
 * while a browser prints, and never 100%: `tool.finished` is done.
 */
import type { ToolProgress, ToolProgressStage } from '@conch/protocol';

import { estimate } from '../../images/progress';

const EVERY_MS = 250;
const CEILING = 0.92;

export class FileProgress {
  #last = 0;
  #stage?: ToolProgressStage;
  #detail?: string;
  #sentAt = -Infinity;
  #timer?: NodeJS.Timeout;
  readonly #now: () => number;

  constructor(
    private readonly deps: {
      emit: (progress: ToolProgress) => void;
      toolName: string;
      now?: () => number;
    },
    public by = 'Conch',
  ) {
    this.#now = deps.now ?? Date.now;
  }

  #send(
    fields: { progress: number; stage: ToolProgressStage; detail?: string; estimated?: boolean },
    force = false,
  ) {
    const progress =
      Math.round(Math.min(CEILING + 0.05, Math.max(this.#last, fields.progress)) * 1000) / 1000;
    const now = this.#now();
    const changed = fields.stage !== this.#stage || fields.detail !== this.#detail;
    if (!force && !changed && (now - this.#sentAt < EVERY_MS || progress === this.#last)) return;
    this.#last = progress;
    this.#stage = fields.stage;
    this.#detail = fields.detail;
    this.#sentAt = now;
    this.deps.emit({
      toolName: this.deps.toolName,
      progress,
      stage: fields.stage,
      ...(fields.estimated && { estimated: true as const }),
      ...(fields.detail && { detail: fields.detail.slice(0, 80) }),
      by: this.by.slice(0, 80),
    });
  }

  /** Waiting its turn (another file of this chat is being made). */
  queued(detail?: string) {
    this.#send({ progress: 0, stage: 'queued', ...(detail && { detail }) }, true);
  }

  /** A counted step: `done` of `of`, mapped into the working range. */
  step(done: number, of: number, detail?: string) {
    this.stopEstimate();
    const share = of > 0 ? Math.min(1, done / of) : 0;
    this.#send({
      progress: 0.05 + share * (CEILING - 0.05),
      stage: 'generating',
      ...(detail && { detail }),
    });
  }

  /** Work that can't be counted (a browser printing): a guess from how long it usually takes. */
  working(detail: string, typicalMs: number) {
    this.stopEstimate();
    const from = Math.max(this.#last, 0.05);
    const started = this.#now();
    this.#send({ progress: from, stage: 'generating', detail, estimated: true }, true);
    this.#timer = setInterval(() => {
      const guess = from + (CEILING - from) * (estimate(this.#now() - started, typicalMs) / 0.9);
      this.#send({ progress: guess, stage: 'generating', detail, estimated: true });
    }, 400);
    this.#timer.unref();
  }

  finishing(detail = 'Checking and keeping it') {
    this.stopEstimate();
    this.#send({ progress: Math.max(this.#last, 0.95), stage: 'finishing', detail }, true);
  }

  stopEstimate() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
