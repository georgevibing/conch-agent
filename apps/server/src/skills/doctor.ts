/** Repair everything's look at your key for signing skills (ADR 0040). */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { NEW_KEY_COMMAND, type SkillTrust } from './trust';

const GROUP = 'This computer';
const TITLE = 'Your key for signing skills';

export function signingKeyCheck(trust: SkillTrust): DoctorCheck {
  return {
    id: 'skill-signing',
    group: GROUP,
    title: TITLE,
    async run({ repair }) {
      const key = await trust.signingKey({ lock: repair });
      const item = (state: DoctorItem['state'], message: string, action?: DoctorItem['action']) => [
        {
          id: 'skill-signing:key',
          group: GROUP,
          title: TITLE,
          state,
          message,
          ...(action && { action }),
        },
      ];
      // You've never signed a skill: nothing to say.
      if (key.state === 'none') return [];
      if (key.state === 'clear')
        return item('warning', 'It’s in a file anyone who can read your files could copy.');
      if (key.state === 'locked')
        return key.migrated
          ? item('fixed', 'Locked it with this computer’s own key.')
          : item('ok', 'Locked with this computer’s own key.');
      if (key.reason === 'keychain')
        return item(
          'needs-you',
          `${key.problem} Unlock it (or sign in to this computer again), then repair.`,
        );
      return item(
        'needs-you',
        `${key.problem} Restore it from a passphrase-locked backup, or make a new one.`,
        { kind: 'command', label: 'Copy', command: NEW_KEY_COMMAND },
      );
    },
  };
}
