import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { readEvidence, type FreezeEvidence, type StackFrame } from './evidence';
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
/** A freeze's evidence is written within seconds of it; this leaves room for a slow disk. */
const EVIDENCE_NEAR_MS = 60_000;

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

const times = (count: number) => (count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`);

/** `spin (apps/server/src/x.ts:12)`: a name and a place in the release, nothing else. */
const place = ({ name, file, line }: StackFrame) =>
  name === '(anonymous)' ? `${file}:${line}` : `${name} (${file}:${line})`;

/**
 * Where the newest freeze was, from evidence that is already only function names
 * and release-relative lines. Conch's own code first: a library's inner loop
 * says less than the line of Conch that called it.
 */
function stuck(evidence: FreezeEvidence | undefined): string {
  if (!evidence) return '';
  if (evidence.where === 'outside-javascript')
    return ' It was waiting on this computer rather than running its own code.';
  const ours = Math.max(
    0,
    evidence.frames.findIndex((frame) => !frame.file.split('/').includes('node_modules')),
  );
  const [first, second] = evidence.frames.slice(ours, ours + 2);
  if (!first) return '';
  return ` It was stuck in ${place(first)}${second ? `, called from ${place(second)}` : ''}.`;
}

/**
 * The last recovery, from history that survives a gateway crash. It already
 * happened and Conch saw to it, so it's never worth a look: `ok`, and gone
 * after a week. Freezes are said apart, as news with where it was stuck, so a
 * person who sees it happen again has something useful to share.
 */
export function recoveryHistoryCheck(home: string, now: () => number = Date.now): DoctorCheck {
  return {
    id: 'recovery-history',
    group: 'This computer',
    title: 'Recent recovery',
    run: async () => {
      const at = now();
      const recent = readRecoveryState(home).incidents.filter(
        (incident) => at - incident.at <= RECENT_MS,
      );
      const items: DoctorItem[] = [];
      const freezes = recent.filter((incident) => incident.reason === 'unresponsive');
      const last = freezes.at(-1);
      if (last) {
        // Only the last freeze's own evidence (written a moment after it): an older
        // one would say where Conch was stuck some other time.
        const newest = readEvidence(home).find(
          (evidence) => Math.abs(evidence.at - last.at) <= EVIDENCE_NEAR_MS,
        );
        items.push({
          id: 'recovery-freezes',
          group: 'This computer',
          title: 'Stopped answering',
          state: 'info',
          message: `Conch stopped answering ${times(freezes.length)} in the past week and started again on its own${
            freezes.length > 1 ? `, last ${when(last.at, at)}` : ` ${when(last.at, at)}`
          }.${stuck(newest)}`,
        });
      }
      const latest = recent.at(-1);
      // A freeze that was the last thing to happen is already said above.
      if (latest && latest.reason !== 'unresponsive')
        items.push({
          id: 'recovery-history',
          group: 'This computer',
          title: 'Recent recovery',
          state: 'ok',
          message: `${words[latest.reason]} ${when(latest.at, at)}.`,
        });
      return items;
    },
  };
}
