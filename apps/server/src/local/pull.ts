/**
 * Reading a model download as it goes.
 *
 * Ollama streams one line per step: `pulling manifest`, then `pulling <digest>`
 * with `total`/`completed` bytes for each layer (the weights are one big layer,
 * the template and licence a few tiny ones), then `verifying sha256 digest`,
 * `writing manifest` and `success`. Summing every layer seen gives the whole
 * download; the last few seconds of it give the speed and the time left.
 */
import type { LocalPull } from '@conch/protocol';

import type { PullLine } from './ollama';

/** Seconds of history the speed is averaged over: long enough to be calm, short enough to follow a change. */
const WINDOW_MS = 6_000;

/** What a person is waiting for, in their words. */
export function phaseOf(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith('pulling manifest')) return 'Getting ready';
  if (s.startsWith('pulling') || s.startsWith('downloading')) return 'Downloading';
  if (s.startsWith('verifying')) return 'Checking the download';
  if (s.startsWith('writing') || s.startsWith('removing')) return 'Almost done';
  if (s === 'success') return 'Done';
  return 'Downloading';
}

export class PullMeter {
  #layers = new Map<string, { total: number; completed: number }>();
  #samples: { at: number; bytes: number }[] = [];
  phase = 'Getting ready';
  done = false;

  constructor(private readonly now: () => number = Date.now) {}

  update(line: PullLine): void {
    if (line.status) {
      this.phase = phaseOf(line.status);
      if (line.status === 'success') this.done = true;
    }
    if (line.digest && typeof line.total === 'number' && line.total > 0) {
      const completed = Math.min(Math.max(0, line.completed ?? 0), line.total);
      this.#layers.set(line.digest, { total: line.total, completed });
      this.#sample();
    }
  }

  get completedBytes(): number {
    let sum = 0;
    for (const layer of this.#layers.values()) sum += layer.completed;
    return sum;
  }

  get totalBytes(): number | undefined {
    if (!this.#layers.size) return undefined;
    let sum = 0;
    for (const layer of this.#layers.values()) sum += layer.total;
    return sum;
  }

  #sample() {
    const at = this.now();
    this.#samples.push({ at, bytes: this.completedBytes });
    while (this.#samples.length > 2 && at - (this.#samples[0]?.at ?? at) > WINDOW_MS)
      this.#samples.shift();
  }

  /** Bytes a second over the last few seconds; unset until there's enough to say. */
  get bytesPerSecond(): number | undefined {
    const first = this.#samples[0];
    const last = this.#samples.at(-1);
    if (!first || !last || last.at - first.at < 800) return undefined;
    const rate = ((last.bytes - first.bytes) * 1000) / (last.at - first.at);
    return rate > 0 ? rate : undefined;
  }

  get secondsLeft(): number | undefined {
    const total = this.totalBytes;
    const rate = this.bytesPerSecond;
    if (total === undefined || rate === undefined) return undefined;
    return Math.max(0, Math.round((total - this.completedBytes) / rate));
  }

  /** The download as the page shows it. */
  snapshot(base: Pick<LocalPull, 'model' | 'label' | 'state'> & { message?: string }): LocalPull {
    const total = this.totalBytes;
    const rate = base.state === 'pulling' ? this.bytesPerSecond : undefined;
    const left = base.state === 'pulling' ? this.secondsLeft : undefined;
    return {
      ...base,
      phase: base.state === 'paused' ? 'Paused' : this.phase,
      completedBytes: this.completedBytes,
      ...(total !== undefined && { totalBytes: total }),
      ...(rate !== undefined && { bytesPerSecond: Math.round(rate) }),
      ...(left !== undefined && { secondsLeft: left }),
    };
  }

  /** A paused download starts again: the speed so far says nothing about the next attempt. */
  resume(): void {
    this.#samples = [];
    this.phase = 'Getting ready';
    this.done = false;
  }
}

/**
 * What a failed pull means, in words a person can act on. Ollama's own
 * messages are for developers ("pull model manifest: file does not exist").
 */
export function explainPull(message: string, label: string): string {
  if (/no space|disk full|ENOSPC|not enough space/i.test(message))
    return `There isn’t enough disk space left for ${label}. Free up some space, then try again.`;
  if (/file does not exist|not found|manifest unknown/i.test(message))
    return `${label} isn’t available to download right now.`;
  if (
    /dial tcp|lookup|no such host|connection (refused|reset)|timeout|EOF|network|TLS|i\/o/i.test(
      message,
    )
  )
    return `The download of ${label} stopped: the internet seems to be unreachable. It picks up where it left off when you try again.`;
  if (/isn’t answering|not answering|ECONNREFUSED/i.test(message))
    return `Ollama stopped while getting ${label}. Try again, and it picks up where it left off.`;
  return `Getting ${label} didn’t work. Try again, and it picks up where it left off.`;
}
