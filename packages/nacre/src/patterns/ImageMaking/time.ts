/** `'3:2'` → 1.5. Anything unreadable is square; extremes are held to a shape a chat can show. */
export function parseAspect(aspect: string | number | undefined): number {
  let ratio = typeof aspect === 'number' ? aspect : Number.NaN;
  if (typeof aspect === 'string') {
    const [w, h] = aspect.split(/[:/x×]/).map(Number);
    if (w && h) ratio = w / h;
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(2.4, Math.max(0.42, ratio));
}

/**
 * How long is left, from how far it got and how long that took: a straight
 * line, so only worth saying once there's enough behind it. Undefined until then.
 */
export function secondsLeft(progress: number, elapsedMs: number): number | undefined {
  if (!(progress >= 0.12) || progress >= 1 || !(elapsedMs >= 2000)) return undefined;
  return Math.max(0, Math.round((elapsedMs * (1 - progress)) / progress / 1000));
}

/** `about 12s left`, `about 2 min left`, `almost done`. */
export function leftWords(seconds: number): string {
  if (seconds < 3) return 'almost done';
  if (seconds < 60) return `about ${seconds}s left`;
  return `about ${Math.round(seconds / 60)} min left`;
}
