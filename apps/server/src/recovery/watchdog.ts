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
  stopMs?: number;
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
}
export type WatchEvent =
  | { type: 'tick'; at: number }
  | { type: 'healthy'; at: number }
  | { type: 'shutdown'; at: number; failed: boolean };
export interface WatchLimits {
  startupMs: number;
  unhealthyMs: number;
  recoverMs: number;
}

/** The watchdog's only transition function: pure, so every verdict is testable. */
export function watchTransition(
  state: WatchState,
  event: WatchEvent,
  limits: WatchLimits,
): WatchState {
  if (state.phase === 'terminating') return state;
  if (event.type === 'shutdown')
    return { phase: 'terminating', since: event.at, failed: event.failed };
  if (event.type === 'healthy') return { phase: 'healthy', since: event.at, failed: false };
  const elapsed = event.at - state.since;
  if (
    (state.phase === 'booting' && elapsed >= limits.startupMs) ||
    (state.phase === 'healthy' && elapsed >= limits.unhealthyMs)
  )
    return { phase: 'reducing', since: event.at, failed: false };
  if (state.phase === 'reducing' && elapsed >= limits.recoverMs)
    return { phase: 'terminating', since: event.at, failed: true };
  return state;
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
  };
  let state: WatchState = { phase: 'booting', since: now(), failed: false };
  let resource: RecoveryResource | undefined;
  let forced: NodeJS.Timeout | undefined;
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
      options.incident('reduced-workload', resource);
      recover();
    } else if (state.phase === 'healthy' && before.phase === 'reducing')
      options.incident('responsive', resource);
    else if (state.phase === 'terminating') {
      if (state.failed) options.incident('unresponsive', resource);
      children?.sample();
      forced = setTimeout(() => {
        children?.close();
        child.kill('SIGKILL');
      }, options.stopMs ?? 15_000);
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
  }, options.pollMs ?? 5_000);
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
