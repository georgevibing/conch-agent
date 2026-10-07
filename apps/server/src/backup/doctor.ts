import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { BackupError } from './archive';
import type { BackupService } from './service';

const DAY = 24 * 60 * 60 * 1000;
/** A backup older than this is worth mentioning (a day off is normal). */
export const OVERDUE_MS = 2 * DAY;

const GROUP = 'Your data';
const TITLE = 'Backups';

function ago(at: number, now: number): string {
  const days = Math.floor((now - at) / DAY);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (at >= start.getTime()) return 'today';
  if (at >= start.getTime() - DAY) return 'yesterday';
  return `${Math.max(2, days)} days ago`;
}

/**
 * Repair everything's look at backups: backed up lately is fine, none for a
 * while is worth knowing (and a repair makes one), turned off is nobody's
 * problem. Never destructive: a repair only adds a backup.
 */
export function backupCheck(backups: BackupService, now = () => Date.now()): DoctorCheck {
  const item = (fields: Omit<DoctorItem, 'id' | 'group' | 'title'>): DoctorItem => ({
    id: 'backups:daily',
    group: GROUP,
    title: TITLE,
    ...fields,
  });
  const open = { kind: 'open', label: 'Open backups', place: 'health', focus: 'backups' } as const;

  return {
    id: 'backups',
    group: GROUP,
    title: TITLE,
    async run({ repair }) {
      const settings = await backups.settings();
      if (!settings.automatic)
        return [item({ state: 'off', message: 'Daily backups are off.', action: open })];
      const status = await backups.status();
      const at = now();
      const last = status.lastAutomaticAt;
      const overdue = last ? at - last > OVERDUE_MS : at - (settings.since ?? at) > OVERDUE_MS;
      if (!overdue) {
        return [
          item({
            state: 'ok',
            message: last
              ? `Backed up ${ago(last, at)}.`
              : 'The first backup is made soon, while Conch isn’t busy.',
          }),
        ];
      }
      const behind = last
        ? `No backup for ${Math.round((at - last) / DAY)} days.`
        : 'Not backed up yet.';
      if (!repair)
        return [
          item({
            state: 'warning',
            message: `${status.problem ? `${behind} ${status.problem}` : behind} Repair makes one now.`,
            action: open,
            repairable: true,
          }),
        ];
      try {
        await backups.backupNow();
        return [item({ state: 'fixed', message: 'Backed up just now.' })];
      } catch (error) {
        // One is being made already: that's the fix, under way.
        if (error instanceof BackupError && error.code === 'busy')
          return [item({ state: 'ok', message: 'Backing up now.' })];
        return [
          item({
            state: 'needs-you',
            message: `${behind} ${(error as Error).message}`,
            action: open,
          }),
        ];
      }
    },
  };
}
