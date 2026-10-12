import type { RecoveryMessage } from './gateway';

/**
 * Where a supervised start is, as a fixed short code the supervisor can log.
 * Never a path, a command or anything a person typed.
 */
export type BootPhase =
  'starting' | 'waiting' | 'restore' | 'services' | 'app' | 'listen' | 'probe';

export interface BootBeat {
  /** The start moved on: said at once, then on every beat. */
  phase(phase: BootPhase): void;
  /** The first real heartbeat went out, or Conch is stopping: no more boot beats. */
  stop(): void;
}

export interface BootBeatOptions {
  intervalMs?: number;
}

const silent: BootBeat = { phase: () => undefined, stop: () => undefined };

/**
 * Proof of life from spawn to the first heartbeat (`GatewayRecovery.start`), so the
 * supervisor's watchdog can tell a slow start (a big restore copying the home folder)
 * from a stuck one. The beat runs on a timer, so it keeps going through long async
 * work; a start blocked synchronously goes silent, which is the point: that one is
 * stuck. Without a parent to tell (`send` absent) it does nothing.
 */
export function bootHeartbeat(
  send: ((message: RecoveryMessage) => void) | undefined,
  { intervalMs = 5_000 }: BootBeatOptions = {},
): BootBeat {
  if (!send) return silent;
  let current: BootPhase = 'starting';
  let timer: NodeJS.Timeout | undefined;
  const beat = () => {
    try {
      send({ type: 'conch.booting', phase: current });
    } catch {
      // The parent may have gone away; a start never fails for want of a listener.
    }
  };
  beat();
  timer = setInterval(beat, intervalMs);
  timer.unref();
  return {
    phase(phase) {
      if (!timer) return;
      current = phase;
      beat();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}

/** This process's own supervisor channel, if it has one and it's still open. */
export function parentChannel(): ((message: RecoveryMessage) => void) | undefined {
  if (typeof process.send !== 'function') return;
  return (message) => {
    if (process.send && process.connected) process.send(message, () => undefined);
  };
}
