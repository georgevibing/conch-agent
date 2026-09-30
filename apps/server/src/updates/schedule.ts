/**
 * When Conch looks for updates, and when it installs them by itself.
 *
 * Once a day, in the background, a little earlier or later each time so a
 * thousand Conches don't ask at the same moment — and never while Conch is
 * starting up. Automatic program updates wait for the night, when nothing is
 * running.
 */
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The first look after starting: never within a minute, then spread over ten. */
export function firstLook(startedAt: number, random: () => number): number {
  return startedAt + MINUTE + Math.floor(random() * 10 * MINUTE);
}

/** A day after the last look, give or take an hour. */
export function nextLook(checkedAt: number, random: () => number): number {
  return checkedAt + DAY + Math.round((random() * 2 - 1) * HOUR);
}

/** A look is due: not before the first one is allowed, nor before the next one is. */
export function lookDue(now: number, earliest: number, next: number | undefined): boolean {
  return now >= Math.max(earliest, next ?? 0);
}

/** Night time on this computer, when automatic updates may run (2 to 5 a.m.). */
export function overnight(now: number): boolean {
  const hour = new Date(now).getHours();
  return hour >= 2 && hour < 5;
}
