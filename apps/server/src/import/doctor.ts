/**
 * Repair everything's look at Come home (ADR 0035): another agent here, with
 * things to bring over, and agents an older Conch brought with the end of
 * their instructions cut off (ADR 0101). Repair brings the rest of those in
 * when it reads clean; the rest are read in Come home first.
 */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { ImportService } from './service';

export function importCheck(imports: ImportService): DoctorCheck {
  return {
    id: 'import',
    group: 'Your data',
    title: 'Come home',
    async run({ repair }) {
      const { sources } = await imports.status();
      const items = sources
        .filter((s) => !s.imported && s.summary !== 'Nothing to bring over yet')
        .map((s): DoctorItem => ({
          id: `import:${s.id}`,
          group: 'Your data',
          title: s.label,
          state: 'off',
          message: `${s.label} is on this computer, with ${s.summary}. Bring them over whenever you like.`,
          action: { kind: 'open', label: 'Take a look', place: 'memory', focus: 'come-home' },
        }));
      const brought = repair ? await imports.finishCutShort().catch(() => []) : [];
      for (const one of brought)
        items.push({
          id: `import:rest:${one.agentId}`,
          group: 'Your data',
          title: one.name,
          state: 'fixed',
          message: `Brought the rest of ${one.name}’s instructions from ${one.label}.`,
        });
      const left = await imports.rest().catch(() => []);
      for (const one of left)
        items.push({
          id: `import:rest:${one.agentId}`,
          group: 'Your data',
          title: one.name,
          state: 'warning',
          message: one.review
            ? `The end of ${one.name}’s instructions stayed in ${one.label}, and some of it reads like orders to the assistant. Read it before bringing it.`
            : `The end of ${one.name}’s instructions stayed in ${one.label}. Repair brings the rest in.`,
          ...(one.review
            ? {
                action: {
                  kind: 'open',
                  label: 'Take a look',
                  place: 'memory',
                  focus: 'come-home',
                } as const,
              }
            : { repairable: true }),
        });
      return items;
    },
  };
}
