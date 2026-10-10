import { memoryReserve, type ResourceSnapshot } from './resources';

export interface WorkloadPace {
  phase: 'normal' | 'constrained' | 'held' | 'recovering';
  cause: 'memory' | 'cpu' | 'unknown' | 'recovery';
  concurrency: number;
  critical: boolean;
}

const FRESH_MS = 15_000;
const SETTLE_MS = 30_000;
const STEP_MS = 10_000;
const unknown = (): WorkloadPace => ({
  phase: 'held',
  cause: 'unknown',
  concurrency: 0,
  critical: false,
});

/** One shared budget: reduce immediately, prove recovery, then add one slot per step. */
export class ResourcePace {
  #value = unknown();
  #at?: number;
  #healthySince?: number;
  #raisedAt?: number;
  #limited = false;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get current(): WorkloadPace {
    if (this.#at === undefined || this.now() < this.#at || this.now() - this.#at > FRESH_MS)
      return unknown();
    return { ...this.#value };
  }

  hold(cause: WorkloadPace['cause'] = 'unknown') {
    this.#limited = true;
    this.#healthySince = this.#raisedAt = undefined;
    this.#at = this.now();
    this.#value = { phase: 'held', cause, concurrency: 0, critical: false };
  }

  observe(sample: ResourceSnapshot): WorkloadPace {
    const now = this.now();
    if (this.#at !== undefined && (now < this.#at || now - this.#at > FRESH_MS)) this.hold();
    this.#at = now;
    if (
      !Number.isFinite(sample.availableBytes) ||
      sample.availableBytes < 0 ||
      !Number.isFinite(sample.totalBytes) ||
      sample.totalBytes <= 0 ||
      !Number.isFinite(sample.loadPerCpu) ||
      !Number.isFinite(sample.concurrency) ||
      sample.concurrency < 0
    ) {
      this.hold();
      return this.current;
    }
    const capacity = Math.min(4, Math.floor(sample.concurrency));
    const memory =
      sample.availableBytes < memoryReserve(sample.totalBytes) * 2 ||
      (sample.memoryPressure ?? 0) >= 2;
    const warning = memory || sample.loadPerCpu >= 1;
    const held = sample.level !== 'healthy' || capacity === 0;
    if (warning || held) {
      this.#limited = true;
      this.#healthySince = this.#raisedAt = undefined;
      this.#value = {
        phase: held ? 'held' : 'constrained',
        cause: memory ? 'memory' : 'cpu',
        concurrency: held ? 0 : Math.min(1, capacity),
        critical: sample.level === 'critical',
      };
    } else if (!this.#limited) {
      this.#value = { phase: 'normal', cause: 'recovery', concurrency: capacity, critical: false };
    } else {
      this.#healthySince ??= now;
      let slots = Math.min(this.#value.concurrency, capacity);
      if (
        now - this.#healthySince >= SETTLE_MS &&
        (this.#raisedAt === undefined || now - this.#raisedAt >= STEP_MS)
      ) {
        // Never bank elapsed time into a burst, even after suspend or a stalled poll.
        slots = Math.min(capacity, slots + 1);
        this.#raisedAt = now;
      }
      const normal = now - this.#healthySince >= SETTLE_MS && slots >= capacity;
      this.#value = {
        phase: normal ? 'normal' : 'recovering',
        cause: 'recovery',
        concurrency: slots,
        critical: false,
      };
      if (normal) this.#limited = false;
    }
    return this.current;
  }
}

/**
 * May work the person asked for just now go on (a chat paused for an update,
 * a task they pressed Start now on)? Yes when all is normal, and while the
 * processor is merely busy; not while memory is short or Conch recovers. (A
 * normal pace says `cause: 'recovery'`, so the phase is asked first.)
 */
export function admitsPlanned(pace: WorkloadPace): boolean {
  if (pace.phase === 'normal') return true;
  return !pace.critical && pace.cause !== 'memory' && pace.cause !== 'recovery';
}

/** Only fixed host-authored words. Never interpolate tool output, commands or other chats. */
export function paceMessage(pace: WorkloadPace): string {
  const next =
    'Use process_start for heavy work and process_read with wait_ms: 30000 to wait without repeated retries. Keep approvals and uncertain actions intact; never raise system limits or stop another chat’s work.';
  switch (pace.phase) {
    case 'normal':
      return 'Resource pressure has cleared after sustained health. Continue the existing task from its saved progress; Conch has restored its managed work budget. Inspect any stopped command’s output before deciding whether to retry it.';
    case 'constrained':
      return `This computer is approaching its ${pace.cause === 'memory' ? 'memory' : 'CPU'} budget. Reduce parallel jobs and avoid extra browser tabs; prefer smaller batches, reading or planning. Conch is limiting managed work to one command at a time. ${next}`;
    case 'held':
      return `${pace.cause === 'unknown' ? 'Conch cannot yet verify resource headroom.' : pace.cause === 'recovery' ? 'Conch is recovering.' : `This computer is under ${pace.critical ? 'critical ' : ''}${pace.cause === 'memory' ? 'memory' : 'CPU'} pressure.`} New heavy work is waiting. Continue with lighter steps or wait for room; do not bypass the queue through a native shell. ${next}`;
    case 'recovering':
      return `Resource pressure is easing. Conch is checking sustained health and restoring work gradually. Keep parallelism low and continue the existing task with lighter steps while queued commands wait their turn. ${next}`;
  }
}
