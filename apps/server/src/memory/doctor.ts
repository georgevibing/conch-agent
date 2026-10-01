/** Repair everything's look at memory (ADR 0032): the search index, what waits for your OK, the tidy-up. */
import type { DoctorItem } from '@conch/protocol';

import type { Doctor } from '../doctor/service';
import type { MemoryIndex } from './index';
import type { MemoryStore } from './store';
import type { MemoryTidy } from './tidy';

const GROUP = 'Your data';

export function registerLearningDoctor(
  doctor: Pick<Doctor, 'register'>,
  deps: { index: MemoryIndex; store: MemoryStore; tidy: MemoryTidy },
): void {
  doctor.register({
    id: 'memory',
    group: GROUP,
    title: 'Memory',
    async run({ repair }) {
      const items: DoctorItem[] = [];
      const status = await deps.index.status().catch(() => undefined);
      if (!status) {
        if (repair) await deps.index.rebuild().catch(() => undefined);
        items.push({
          id: 'memory:index',
          group: GROUP,
          title: 'Memory search',
          state: repair ? 'fixed' : 'warning',
          message: repair ? 'Conch built memory search again.' : 'Memory search couldn’t be read.',
        });
      } else if (status.mode === 'meaning' && status.indexed < status.total) {
        if (repair) await deps.index.sync();
        const after = repair ? await deps.index.status() : status;
        items.push({
          id: 'memory:index',
          group: GROUP,
          title: 'Memory search',
          state: after.indexed < after.total ? 'warning' : repair ? 'fixed' : 'ok',
          message:
            after.indexed < after.total
              ? `${after.total - after.indexed} memories aren’t searchable by meaning yet.`
              : 'Every memory is searchable by meaning.',
        });
      } else
        items.push({
          id: 'memory:index',
          group: GROUP,
          title: 'Memory search',
          state: 'ok',
          message:
            status.mode === 'meaning'
              ? `Searches by meaning, with ${status.model} on this computer.`
              : 'Searches by words and spellings.',
        });
      const waiting = (await deps.store.list()).filter((m) => m.pending).length;
      if (waiting)
        items.push({
          id: 'memory:pending',
          group: GROUP,
          title: 'Memories to look at',
          state: 'needs-you',
          message:
            waiting === 1
              ? 'One memory waits for your OK: it was learned in a chat that read something from outside.'
              : `${waiting} memories wait for your OK: they were learned in chats that read something from outside.`,
          action: { kind: 'open', label: 'Look at them', place: 'memory' },
        });
      const last = (await deps.tidy.status()).runs[0];
      if (last?.problem)
        items.push({
          id: 'memory:tidy',
          group: GROUP,
          title: 'Memory tidy-up',
          state: 'warning',
          message: last.problem,
          action: { kind: 'open', label: 'Open memory', place: 'memory' },
        });
      return items;
    },
  });
}
