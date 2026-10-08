/**
 * Repair everything's look at updates: what's waiting, each with its one
 * action. A new release is news (`info`), never a warning. Nothing here updates Conch itself — that restarts it, so it's
 * always a person's choice in Settings → Health.
 */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import { clearPointer, pointerBroken } from './layout';
import { HOUR } from './schedule';
import type { UpdatesService } from './service';
import { shortVersion } from './version';

const GROUP = 'Updates';

export function updatesCheck(updates: UpdatesService, home: string): DoctorCheck {
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
      // A release is news, not a problem (ADR 0051).
      if (conch.source === 'releases' && conch.latest)
        items.push({
          id: 'updates:conch',
          group: GROUP,
          title: 'Conch',
          state: 'info',
          message: `Conch ${shortVersion(conch.latest.version)} is ready.`,
          action: { kind: 'open', label: 'See what’s new', place: 'health', focus: 'updates' },
        });
      else if (conch.behind > 0) {
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
      // A release that didn't check out isn't offered: news, and nothing to do about it.
      if (conch.refused)
        items.push({
          id: 'updates:refused',
          group: GROUP,
          title: 'Conch’s releases',
          state: 'info',
          message: conch.refused,
        });
      // A pointer at a version that's gone: Conch starts from its checkout instead, and the pointer goes.
      if (pointerBroken(home)) {
        if (repair) clearPointer(home);
        items.push({
          id: 'updates:versions',
          group: GROUP,
          title: 'Conch’s versions',
          state: repair ? 'fixed' : 'warning',
          ...(!repair && { repairable: true }),
          message: repair
            ? 'Conch’s note of which version to run named one that’s gone, so Conch went back to running from its own folder.'
            : 'Conch’s note of which version to run names one that’s gone. Repair puts it right.',
        });
      }
      // The web app built from other code than is here (pulled by hand): built again.
      const web = await updates.web();
      if (web?.building)
        items.push({
          id: 'updates:web',
          group: GROUP,
          title: 'Conch’s app',
          state: 'info',
          message: 'Conch is rebuilding its app to match its code. Open pages offer to reload.',
        });
      else if (web?.freshness.state === 'stale') {
        if (repair) void updates.freshenWeb();
        items.push({
          id: 'updates:web',
          group: GROUP,
          title: 'Conch’s app',
          ...(repair
            ? {
                state: 'info' as const,
                message:
                  'Conch is rebuilding its app to match its code. Open pages offer to reload.',
              }
            : web.failed
              ? {
                  state: 'warning' as const,
                  message:
                    'Conch’s app is older than its code, and rebuilding it didn’t work. Run this in Conch’s folder.',
                  action: { kind: 'command' as const, label: 'Rebuild it', command: web.command },
                }
              : {
                  state: 'warning' as const,
                  repairable: true,
                  message:
                    'Conch’s app is older than its code, so some of what’s new isn’t showing. Repair rebuilds it.',
                }),
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
