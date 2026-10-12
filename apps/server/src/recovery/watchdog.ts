import type { ChildProcess } from 'node:child_process';
import { gatewayChildren } from './children';

import { recoveryResource, type RecoveryResource } from './supervisor-state';

export interface WatchdogOptions {
  now?: () => number;
  /** Old releases have no heartbeat sender; retain crash/stop supervision only. */
  enabled?: boolean;
  /** Silence allowed while starting: no message at all, import time included. */
  startupMs?: number;
  /** A gateway saying it is still starting has this long to answer its first probe. */
  readyMs?: number;
  unhealthyMs?: number;
  recoverMs?: number;
  pollMs?: number;
  /** Health that keeps coming back only to fail again is a restart, not another reduction. */
  flapLimit?: number;
  flapWindowMs?: number;
  /** The most a responsive gateway's deadlines stretch while other programs starve the computer. */
  maxStretch?: number;
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
  /** Once, as an unresponsive gateway is about to be stopped; it never delays the kill. */
  beforeKill?: (frozen: boolean) => void;
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
  /** The latest `conch.booting` phase; old releases never send one. */
  bootPhase?: string;
  /** When managed work was last shed while reducing. */
  shedAt?: number;
}
export type WatchEvent =
  | { type: 'tick'; at: number; stretch?: number }
  | { type: 'healthy'; at: number }
  | { type: 'message'; at: number }
  | { type: 'booting'; at: number; phase: string }
  | { type: 'heartbeat'; at: number }
  | { type: 'shutdown'; at: number; failed: boolean };
export interface WatchLimits {
  startupMs: number;
  readyMs: number;
  unhealthyMs: number;
  recoverMs: number;
  pollMs: number;
  flapLimit: number;
  flapWindowMs: number;
}

/**
 * How much longer a gateway that still answers gets when something else is starving
 * this computer. None when the gateway itself is the likely culprit: a restart cures that.
 */
export function pressureStretch(resource: RecoveryResource | undefined, max = 3): number {
  if (!resource) return 1;
  const {
    gatewayRssBytes: rss,
    memoryTotalBytes: total,
    memoryAvailableBytes: available,
    cgroupMemoryLimitBytes: limit,
    cgroupMemoryAvailableBytes: limitAvailable,
  } = resource;
  if (rss === undefined) return 1;
  if (total && rss / total >= 0.25) return 1;
  if (limit && (rss / limit >= 0.5 || (limitAvailable ?? limit) / limit < 0.1)) return 1;
  const share = total && available !== undefined ? available / total : 1;
  const load = resource.loadPerCpu ?? 0;
  const pressure = resource.memoryPressure ?? 0;
  const starved = Math.max(
    share < 0.05 ? 3 : share < 0.1 ? 2 : 1,
    load >= 3 ? 3 : load >= 1.5 ? 2 : 1,
    pressure >= 20 ? 3 : pressure >= 5 ? 2 : 1,
  );
  return Math.max(1, Math.min(max, starved));
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
  if (event.type === 'booting') {
    if (state.phase !== 'booting') return state;
    // Waiting for another Conch to close can last indefinitely: readiness counts from after it.
    const since = event.phase === 'waiting' ? event.at : state.since;
    return { ...state, since, bootPhase: event.phase };
  }
  if (event.type === 'heartbeat')
    // A release that announces its start tracks health from its first heartbeat, healthy or not.
    return state.phase === 'booting' && state.bootPhase !== undefined
      ? { ...state, phase: 'healthy', since: event.at }
      : state;
  const ticked = { ...state, lastTick: event.at };
  // The monotonic clock counts a laptop's sleep (macOS): a nap is not silence.
  if (state.lastTick !== undefined && event.at - state.lastTick > limits.pollMs * 3)
    return { ...ticked, since: event.at };
  const elapsed = event.at - state.since;
  const silent = event.at - Math.max(state.since, state.heardAt ?? state.since);
  // Only a gateway still talking gets longer while other programs starve the computer.
  const stretch = (window: number) =>
    state.heardAt !== undefined && event.at - state.heardAt < window ? (event.stretch ?? 1) : 1;
  const booted =
    state.bootPhase === undefined
      ? elapsed >= limits.startupMs
      : silent >= limits.startupMs || (state.bootPhase !== 'waiting' && elapsed >= limits.readyMs);
  if (
    (state.phase === 'booting' && booted) ||
    (state.phase === 'healthy' && elapsed >= limits.unhealthyMs * stretch(limits.unhealthyMs))
  ) {
    const reductions = [
      ...(state.reductions ?? []).filter((at) => event.at - at < limits.flapWindowMs),
      event.at,
    ];
    if (reductions.length < limits.flapLimit)
      return { ...ticked, phase: 'reducing', since: event.at, shedAt: event.at, reductions };
    const frozen = state.heardAt === undefined || state.heardAt <= state.since;
    return { ...ticked, phase: 'terminating', since: event.at, failed: true, frozen, reductions };
  }
  if (state.phase === 'reducing') {
    if (elapsed >= limits.recoverMs * stretch(limits.recoverMs)) {
      const frozen = state.heardAt === undefined || state.heardAt < state.since;
      return { ...ticked, phase: 'terminating', since: event.at, failed: true, frozen };
    }
    // A stretched reduction keeps shedding work, once per recoverMs.
    if (event.at - (state.shedAt ?? state.since) >= limits.recoverMs)
      return { ...ticked, shedAt: event.at };
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
    readyMs: options.readyMs ?? 15 * 60_000,
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
  // Effects, incidents included, happen only on transitions.
  const apply = (event: WatchEvent) => {
    const before = state;
    state = watchTransition(before, event, limits);
    if (state.phase === before.phase) {
      if (state.phase === 'reducing' && state.shedAt !== before.shedAt) recover();
      return;
    }
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
      if (state.failed) {
        options.incident('unresponsive', resource);
        try {
          options.beforeKill?.(state.frozen === true);
        } catch {
          /* Evidence is best effort; the kill is not. */
        }
      }
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
    if (value.type === 'conch.booting' && 'phase' in value && typeof value.phase === 'string')
      apply({ type: 'booting', at: now(), phase: value.phase });
    if (value.type !== 'conch.heartbeat') return;
    apply({ type: 'heartbeat', at: now() });
    // A heartbeat without measurements must not leave older numbers looking current.
    resource = 'resource' in value ? recoveryResource(value.resource) : undefined;
    if ('healthy' in value && value.healthy === true) apply({ type: 'healthy', at: now() });
  };
  child.on('message', message);
  const timer = setInterval(() => {
    if (options.enabled === false || options.stopping() || state.phase === 'terminating') return;
    apply({ type: 'tick', at: now(), stretch: pressureStretch(resource, options.maxStretch) });
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
