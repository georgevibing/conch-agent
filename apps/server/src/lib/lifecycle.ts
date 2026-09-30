import { randomUUID } from 'node:crypto';

/** Changes every time the gateway starts: the page knows a restart has finished when it does. */
export const BOOT_ID = randomUUID();

let restartHandler: (() => Promise<void>) | undefined;

/** `main.ts` says how to stop cleanly for a restart. */
export function setRestartHandler(handler: () => Promise<void>): void {
  restartHandler = handler;
}

/** Conch can start itself again: it runs under the supervisor (`pnpm start`). */
export function restartable(): boolean {
  return process.env.CONCH_SUPERVISED === '1' && restartHandler !== undefined;
}

/**
 * Start Conch again (after an update or a restore). Answers straight away and
 * restarts a moment later, so the request that asked for it gets its reply.
 */
export function restart(): boolean {
  const handler = restartHandler;
  if (!restartable() || !handler) return false;
  setTimeout(() => void handler(), 300).unref?.();
  return true;
}
