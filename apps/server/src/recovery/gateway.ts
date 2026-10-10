import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { WorkloadPace } from './pace';
import { memoryReserve, type ResourceSnapshot } from './resources';
import type { RecoveryResource } from './supervisor-state';

/** Why new work waits, as a code a log or a test can read. */
export type HoldReason =
  | 'stopping'
  | 'recovering'
  | 'not-answering'
  | 'not-measured'
  | 'memory'
  | 'cpu'
  | 'easing'
  | 'held';

/**
 * Whether this computer has room for new work right now, and if not, why and
 * what it waits for, in fixed words an assistant can act on and a person can
 * read. Never a command, a path or anything a chat said.
 */
export type Room =
  | { room: true }
  | {
      room: false;
      reason: HoldReason;
      /** "the processor is busy". */
      why: string;
      /** "once the processor has been calm for about half a minute". */
      until: string;
    };

const HELD: Record<HoldReason, { why: string; until: string }> = {
  stopping: { why: 'Conch is stopping', until: 'once Conch has started again' },
  recovering: {
    why: 'Conch is recovering after repeated trouble',
    until: 'once Conch has stayed responsive for a full minute',
  },
  'not-answering': {
    why: 'Conch is checking that it can still respond',
    until: 'as soon as its next check answers, a few seconds from now',
  },
  'not-measured': {
    why: 'Conch can’t measure this computer’s room right now',
    until: 'as soon as its next look works, a few seconds from now',
  },
  memory: {
    why: 'memory is running short',
    until: 'once memory has stayed free for about half a minute',
  },
  cpu: {
    why: 'the processor is busy',
    until: 'once the processor has been calm for about half a minute',
  },
  easing: {
    why: 'this computer was busy a moment ago, and Conch is letting work back in gradually',
    until: 'within about a minute, as it stays calm',
  },
  held: { why: 'new work is held for now', until: 'as soon as there’s room' },
};

/** Local supervisor IPC only. No credentials, commands or conversation content. */
export type RecoveryMessage =
  | { type: 'conch.heartbeat'; healthy: boolean; resource?: RecoveryResource }
  | { type: 'conch.stopping' }
  | { type: 'conch.recovered' };

export interface GatewayRecoveryDeps {
  sample: () => Promise<ResourceSnapshot>;
  relieve: () => { stopped: number; queued: number };
  pause: (reason: string) => void;
  resume: () => void;
  note: (message: string) => void;
  send?: (message: RecoveryMessage) => void;
  /** Resumes clocks deliberately held back on a recovery boot. */
  recovered?: () => Promise<void>;
  recoveryMode?: boolean;
  now?: () => number;
  intervalMs?: number;
  checkMs?: number;
  /** Between the doctor's second looks when Conch didn't answer itself. */
  recheckMs?: number;
  autoRepairMs?: number;
  probationMs?: number;
  /** The shared resource controller may still be gradually restoring capacity. */
  admit?: () => boolean;
  /**
   * Whether work the person paused on purpose may go on: like `admit`, but a busy
   * processor doesn't hold it, only memory or Conch's own recovery. `admit` when absent.
   */
  admitPlanned?: () => boolean;
  /** The shared managed-work budget, to say why `admit` holds work. */
  pace?: () => WorkloadPace;
}

/** A stalled optional reader must not suppress proof that HTTP still answers. */
async function within<T>(read: () => Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(read)
        .catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The gateway's small half of recovery. The outside supervisor owns deadlines
 * and termination: this timer alone cannot detect its own event loop freezing.
 */
export class GatewayRecovery {
  #mode: boolean;
  #stopping = false;
  #snapshot?: ResourceSnapshot;
  #answering = false;
  #healthySince?: number;
  #timer?: NodeJS.Timeout;
  #polling?: Promise<void>;
  #repairing?: Promise<boolean>;
  #probe: () => Promise<boolean> = async () => false;
  #lastRelief = -Infinity;
  #lastRepair = -Infinity;
  #probation = false;
  #lastPoll?: number;

  constructor(private readonly deps: GatewayRecoveryDeps) {
    this.#mode = deps.recoveryMode ?? false;
  }

  get recoveryMode(): boolean {
    return this.#mode;
  }

  /** Unknown resources do not release a backlog before the first sample. */
  get allowsWork(): boolean {
    return (
      !this.#stopping &&
      !this.#mode &&
      this.#answering &&
      this.#snapshot?.level === 'healthy' &&
      (this.deps.admit?.() ?? true)
    );
  }

  /**
   * Work the person paused on purpose (an update, a restart they asked for) may carry on
   * while the computer is merely busy: it's theirs, one chat at a time, and it was
   * running a moment ago. Only memory running out, or Conch itself recovering, holds it.
   */
  get allowsPlanned(): boolean {
    return (
      !this.#stopping &&
      !this.#mode &&
      this.#answering &&
      this.#snapshot !== undefined &&
      this.#snapshot.level !== 'critical' &&
      (this.deps.admitPlanned ?? this.deps.admit ?? (() => true))()
    );
  }

  /** Why work waits right now, in a few words (for the log when a paused chat can't go on). */
  get holding(): string {
    const room = this.room();
    return room.room
      ? `${this.#snapshot?.level ?? 'unknown'}: ${this.#snapshot?.reason ?? ''}`
      : `${room.reason}: ${room.why}`;
  }

  /**
   * Whether there's room for new work (`allowsWork`), and if not, why and until
   * when. The same order of checks as `allowsWork`, so the two always agree.
   */
  room(): Room {
    const held = (reason: HoldReason): Room => ({ room: false, reason, ...HELD[reason] });
    if (this.#stopping) return held('stopping');
    if (this.#mode) return held('recovering');
    if (!this.#answering) return held('not-answering');
    const snapshot = this.#snapshot;
    if (!snapshot) return held('not-measured');
    if (snapshot.level !== 'healthy')
      return held(
        snapshot.availableBytes < memoryReserve(snapshot.totalBytes) ||
          (snapshot.memoryPressure ?? 0) >= 5
          ? 'memory'
          : 'cpu',
      );
    if (this.deps.admit && !this.deps.admit()) {
      const pace = this.deps.pace?.();
      if (!pace) return held('held');
      if (pace.phase === 'recovering') return held('easing');
      return held(
        pace.cause === 'memory'
          ? 'memory'
          : pace.cause === 'cpu'
            ? 'cpu'
            : pace.cause === 'recovery'
              ? 'recovering'
              : 'not-measured',
      );
    }
    return { room: true };
  }

  async start(probe: () => Promise<boolean>): Promise<void> {
    if (this.#timer || this.#stopping) return;
    this.#probe = probe;
    if (this.#mode) {
      this.deps.pause('Conch is recovering. Waiting work will carry on once it stays responsive.');
      this.deps.note('Paused background work to recover. It will carry on after a healthy check.');
    }
    await this.poll();
    if (!this.#stopping)
      this.#timer = setInterval(() => void this.poll(), this.deps.intervalMs ?? 5_000).unref();
  }

  poll(): Promise<void> {
    this.#polling ??= this.#poll().finally(() => (this.#polling = undefined));
    return this.#polling;
  }

  async #poll(): Promise<void> {
    if (this.#stopping) return;
    const started = performance.now();
    try {
      const [snapshot, response] = await Promise.all([
        within(() => this.deps.sample(), this.deps.checkMs ?? 2_500),
        within(() => this.#probe(), this.deps.checkMs ?? 2_500),
      ]);
      if (this.#stopping) return;
      const answering = response === true;
      this.#snapshot = snapshot;
      this.#answering = answering;
      // Pressure holds work and sheds managed jobs; do not restart a responsive
      // gateway just because an unrelated application is using this computer.
      const healthy = answering;
      const now = (this.deps.now ?? (() => performance.now()))();
      // A suspended laptop or a stalled poll is not evidence of continuous health.
      if (
        this.#lastPoll !== undefined &&
        now - this.#lastPoll > (this.deps.intervalMs ?? 5_000) * 3
      )
        this.#healthySince = undefined;
      this.#lastPoll = now;
      if (answering && snapshot?.level === 'healthy') this.#healthySince ??= now;
      else this.#healthySince = undefined;
      this.#send({
        type: 'conch.heartbeat',
        healthy,
        resource: {
          ...(snapshot && {
            memoryAvailableBytes: snapshot.availableBytes,
            memoryTotalBytes: snapshot.totalBytes,
            loadPerCpu: snapshot.loadPerCpu,
            ...(snapshot.memoryPressure !== null && { memoryPressure: snapshot.memoryPressure }),
            ...(snapshot.cgroupMemoryLimitBytes !== undefined && {
              cgroupMemoryLimitBytes: snapshot.cgroupMemoryLimitBytes,
              cgroupMemoryAvailableBytes: snapshot.cgroupMemoryAvailableBytes,
            }),
          }),
          gatewayRssBytes: process.memoryUsage.rss(),
          probeMs: Math.max(0, performance.now() - started),
        },
      });
      if (this.#healthySince !== undefined) {
        if (
          this.#mode &&
          now - this.#healthySince >= (this.deps.autoRepairMs ?? 60_000) &&
          now - this.#lastRepair >= (this.deps.autoRepairMs ?? 60_000)
        )
          void this.#attemptRepair(true);
        if (this.#probation && now - this.#healthySince >= (this.deps.probationMs ?? 600_000)) {
          this.#probation = false;
          this.#send({ type: 'conch.recovered' });
        }
      }
    } catch {
      if (this.#stopping) return;
      this.#snapshot = undefined;
      this.#answering = false;
      this.#healthySince = undefined;
      this.#send({ type: 'conch.heartbeat', healthy: false });
    }
  }

  /** Called only by our parent over IPC, never by a page or an agent tool. */
  receive(raw: unknown): void {
    if (
      this.#stopping ||
      typeof raw !== 'object' ||
      raw === null ||
      !('type' in raw) ||
      raw.type !== 'conch.recover'
    )
      return;
    const now = (this.deps.now ?? Date.now)();
    if (now - this.#lastRelief < 30_000) return;
    this.#lastRelief = now;
    const { stopped } = this.deps.relieve();
    this.deps.note(
      stopped
        ? 'Stopped a heavy command to stay responsive. Its output is kept.'
        : 'Held new commands a moment to stay responsive',
    );
    void this.poll();
  }

  stop(): void {
    if (this.#stopping) return;
    this.#stopping = true;
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.deps.pause('Conch is saving your place before it stops.');
    this.#send({ type: 'conch.stopping' });
  }

  #send(message: RecoveryMessage): void {
    try {
      this.deps.send?.(message);
    } catch {
      // The parent may have gone away; never crash while reporting health.
    }
  }

  #attemptRepair(automatic = false): Promise<boolean> {
    this.#repairing ??= this.#repair(automatic)
      .catch(() => false)
      .finally(() => (this.#repairing = undefined));
    return this.#repairing;
  }

  async #repair(automatic: boolean): Promise<boolean> {
    const now = (this.deps.now ?? (() => performance.now()))();
    if (
      this.#stopping ||
      !this.#mode ||
      this.#healthySince === undefined ||
      now - this.#healthySince < (automatic ? (this.deps.autoRepairMs ?? 60_000) : 15_000)
    )
      return false;
    this.#lastRepair = now;
    await this.deps.recovered?.();
    if (this.#stopping) return false;
    await this.poll();
    if (
      this.#stopping ||
      !this.#answering ||
      this.#snapshot?.level !== 'healthy' ||
      this.#healthySince === undefined ||
      (this.deps.now ?? (() => performance.now()))() - this.#healthySince <
        (automatic ? (this.deps.autoRepairMs ?? 60_000) : 15_000)
    )
      return false;
    this.#mode = false;
    this.deps.resume();
    // Automatic repair cannot erase the durable crash budget after a brief lull.
    if (automatic) {
      this.#probation = true;
      this.deps.note('Resumed waiting work after checking that Conch stays responsive');
    } else this.#send({ type: 'conch.recovered' });
    return true;
  }

  doctorCheck(): DoctorCheck {
    return {
      id: 'recovery',
      group: 'This computer',
      title: 'Staying responsive',
      run: async ({ repair, signal }) => {
        await this.poll();
        // One slow answer isn't a verdict: this look runs beside every other check,
        // its busiest moment. Ask again, a moment apart, before saying it can't respond.
        for (let i = 0; i < 2 && !this.#answering && !this.#mode && !this.#stopping; i++) {
          await new Promise((resolve) => setTimeout(resolve, this.deps.recheckMs ?? 1_000));
          if (signal.aborted) break;
          await this.poll();
        }
        let fixed = false;
        if (repair && this.#mode) {
          fixed = await this.#attemptRepair();
        }
        const item: DoctorItem = {
          id: 'recovery',
          group: 'This computer',
          title: 'Staying responsive',
          // Paused after trouble is Repair's to carry on from; after a repair, or while
          // Conch checks itself, there's nothing to do: news.
          state: fixed
            ? 'fixed'
            : this.#mode && !repair
              ? 'warning'
              : this.#mode || !this.allowsWork
                ? 'info'
                : 'ok',
          ...(!fixed && this.#mode && !repair && { repairable: true }),
          message: fixed
            ? 'Conch is responding again. Waiting work will carry on gradually.'
            : this.#mode
              ? !this.#answering || this.#snapshot?.level !== 'healthy'
                ? 'Background work is paused after repeated trouble. Conch is waiting for this computer to recover before it can carry on.'
                : this.#healthySince === undefined ||
                    (this.deps.now ?? (() => performance.now()))() - this.#healthySince < 15_000
                  ? 'Conch is checking that it stays responsive. Waiting work will carry on automatically.'
                  : 'Conch is checking before it resumes waiting work. Repair everything can check now.'
              : this.#stopping
                ? 'Conch is saving your place before it stops.'
                : !this.#answering
                  ? 'Conch is checking that it can respond before starting more work.'
                  : this.#snapshot?.level === 'healthy'
                    ? 'Conch has room to work and is watching for slowdowns.'
                    : (this.#snapshot?.reason ??
                      'Conch is checking this computer before starting more work.'),
        };
        return [item];
      },
    };
  }
}
