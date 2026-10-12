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
  /**
   * Stalls each shorter than `unhealthyMs` still add up: when fewer than `healthyShare` of the
   * heartbeats due in the last `healthWindowMs` were healthy, work is reduced as at a deadline.
   */
  healthWindowMs?: number;
  healthyShare?: number;
  /** The most a responsive gateway's deadlines stretch while other programs starve the computer. */
  maxStretch?: number;
  stopMs?: number;
  /**
   * A gateway that said nothing while reducing can't run a SIGTERM handler, so it gets no
   * SIGTERM, only SIGKILL after this grace. It covers `beforeKill`'s evidence capture (bounded
   * at 2 s): a gateway still booting has no handler, and Node's default SIGTERM would end it
   * before the capture is served.
   */
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

/**
 * How long the gateway ignores another `conch.recover` after acting on one: matches
 * `GatewayRecovery.receive` in recovery/gateway.ts. A request inside it is dropped.
 */
export const RELIEF_COOLDOWN_MS = 30_000;

/** booting → healthy → reducing → terminating; `since` is the current deadline's reference. */
export type WatchPhase = 'booting' | 'healthy' | 'reducing' | 'terminating';
export interface WatchState {
  phase: WatchPhase;
  since: number;
  /** Terminating because the gateway stopped answering, not because it was asked to stop. */
  failed: boolean;
  /** When this supervisor last judged; a long gap means it was asleep, not the gateway. */
  lastTick?: number;
  /** The last late tick was taken for this supervisor's sleep; until one is on time, late ones are judged. */
  napped?: boolean;
  /** The last well-formed IPC message: proof the gateway's event loop runs. */
  heardAt?: number;
  /** Terminating a gateway that sent nothing at all while it was reducing. */
  frozen?: boolean;
  /**
   * Terminating a frozen reduction, which sent no SIGTERM: a healthy heartbeat before the
   * kill takes it back. Not a flap-limit restart, which follows health that keeps coming back.
   */
  revocable?: boolean;
  /** Someone asked it to stop (Ctrl+C, `conch.stopping`): that is never taken back. */
  requested?: boolean;
  /** When recent reductions started, within the flap window. */
  reductions?: number[];
  /** The latest `conch.booting` phase; old releases never send one. */
  bootPhase?: string;
  /** When managed work was last shed while reducing. */
  shedAt?: number;
  /** Healthy heartbeats within the health window, and when that window began to be watched. */
  beats?: number[];
  beatsFrom?: number;
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
  healthWindowMs?: number;
  healthyShare?: number;
}

/**
 * How much longer a gateway that still answers gets when something else is starving
 * this computer. None when the gateway itself is the likely culprit, by its memory or by a
 * loop that runs late while the computer is calm: a restart cures that.
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
  // A loop running late on idle processors with memory to spare is busy with its own work:
  // only short processors or critical memory stalls explain it.
  const busy = (resource.eventLoopDelayP99Ms ?? 0) > 500;
  if (busy && load < 1.5 && share >= 0.1 && pressure < 20) return 1;
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
  const healthWindow = limits.healthWindowMs ?? 120_000;
  if (state.phase === 'terminating') {
    if (event.type === 'shutdown' && !event.failed) return { ...state, requested: true };
    // It answered in time after all: back to watching it. The flap limit still counts this.
    if (event.type === 'healthy' && state.revocable && !state.requested)
      return {
        ...state,
        phase: 'healthy',
        since: event.at,
        failed: false,
        frozen: undefined,
        revocable: undefined,
        beats: [event.at],
        beatsFrom: event.at,
      };
    return state;
  }
  if (event.type === 'shutdown')
    return {
      ...state,
      phase: 'terminating',
      since: event.at,
      failed: event.failed,
      requested: !event.failed,
    };
  if (event.type === 'healthy') {
    const beats = [...(state.beats ?? []).filter((at) => event.at - at < healthWindow), event.at];
    return {
      ...state,
      phase: 'healthy',
      since: event.at,
      beats,
      beatsFrom: state.beatsFrom ?? event.at,
    };
  }
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
      ? { ...state, phase: 'healthy', since: event.at, beatsFrom: event.at }
      : state;
  const late = state.lastTick !== undefined && event.at - state.lastTick > limits.pollMs * 3;
  // Heartbeats that arrive in bursts after a late tick (a nap, a throttled supervisor) can't be
  // counted per interval: the health window starts again.
  const ticked = {
    ...state,
    lastTick: event.at,
    napped: late,
    ...(late && state.beatsFrom !== undefined && { beats: [], beatsFrom: event.at }),
  };
  // The monotonic clock counts a laptop's sleep (macOS): a nap is not silence. Ticks that are
  // always late (App Nap, timer coalescing, a loaded host) are not one nap after another.
  if (late && !state.napped) return { ...ticked, since: event.at };
  const elapsed = event.at - state.since;
  const silent = event.at - Math.max(state.since, state.heardAt ?? state.since);
  // Only a gateway still talking gets longer while other programs starve the computer.
  const stretch = (window: number) =>
    state.heardAt !== undefined && event.at - state.heardAt < window ? (event.stretch ?? 1) : 1;
  // How many of the heartbeats due over the whole health window were healthy, one per interval.
  const due = Math.floor(healthWindow / limits.pollMs);
  const answered = new Set(
    (state.beats ?? [])
      .filter((at) => event.at - at < healthWindow)
      .map((at) => Math.floor((event.at - at) / limits.pollMs)),
  ).size;
  const sparse =
    state.phase === 'healthy' &&
    !late &&
    stretch(limits.unhealthyMs) === 1 &&
    state.beatsFrom !== undefined &&
    event.at - state.beatsFrom >= healthWindow &&
    due >= 4 &&
    answered < due * (limits.healthyShare ?? 0.4);
  const booted =
    state.bootPhase === undefined
      ? elapsed >= limits.startupMs
      : silent >= limits.startupMs || (state.bootPhase !== 'waiting' && elapsed >= limits.readyMs);
  if (
    (state.phase === 'booting' && booted) ||
    (state.phase === 'healthy' &&
      (elapsed >= limits.unhealthyMs * stretch(limits.unhealthyMs) || sparse))
  ) {
    const recent = (state.reductions ?? []).filter((at) => event.at - at < limits.flapWindowMs);
    // A stretched cycle is a starved computer, not flapping: its reductions start every
    // 90 s or so, and three of them in the window would restart a gateway that still answers.
    const stretched = state.phase === 'healthy' && stretch(limits.unhealthyMs) > 1;
    const reductions = stretched ? recent : [...recent, event.at];
    // Each reduction is judged on the health that follows it.
    const fresh = { beats: [], beatsFrom: event.at };
    if (stretched || reductions.length < limits.flapLimit)
      return {
        ...ticked,
        ...fresh,
        phase: 'reducing',
        since: event.at,
        shedAt: event.at,
        reductions,
      };
    const frozen = state.heardAt === undefined || state.heardAt <= state.since;
    return { ...ticked, phase: 'terminating', since: event.at, failed: true, frozen, reductions };
  }
  if (state.phase === 'reducing') {
    if (elapsed >= limits.recoverMs * stretch(limits.recoverMs)) {
      const frozen = state.heardAt === undefined || state.heardAt < state.since;
      return {
        ...ticked,
        phase: 'terminating',
        since: event.at,
        failed: true,
        frozen,
        revocable: frozen,
      };
    }
    // A stretched reduction keeps shedding work, once per recoverMs but never inside the
    // gateway's cooldown, which would drop the request.
    const shed = event.at - (state.shedAt ?? state.since);
    if (shed >= limits.recoverMs && shed > RELIEF_COOLDOWN_MS)
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
    healthWindowMs: options.healthWindowMs ?? 2 * 60_000,
    healthyShare: options.healthyShare ?? 0.4,
  };
  let state: WatchState = { phase: 'booting', since: now(), failed: false };
  let resource: RecoveryResource | undefined;
  let measuredAt = 0;
  // A silent gateway's last numbers are from before it went quiet, not now: omit them after
  // two heartbeats' time.
  const current = () => (now() - measuredAt <= limits.pollMs * 2 ? resource : undefined);
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
    if (before.phase === 'terminating') {
      // Being stopped on request (the desktop app quitting) is never taken back.
      if (options.stopping()) {
        state = before;
        return;
      }
      // A frozen gateway that answered before its kill: nothing was sent that it must survive.
      clearTimeout(forced);
      forced = undefined;
      options.incident('responsive', current());
    } else if (state.phase === 'reducing') {
      quiet = reported !== undefined && state.since - reported < limits.flapWindowMs;
      if (!quiet) {
        reported = state.since;
        options.incident('reduced-workload', current());
      }
      recover();
    } else if (state.phase === 'healthy' && before.phase === 'reducing') {
      if (!quiet) options.incident('responsive', current());
    } else if (state.phase === 'terminating') {
      if (state.failed) {
        options.incident('unresponsive', current());
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
        state.frozen ? Math.min(stopMs, options.frozenStopMs ?? 2_500) : stopMs,
      );
      // A frozen loop can't run its handler, and without one SIGTERM would end the evidence too.
      if (state.failed && !state.frozen) child.kill('SIGTERM');
    }
  };
  const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
    const terminating = state.phase === 'terminating';
    // Already on its way out, it is only marked as asked to stop: never taken back.
    apply({ type: 'shutdown', at: now(), failed: false });
    if (!terminating) child.kill(signal);
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
    measuredAt = now();
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
