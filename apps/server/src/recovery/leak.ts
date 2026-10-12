import { getHeapStatistics } from 'node:v8';

import { cgroupMemory } from './cgroup';
import { FAILURE_WINDOW_MS, readRecoveryState } from './supervisor-state';

/**
 * A planned restart for a slow memory leak: Conch watches its own heap and
 * resident memory, and when the trend says it will run out within the next
 * half hour (or it is nearly out already) it starts itself again while
 * nothing is working, rather than fall over later in the middle of a turn.
 * Numbers only: never a command, a path or anything a chat said.
 */

/** One reading of the gateway's own memory. */
export interface MemorySample {
  at: number;
  heapUsedBytes: number;
  rssBytes: number;
}

/** What each reading is measured against. RSS only has one inside a cgroup. */
export interface MemoryLimits {
  heapBytes: number;
  rssBytes?: number;
}

export interface LeakOptions {
  /** How much history the trend is fitted over. */
  windowMs: number;
  /** The trend needs at least this much history before it counts. */
  minimumSpanMs: number;
  /** How far ahead the trend is projected. */
  horizonMs: number;
  /** The projection reaching this share of a limit is a leak. */
  projectedShare: number;
  /** Already using this share of a limit (at its floor, not a pre-GC peak). */
  highShare: number;
  /** The window is cut into this many pieces; each piece's minimum is its floor. */
  buckets: number;
}

export const LEAK_DEFAULTS: LeakOptions = {
  windowMs: 60 * 60_000,
  // Longer than the supervisor's restart window: a leak restart never lands
  // inside the budget of the one before it.
  minimumSpanMs: Math.max(20 * 60_000, FAILURE_WINDOW_MS * 2),
  horizonMs: 30 * 60_000,
  projectedShare: 0.9,
  highShare: 0.85,
  buckets: 6,
};

interface Point {
  at: number;
  value: number;
}

/**
 * The floor of each slice of the window: the lowest reading in it, which is
 * close to what's left right after a garbage collection. Allocation spikes
 * between collections don't move it; memory that's never given back does.
 */
export function floors(points: Point[], buckets: number): Point[] {
  const start = points[0]?.at;
  const end = points.at(-1)?.at;
  if (start === undefined || end === undefined || buckets < 1) return [];
  const width = Math.max(1, (end - start) / buckets);
  const lowest = new Map<number, Point>();
  for (const point of points) {
    const slot = Math.min(buckets - 1, Math.floor((point.at - start) / width));
    const seen = lowest.get(slot);
    if (!seen || point.value < seen.value) lowest.set(slot, point);
  }
  return [...lowest.entries()].sort(([a], [b]) => a - b).map(([, point]) => point);
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
};

/**
 * Theil–Sen: the median of every pairwise slope, in bytes per millisecond.
 * One odd floor (a big collection, a burst of work) can't tilt it.
 */
export function robustSlope(points: Point[]): number {
  const slopes: number[] = [];
  points.forEach((a, i) => {
    for (const b of points.slice(i + 1))
      if (b.at !== a.at) slopes.push((b.value - a.value) / (b.at - a.at));
  });
  return slopes.length ? median(slopes) : 0;
}

export type LeakVerdict =
  | { leak: false }
  | {
      leak: true;
      measure: 'heap' | 'rss';
      cause: 'high' | 'growing';
      floorBytes: number;
      limitBytes: number;
      /** Bytes per minute, rounded. */
      growthPerMinute: number;
    };

/** One measure against its limit: already high, or heading there within the horizon. */
function judge(
  measure: 'heap' | 'rss',
  points: Point[],
  limit: number | undefined,
  options: LeakOptions,
): LeakVerdict {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return { leak: false };
  const span = (points.at(-1)?.at ?? 0) - (points[0]?.at ?? 0);
  if (span < options.minimumSpanMs) return { leak: false };
  const floor = floors(points, options.buckets);
  const recent = floor.at(-1)?.value;
  // Too few floors to tell a trend from one collection that hasn't happened yet.
  if (recent === undefined || floor.length < Math.min(4, options.buckets)) return { leak: false };
  const slope = robustSlope(floor);
  const growthPerMinute = Math.round(slope * 60_000);
  const verdict = { leak: true as const, measure, floorBytes: recent, limitBytes: limit };
  if (recent >= options.highShare * limit) return { ...verdict, cause: 'high', growthPerMinute };
  // Steady (or shrinking) memory is never a leak, however close the limit.
  if (slope <= 0) return { leak: false };
  // A rising trend must also be rising lately, not one old climb that settled.
  const last = floor.slice(-3);
  if (last.length === 3 && robustSlope(last) <= 0) return { leak: false };
  const projected = recent + slope * options.horizonMs;
  return projected >= options.projectedShare * limit
    ? { ...verdict, cause: 'growing', growthPerMinute }
    : { leak: false };
}

/** Pure: whether the samples show memory that will run out (heap first, then RSS). */
export function leakVerdict(
  samples: MemorySample[],
  limits: MemoryLimits,
  options: LeakOptions = LEAK_DEFAULTS,
): LeakVerdict {
  const heap = judge(
    'heap',
    samples.map((s) => ({ at: s.at, value: s.heapUsedBytes })),
    limits.heapBytes,
    options,
  );
  if (heap.leak) return heap;
  return judge(
    'rss',
    samples.map((s) => ({ at: s.at, value: s.rssBytes })),
    limits.rssBytes,
    options,
  );
}

export interface LeakWatchDeps {
  /** A turn, a chat or a managed command is working: wait for it. */
  busy: () => boolean;
  /** Conch is recovering after repeated trouble: restarting would only add to it. */
  held: () => boolean;
  /** Ask the supervisor for a graceful restart (`lib/lifecycle` `restart`). */
  restart: () => boolean;
  /** Say what was fixed, quietly. */
  note: (message: string) => void | Promise<void>;
  /** Running under the supervisor, which starts Conch again. */
  supervised?: () => boolean;
  /** Restarts asked for lately (the supervisor's shared budget). */
  recentRestarts?: () => number;
  sample?: () => MemorySample;
  limits?: () => Promise<MemoryLimits>;
  log?: (message: string) => void;
  now?: () => number;
  intervalMs?: number;
  options?: Partial<LeakOptions>;
}

/** What the person sees under Settings → Health → “Fixed on its own”. */
export const LEAK_NOTE = 'Restarted Conch to free up memory. Nothing was working at the time.';

export function ownMemory(now: number): MemorySample {
  const usage = process.memoryUsage();
  return { at: now, heapUsedBytes: usage.heapUsed, rssBytes: usage.rss };
}

export async function ownLimits(): Promise<MemoryLimits> {
  const heapBytes = getHeapStatistics().heap_size_limit;
  if (process.platform !== 'linux') return { heapBytes };
  const group = await cgroupMemory().catch(() => ({ limitBytes: undefined }));
  return group.limitBytes ? { heapBytes, rssBytes: group.limitBytes } : { heapBytes };
}

/** Requested restarts the supervisor has counted within its budget window. */
export function recentRestartRequests(home: string, now = Date.now()): number {
  return (readRecoveryState(home).requestedRestarts ?? []).filter(
    (at) => now - at < FAILURE_WINDOW_MS,
  ).length;
}

/**
 * Samples once a minute. At most one restart request per gateway run, only
 * when supervised, idle, out of recovery mode and with no other restart asked
 * for lately: the supervisor counts repeated requests as failures.
 */
export class LeakWatch {
  readonly #options: LeakOptions;
  #samples: MemorySample[] = [];
  #timer?: NodeJS.Timeout;
  #requested = false;
  #waiting = false;
  #ticking = false;

  constructor(private readonly deps: LeakWatchDeps) {
    this.#options = { ...LEAK_DEFAULTS, ...deps.options };
  }

  /** A restart has been asked for; this run never asks again. */
  get requested(): boolean {
    return this.#requested;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? 60_000);
    this.#timer.unref?.();
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** One sample and one decision. Never throws. */
  async tick(): Promise<void> {
    if (this.#ticking || this.#requested) return;
    this.#ticking = true;
    try {
      const now = (this.deps.now ?? Date.now)();
      this.#samples.push((this.deps.sample ?? (() => ownMemory(now)))());
      this.#samples = this.#samples.filter((s) => now - s.at <= this.#options.windowMs);
      const limits = await (this.deps.limits ?? ownLimits)();
      const verdict = leakVerdict(this.#samples, limits, this.#options);
      if (!verdict.leak) {
        this.#waiting = false;
        return;
      }
      if (!this.#waiting) {
        this.#waiting = true;
        this.deps.log?.(
          `[leak] ${verdict.measure} ${verdict.cause}: floor ${verdict.floorBytes} of ${verdict.limitBytes} bytes, ${verdict.growthPerMinute} bytes a minute; restarting when idle`,
        );
      }
      if (!(this.deps.supervised ?? (() => process.env.CONCH_SUPERVISED === '1'))()) return;
      if (this.deps.held() || this.deps.busy()) return;
      if ((this.deps.recentRestarts?.() ?? 0) > 0) return;
      this.#requested = true;
      this.stop();
      if (this.deps.restart()) await this.deps.note(LEAK_NOTE);
    } catch {
      // A reading that fails is tried again next minute.
    } finally {
      this.#ticking = false;
    }
  }
}
