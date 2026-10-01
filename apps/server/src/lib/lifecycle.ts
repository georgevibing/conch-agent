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

let stopHandler: ((farewell?: string) => Promise<void>) | undefined;

/** `main.ts` says how to stop for good (Quit Conch, or handing over to the background). */
export function setStopHandler(handler: (farewell?: string) => Promise<void>): void {
  stopHandler = handler;
}

/**
 * Stop Conch (quit, or a handover to the Conch the computer started).
 * Answers straight away and stops a moment later, so the request that asked
 * gets its reply. `farewell` is said in the Terminal window, if there is one.
 */
export function stopSoon(farewell?: string): boolean {
  const handler = stopHandler;
  if (!handler) return false;
  setTimeout(() => void handler(farewell), 600).unref?.();
  return true;
}
