import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { ResourceSnapshot } from './resources';
import type { RecoveryResource } from './supervisor-state';

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

  constructor(private readonly deps: GatewayRecoveryDeps) {
    this.#mode = deps.recoveryMode ?? false;
  }

  get recoveryMode(): boolean {
    return this.#mode;
  }

  /** Unknown resources do not release a backlog before the first sample. */
  get allowsWork(): boolean {
    return !this.#stopping && !this.#mode && this.#answering && this.#snapshot?.level === 'healthy';
  }

  async start(probe: () => Promise<boolean>): Promise<void> {
    if (this.#timer || this.#stopping) return;
    this.#probe = probe;
    if (this.#mode) {
      this.deps.pause('Conch is recovering. Open Settings → Health and choose Repair everything.');
      this.deps.note(
        'Conch kept having trouble, so it paused background work to stay available. Settings → Health can help it carry on.',
      );
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
      const [resources, response] = await Promise.allSettled([
        Promise.resolve().then(() => this.deps.sample()),
        Promise.resolve().then(() => this.#probe()),
      ]);
      if (this.#stopping) return;
      const snapshot = resources.status === 'fulfilled' ? resources.value : undefined;
      const answering = response.status === 'fulfilled' && response.value;
      this.#snapshot = snapshot;
      this.#answering = answering;
      // Pressure holds work and sheds managed jobs; do not restart a responsive
      // gateway just because an unrelated application is using this computer.
      const healthy = answering;
      if (answering && snapshot?.level === 'healthy')
        this.#healthySince ??= (this.deps.now ?? Date.now)();
      else this.#healthySince = undefined;
      this.#send({
        type: 'conch.heartbeat',
        healthy,
        resource: {
          ...(snapshot && {
            memoryAvailableBytes: snapshot.availableBytes,
            memoryTotalBytes: snapshot.totalBytes,
            loadPerCpu: snapshot.loadPerCpu,
          }),
          gatewayRssBytes: process.memoryUsage.rss(),
          probeMs: Math.max(0, performance.now() - started),
        },
      });
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
        ? 'Conch stopped a managed command and held new commands briefly to keep responding.'
        : 'Conch held new commands briefly while checking that it can respond.',
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

  async #repair(): Promise<boolean> {
    await this.poll();
    if (
      this.#stopping ||
      this.#healthySince === undefined ||
      (this.deps.now ?? Date.now)() - this.#healthySince < 15_000
    )
      return false;
    await this.deps.recovered?.();
    if (this.#stopping) return false;
    this.#mode = false;
    this.deps.resume();
    this.#send({ type: 'conch.recovered' });
    return true;
  }

  doctorCheck(): DoctorCheck {
    return {
      id: 'recovery',
      group: 'This computer',
      title: 'Staying responsive',
      run: async ({ repair }) => {
        await this.poll();
        let fixed = false;
        if (repair && this.#mode) {
          this.#repairing ??= this.#repair().finally(() => (this.#repairing = undefined));
          fixed = await this.#repairing;
        }
        const item: DoctorItem = {
          id: 'recovery',
          group: 'This computer',
          title: 'Staying responsive',
          state: fixed ? 'fixed' : this.#mode || !this.allowsWork ? 'warning' : 'ok',
          message: fixed
            ? 'Conch is responding again. Waiting work will carry on gradually.'
            : this.#mode
              ? !this.#answering || this.#snapshot?.level !== 'healthy'
                ? 'Background work is paused after repeated trouble. Conch is waiting for this computer to recover before it can carry on.'
                : this.#healthySince === undefined ||
                    (this.deps.now ?? Date.now)() - this.#healthySince < 15_000
                  ? 'Conch is checking that it stays responsive. Wait a moment, then choose Repair everything to carry on.'
                  : 'Conch is ready to continue. Choose Repair everything to let waiting work carry on.'
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
