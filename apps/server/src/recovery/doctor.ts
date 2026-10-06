import type { DoctorCheck } from '../doctor/service';
import { readRecoveryState, type RecoveryReason } from './supervisor-state';

const words: Record<RecoveryReason, string> = {
  crash: 'Conch stopped unexpectedly and started again.',
  unresponsive: 'Conch stopped responding, so its supervisor restarted it.',
  'reduced-workload': 'Conch asked for less work while checking its connection.',
  responsive: 'Conch started responding again after reducing its work.',
  'recovery-mode': 'Conch paused background work after repeated trouble.',
  repaired: 'Conch passed its repair check and allowed waiting work to continue.',
  'restart-request': 'Conch was asked to restart.',
  'history-damaged':
    'Conch could not read its recovery history, so it paused background work to stay safe.',
};

/** History survives a gateway crash and appears through the existing Health UI. */
export function recoveryHistoryCheck(home: string): DoctorCheck {
  return {
    id: 'recovery-history',
    group: 'This computer',
    title: 'Recent recovery',
    run: async () => {
      const latest = readRecoveryState(home).incidents.at(-1);
      if (!latest) return [];
      return [
        {
          id: 'recovery-history',
          group: 'This computer',
          title: 'Recent recovery',
          state: 'info',
          message: `${words[latest.reason]} (${new Date(latest.at).toISOString()})`,
        },
      ];
    },
  };
}
