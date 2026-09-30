/**
 * Which automatic backups to keep, like a phone does: the newest one of each
 * of the last seven days that have one, and before those, the newest one of
 * each of four weeks. Everything else can go.
 */

export const DAILIES = 7;
export const WEEKLIES = 4;
/** Undo copies kept, and for how long at most. */
export const UNDO_KEPT = 2;
export const UNDO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day, `2026-09-30`. */
export function dayOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local week, named by its Monday. */
export function weekOf(at: number): string {
  const d = new Date(at);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayOf(d.getTime());
}

export function retain<T extends { id: string; createdAt: number }>(
  backups: readonly T[],
  options: { dailies?: number; weeklies?: number } = {},
): Set<string> {
  const dailies = options.dailies ?? DAILIES;
  const weeklies = options.weeklies ?? WEEKLIES;
  const newest = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set<string>();

  const days = new Set<string>();
  for (const backup of newest) {
    const day = dayOf(backup.createdAt);
    if (days.has(day)) continue;
    if (days.size >= dailies) break;
    days.add(day);
    keep.add(backup.id);
  }

  // Weeklies reach back from the oldest day the dailies keep.
  const oldestDay = [...days].sort()[0];
  const weeks = new Set<string>();
  for (const backup of newest) {
    if (oldestDay !== undefined && dayOf(backup.createdAt) >= oldestDay) continue;
    const week = weekOf(backup.createdAt);
    if (weeks.has(week)) continue;
    if (weeks.size >= weeklies) break;
    weeks.add(week);
    keep.add(backup.id);
  }
  return keep;
}

/** Undo copies to keep: the newest few, none older than a month. */
export function retainUndo<T extends { id: string; createdAt: number }>(
  copies: readonly T[],
  now: number,
): Set<string> {
  return new Set(
    [...copies]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((c) => now - c.createdAt < UNDO_MAX_AGE_MS)
      .slice(0, UNDO_KEPT)
      .map((c) => c.id),
  );
}
