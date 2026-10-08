/**
 * How far a picture has come, as `tool.progress` events (the contract is in
 * `@conch/protocol` `ToolProgress`). Real where the provider says (rough
 * pictures as it works), otherwise an honest guess from how long it usually
 * takes, flagged `estimated` and never past 90% until the picture is here.
 */
import type { ToolProgress, ToolProgressStage } from '@conch/protocol';

/** At most this often, except a new stage or a rough picture, which go at once. */
const EVERY_MS = 500;
/** An estimate stops short of done: only the picture itself is 100%. */
const CEILING = 0.9;

/** The guess at `elapsed`: quick at first, slowing as it nears the ceiling. */
export function estimate(elapsed: number, typicalMs: number): number {
  if (elapsed <= 0) return 0;
  // At the usual duration, about 78%; at twice it, about 88%.
  return CEILING * (1 - Math.exp(-elapsed / (typicalMs / 2)));
}

export interface ProgressDeps {
  emit: (progress: ToolProgress) => void;
  toolName: string;
  by: string;
  typicalMs: number;
  now?: () => number;
  /** For tests: a clock that can be stepped. */
  every?: (run: () => void, ms: number) => () => void;
}

export class PictureProgress {
  #last = 0;
  #sentAt = -Infinity;
  #stage?: ToolProgressStage;
  #startedAt?: number;
  #real = false;
  #stopTimer?: () => void;
  readonly #now: () => number;

  constructor(private readonly deps: ProgressDeps) {
    this.#now = deps.now ?? Date.now;
  }

  #send(fields: { progress: number; stage: ToolProgressStage; preview?: string }, force = false) {
    const progress = Math.round(Math.min(1, Math.max(this.#last, fields.progress)) * 1000) / 1000;
    const now = this.#now();
    const changed = fields.stage !== this.#stage || fields.preview !== undefined;
    if (!force && !changed && (now - this.#sentAt < EVERY_MS || progress === this.#last)) return;
    this.#last = progress;
    this.#stage = fields.stage;
    this.#sentAt = now;
    this.deps.emit({
      toolName: this.deps.toolName,
      progress,
      stage: fields.stage,
      ...(!this.#real && fields.stage === 'generating' && { estimated: true as const }),
      ...(fields.preview && { preview: fields.preview }),
      by: this.deps.by,
    });
  }

  /** Before the request goes out (after any approval): 0%. */
  queued() {
    this.#send({ progress: 0, stage: 'queued' }, true);
  }

  /** The provider is at work: the estimate runs until real word or the picture comes. */
  generating() {
    if (this.#startedAt !== undefined) return;
    this.#startedAt = this.#now();
    this.#send({ progress: Math.max(this.#last, 0.02), stage: 'generating' }, true);
    const every = this.deps.every ?? defaultEvery;
    const tick = Math.min(3_000, Math.max(1_000, this.deps.typicalMs / 30));
    this.#stopTimer = every(() => {
      if (this.#real || this.#startedAt === undefined) return;
      this.#send({
        progress: estimate(this.#now() - this.#startedAt, this.deps.typicalMs),
        stage: 'generating',
      });
    }, tick);
  }

  /** A rough picture, the `index`th (from 0) of `of` before the final one. */
  partial(index: number, of: number, preview?: string) {
    this.generating();
    this.#real = true;
    const step = 0.15 + (0.75 * (index + 1)) / (of + 1);
    this.#send({ progress: step, stage: 'generating', ...(preview && { preview }) }, true);
  }

  /** The picture is here, being checked and kept. */
  finishing() {
    this.stop();
    this.#send({ progress: Math.max(this.#last, 0.95), stage: 'finishing' }, true);
  }

  stop() {
    this.#stopTimer?.();
    this.#stopTimer = undefined;
  }
}

function defaultEvery(run: () => void, ms: number) {
  const timer = setInterval(run, ms);
  timer.unref();
  return () => clearInterval(timer);
}
