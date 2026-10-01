/** Repair everything's look at Come home (ADR 0035): another agent here, with things to bring over. */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { ImportService } from './service';

export function importCheck(imports: ImportService): DoctorCheck {
  return {
    id: 'import',
    group: 'Your data',
    title: 'Come home',
    async run() {
      const { sources } = await imports.status();
      return sources
        .filter((s) => !s.imported && s.summary !== 'Nothing to bring over yet')
        .map((s): DoctorItem => ({
          id: `import:${s.id}`,
          group: 'Your data',
          title: s.label,
          state: 'off',
          message: `${s.label} is on this computer, with ${s.summary}. Bring them over whenever you like.`,
          action: { kind: 'open', label: 'Take a look', place: 'memory', focus: 'come-home' },
        }));
    },
  };
}
