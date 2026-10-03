/**
 * Repair everything (agreement 12) for When-routines (ADR 0056): each one's
 * source, in a sentence. Repair looks again at once (a sign-in renewed, a page
 * back, a folder returned); what only a person can do is one action.
 */
import { DoctorPlace, type DoctorItem, type Routine } from '@conch/protocol';

import type { DoctorCheck } from '../../doctor/service';

interface Routines {
  list(): Promise<Routine[]>;
  lookAgain(): Promise<void>;
}

const GROUP = 'Routines';

export function routinesWatchCheck(routines: Routines): DoctorCheck {
  const items = (list: Routine[], before?: Map<string, string>): DoctorItem[] => {
    const watching = list.filter((r) => r.status === 'active' && r.when);
    if (!watching.length) return [];
    const out: DoctorItem[] = [];
    for (const r of watching) {
      const w = r.watch;
      const was = before?.get(r.id);
      const base = { id: `routines-when:${r.id}`, group: GROUP, title: r.title };
      if (!w || w.state === 'watching' || w.state === 'off') {
        if (was && was !== 'watching')
          out.push({ ...base, state: 'fixed', message: `${r.scheduleText}: watching again.` });
        continue;
      }
      if (w.state === 'trouble') {
        out.push({
          ...base,
          state: 'warning',
          message: `${w.message ?? 'It hasn’t been able to look for a while.'} Conch keeps trying.`,
        });
        continue;
      }
      const place = DoctorPlace.safeParse(w.fix?.place);
      out.push({
        ...base,
        state: 'needs-you',
        message: w.message ?? 'It can’t look right now.',
        action:
          place.success && w.fix
            ? {
                kind: 'open',
                label: w.fix.label,
                place: place.data,
                ...(w.fix.focus && { focus: w.fix.focus }),
              }
            : { kind: 'open', label: 'Open the routine', place: 'routines', focus: r.id },
      });
    }
    if (!out.some((i) => i.state !== 'fixed'))
      out.unshift({
        id: 'routines-when',
        group: GROUP,
        title: 'Routines that start when something happens',
        state: 'ok',
        message:
          watching.length === 1
            ? 'Watching, and nothing’s wrong.'
            : `All ${watching.length} are watching, and nothing’s wrong.`,
      });
    return out;
  };

  return {
    id: 'routines-when',
    group: GROUP,
    title: 'Routines that start when something happens',
    async run({ repair }) {
      const list = await routines.list();
      if (!repair) return items(list);
      const before = new Map(list.map((r) => [r.id, r.watch?.state ?? 'watching']));
      await routines.lookAgain().catch(() => undefined);
      return items(await routines.list(), before);
    },
  };
}
