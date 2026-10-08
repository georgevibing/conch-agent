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
  const started = now();
  let lastHealthy: number | undefined;
  let reducingAt: number | undefined;
  let terminating = false;
  let failed = false;
  let resource: RecoveryResource | undefined;
  let forced: NodeJS.Timeout | undefined;
  const children = child.pid
    ? gatewayChildren(child.pid, options.processGroup === true, {
        serviceMembers: options.serviceMembers,
      })
    : undefined;
  const armShutdown = () => {
    if (terminating) return false;
    terminating = true;
    children?.sample();
    forced = setTimeout(() => {
      children?.close();
      child.kill('SIGKILL');
    }, options.stopMs ?? 15_000);
    return true;
  };
  const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
    if (armShutdown()) child.kill(signal);
  };
  const message = (value: unknown) => {
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    if (value.type === 'conch.recovered') options.repaired();
    if (value.type === 'conch.stopping') armShutdown();
    if (value.type === 'conch.heartbeat' && 'resource' in value)
      resource = recoveryResource(value.resource);
    if (
      value.type !== 'conch.heartbeat' ||
      !('healthy' in value) ||
      value.healthy !== true ||
      terminating
    )
      return;
    lastHealthy = now();
    if (reducingAt !== undefined) {
      reducingAt = undefined;
      options.incident('responsive', resource);
    }
  };
  child.on('message', message);
  const timer = setInterval(() => {
    if (options.enabled === false || options.stopping() || terminating) return;
    const at = now();
    const expired =
      lastHealthy === undefined
        ? at - started >= (options.startupMs ?? 120_000)
        : at - lastHealthy >= (options.unhealthyMs ?? 30_000);
    if (!expired) return;
    if (reducingAt === undefined) {
      reducingAt = at;
      options.incident('reduced-workload', resource);
      if (child.connected) {
        try {
          child.send({ type: 'conch.recover' }, () => undefined);
        } catch {
          /* A closing IPC pipe does not stop recovery. */
        }
      }
    } else if (at - reducingAt >= (options.recoverMs ?? 20_000)) {
      failed = true;
      options.incident('unresponsive', resource);
      stop();
    }
  }, options.pollMs ?? 5_000);
  timer.unref();
  return {
    stop,
    failed: () => failed,
    close: () => {
      clearInterval(timer);
      clearTimeout(forced);
      child.off('message', message);
      children?.close();
    },
  };
}
