import type { ChildProcess } from 'node:child_process';
import { gatewayChildren } from './children';

import { recoveryResource, type RecoveryResource } from './supervisor-state';

export interface WatchdogOptions {
  now?: () => number;
  /** Old releases have no heartbeat sender; retain crash/stop supervision only. */
  enabled?: boolean;
  startupMs?: number;
  unhealthyMs?: number;
  recoverMs?: number;
  pollMs?: number;
  /** Health that keeps coming back only to fail again is a restart, not another reduction. */
  flapLimit?: number;
  flapWindowMs?: number;
  stopMs?: number;
  /** A gateway that said nothing while reducing can't run a SIGTERM handler: kill it sooner. */
  frozenStopMs?: number;
  /** The launcher created a private POSIX process group for this gateway. */
  processGroup?: boolean;
  /** Only members of this registered service, excluding the supervisor's baseline. */
  serviceMembers?: () => number[];
  stopping: () => boolean;
  incident: (
    reason: 'unresponsive' | 'reduced-workload' | 'responsive',
    resource?: RecoveryResource,
  ) => void;
  repaired: () => void;
}

/** booting → healthy → reducing → terminating; `since` is the current deadline's reference. */
export type WatchPhase = 'booting' | 'healthy' | 'reducing' | 'terminating';
export interface WatchState {
  phase: WatchPhase;
  since: number;
  /** Terminating because the gateway stopped answering, not because it was asked to stop. */
  failed: boolean;
  /** When this supervisor last judged; a long gap means it was asleep, not the gateway. */
  lastTick?: number;
  /** The last well-formed IPC message: proof the gateway's event loop runs. */
  heardAt?: number;
  /** Terminating a gateway that sent nothing at all while it was reducing. */
  frozen?: boolean;
  /** When recent reductions started, within the flap window. */
  reductions?: number[];
}
export type WatchEvent =
  | { type: 'tick'; at: number }
  | { type: 'healthy'; at: number }
  | { type: 'message'; at: number }
  | { type: 'shutdown'; at: number; failed: boolean };
export interface WatchLimits {
  startupMs: number;
  unhealthyMs: number;
  recoverMs: number;
  pollMs: number;
  flapLimit: number;
  flapWindowMs: number;
}

/** The watchdog's only transition function: pure, so every verdict is testable. */
export function watchTransition(
  state: WatchState,
  event: WatchEvent,
  limits: WatchLimits,
): WatchState {
  if (state.phase === 'terminating') return state;
  if (event.type === 'shutdown')
    return { ...state, phase: 'terminating', since: event.at, failed: event.failed };
  if (event.type === 'healthy') return { ...state, phase: 'healthy', since: event.at };
  if (event.type === 'message') return { ...state, heardAt: event.at };
  const ticked = { ...state, lastTick: event.at };
  // The monotonic clock counts a laptop's sleep (macOS): a nap is not silence.
  if (state.lastTick !== undefined && event.at - state.lastTick > limits.pollMs * 3)
    return { ...ticked, since: event.at };
  const elapsed = event.at - state.since;
  if (
    (state.phase === 'booting' && elapsed >= limits.startupMs) ||
    (state.phase === 'healthy' && elapsed >= limits.unhealthyMs)
  ) {
    const reductions = [
      ...(state.reductions ?? []).filter((at) => event.at - at < limits.flapWindowMs),
      event.at,
    ];
    if (reductions.length < limits.flapLimit)
      return { ...ticked, phase: 'reducing', since: event.at, reductions };
    const frozen = state.heardAt === undefined || state.heardAt <= state.since;
    return { ...ticked, phase: 'terminating', since: event.at, failed: true, frozen, reductions };
  }
  if (state.phase === 'reducing' && elapsed >= limits.recoverMs) {
    const frozen = state.heardAt === undefined || state.heardAt < state.since;
    return { ...ticked, phase: 'terminating', since: event.at, failed: true, frozen };
  }
  return ticked;
}

/** Watches from another event loop, so even a completely blocked gateway can recover. */
export function watchGateway(
  child: ChildProcess,
  options: WatchdogOptions,
): {
  close: () => void;
  stop: (signal?: NodeJS.Signals) => void;
  failed: () => boolean;
} {
  const now = options.now ?? (() => performance.now());
  const limits: WatchLimits = {
    startupMs: options.startupMs ?? 120_000,
    unhealthyMs: options.unhealthyMs ?? 30_000,
    recoverMs: options.recoverMs ?? 20_000,
    pollMs: options.pollMs ?? 5_000,
    flapLimit: options.flapLimit ?? 3,
    flapWindowMs: options.flapWindowMs ?? 5 * 60_000,
  };
  let state: WatchState = { phase: 'booting', since: now(), failed: false };
  let resource: RecoveryResource | undefined;
  let forced: NodeJS.Timeout | undefined;
  // A flapping gateway records its first cycle, not one pair of incidents every few seconds.
  let reported: number | undefined;
  let quiet = false;
  const children = child.pid
    ? gatewayChildren(child.pid, options.processGroup === true, {
        serviceMembers: options.serviceMembers,
      })
    : undefined;
  const recover = () => {
    if (!child.connected) return;
    try {
      child.send({ type: 'conch.recover' }, () => undefined);
    } catch {
      /* A closing IPC pipe does not stop recovery. */
    }
  };
  // Effects, incidents included, happen only when the phase changes.
  const apply = (event: WatchEvent) => {
    const before = state;
    state = watchTransition(before, event, limits);
    if (state.phase === before.phase) return;
    if (state.phase === 'reducing') {
      quiet = reported !== undefined && state.since - reported < limits.flapWindowMs;
      if (!quiet) {
        reported = state.since;
        options.incident('reduced-workload', resource);
      }
      recover();
    } else if (state.phase === 'healthy' && before.phase === 'reducing') {
      if (!quiet) options.incident('responsive', resource);
    } else if (state.phase === 'terminating') {
      if (state.failed) options.incident('unresponsive', resource);
      children?.sample();
      const stopMs = options.stopMs ?? 15_000;
      forced = setTimeout(
        () => {
          children?.close();
          child.kill('SIGKILL');
        },
        state.frozen ? Math.min(stopMs, options.frozenStopMs ?? 2_000) : stopMs,
      );
      if (state.failed) child.kill('SIGTERM');
    }
  };
  const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
    if (state.phase === 'terminating') return;
    apply({ type: 'shutdown', at: now(), failed: false });
    child.kill(signal);
  };
  const message = (value: unknown) => {
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    apply({ type: 'message', at: now() });
    if (value.type === 'conch.recovered') options.repaired();
    if (value.type === 'conch.stopping') apply({ type: 'shutdown', at: now(), failed: false });
    if (value.type !== 'conch.heartbeat') return;
    if ('resource' in value) resource = recoveryResource(value.resource);
    if ('healthy' in value && value.healthy === true) apply({ type: 'healthy', at: now() });
  };
  child.on('message', message);
  const timer = setInterval(() => {
    if (options.enabled === false || options.stopping() || state.phase === 'terminating') return;
    apply({ type: 'tick', at: now() });
  }, limits.pollMs);
  timer.unref();
  return {
    stop,
    failed: () => state.failed,
    close: () => {
      clearInterval(timer);
      clearTimeout(forced);
      child.off('message', message);
      children?.close();
    },
  };
}
