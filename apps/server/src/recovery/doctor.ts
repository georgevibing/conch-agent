import type { DoctorCheck } from '../doctor/service';
import { readRecoveryState, type RecoveryReason } from './supervisor-state';

/** What happened, said as history: it's over, and "Staying responsive" says how things are now. */
const words: Record<RecoveryReason, string> = {
  crash: 'Conch stopped unexpectedly and started again by itself',
  unresponsive: 'Conch stopped responding, so its supervisor restarted it',
  'reduced-workload': 'Conch took on less work for a while to check its connection',
  responsive: 'Conch started responding again after taking on less work',
  'recovery-mode': 'Conch paused background work for a while after repeated trouble',
  repaired: 'Conch passed its repair check and let waiting work carry on',
  'restart-request': 'Conch restarted when asked',
  'history-damaged':
    'Conch couldn’t read its recovery history, so it paused background work to stay safe',
};

const DAY = 24 * 60 * 60 * 1000;
/** Past this, a recovery is old news and isn't mentioned. */
export const RECENT_MS = 7 * DAY;

/** "at 9:05 PM", "yesterday at 9:05 PM", "on October 5": like the rest of Health, never a timestamp. */
export function when(at: number, now: number): string {
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(at)
    // ICU puts a narrow space before PM; a plain one reads the same everywhere.
    .replace(/\s/gu, ' ');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (at >= today.getTime()) return `at ${time}`;
  if (at >= today.getTime() - DAY) return `yesterday at ${time}`;
  return `on ${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(at)}`;
}

/**
 * The last recovery, from history that survives a gateway crash. It already
 * happened and Conch saw to it, so it's never worth a look: `ok`, and gone
 * after a week.
 */
export function recoveryHistoryCheck(home: string, now: () => number = Date.now): DoctorCheck {
  return {
    id: 'recovery-history',
    group: 'This computer',
    title: 'Recent recovery',
    run: async () => {
      const latest = readRecoveryState(home).incidents.at(-1);
      const at = now();
      if (!latest || at - latest.at > RECENT_MS) return [];
      return [
        {
          id: 'recovery-history',
          group: 'This computer',
          title: 'Recent recovery',
          state: 'ok',
          message: `${words[latest.reason]} ${when(latest.at, at)}.`,
        },
      ];
    },
  };
}
