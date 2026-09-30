/**
 * Repair everything's look at updates: what's waiting, each with its one
 * action. Nothing here updates Conch itself — that restarts it, so it's
 * always a person's choice in Settings → Health.
 */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { HOUR } from './schedule';
import type { UpdatesService } from './service';
import { shortVersion } from './version';

const GROUP = 'Updates';

export function updatesCheck(updates: UpdatesService): DoctorCheck {
  return {
    id: 'updates',
    group: GROUP,
    title: 'Updates',
    async run({ repair }) {
      const status = await updates.status();
      // A repair looks again when the last look is old; nobody waits for it.
      if (repair && !status.checking && (!status.checkedAt || Date.now() - status.checkedAt > HOUR))
        void updates.check();
      const items: DoctorItem[] = [];
      const { conch } = status;
      if (conch.behind > 0) {
        const n = conch.improvements || conch.behind;
        items.push({
          id: 'updates:conch',
          group: GROUP,
          title: 'Conch',
          state: 'warning',
          message: `Conch has an update: ${n} ${n === 1 ? 'improvement' : 'improvements'}.`,
          action: { kind: 'open', label: 'See what’s new', place: 'health' },
        });
      }
      for (const program of status.programs) {
        if (!program.available || !program.latest) continue;
        items.push({
          id: `updates:${program.id}`,
          group: GROUP,
          title: program.name,
          state: 'warning',
          message: `${program.name} ${shortVersion(program.latest)} is out (you have ${shortVersion(program.installed)}).`,
          action: program.canUpdate
            ? { kind: 'need', label: `Update ${program.name}`, need: program.id, mode: 'update' }
            : { kind: 'open', label: 'See updates', place: 'health' },
        });
      }
      if (!items.length && status.checkedAt)
        items.push({
          id: 'updates:current',
          group: GROUP,
          title: 'Updates',
          state: 'ok',
          message: 'Conch and the programs it uses are up to date.',
        });
      return items;
    },
  };
}
