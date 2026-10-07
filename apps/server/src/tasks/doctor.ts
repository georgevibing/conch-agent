/** Repair everything's look at background tasks (ADR 0033). */
import { assessTask, type DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { TaskService } from './service';

const GROUP = 'Tasks';

export function tasksCheck(tasks: TaskService): DoctorCheck {
  return {
    id: 'tasks',
    group: GROUP,
    title: 'Background tasks',
    async run() {
      const { tasks: all } = await tasks.list();
      const stuck = all.filter((t) => t.kind === 'background' && t.status === 'interrupted');
      const uncertain = all.filter(
        (t) =>
          ['unverified', 'done', 'failed', 'interrupted', 'stopped'].includes(t.status) &&
          ['uncertain', 'incomplete', 'unsupported'].includes(assessTask(t).verdict),
      );
      const waiting = all.filter((t) => t.status === 'needs-you');
      const items: DoctorItem[] = [];
      if (stuck.length)
        items.push({
          id: 'tasks:interrupted',
          group: GROUP,
          title: 'Background tasks',
          state: 'warning',
          message:
            stuck.length === 1
              ? `“${stuck[0]?.title}” stopped when Conch did. Run it again from Tasks.`
              : `${stuck.length} tasks stopped when Conch did. Run them again from Tasks.`,
          action: { kind: 'open', label: 'Open Tasks', place: 'tasks' },
        });
      if (waiting.length)
        items.push({
          id: 'tasks:waiting',
          group: GROUP,
          title: 'Background tasks',
          state: 'needs-you',
          message:
            waiting.length === 1
              ? `“${waiting[0]?.title}” is waiting for your OK.`
              : `${waiting.length} tasks are waiting for your OK.`,
          action: { kind: 'open', label: 'Open Tasks', place: 'tasks' },
        });
      if (uncertain.length)
        items.push({
          id: 'tasks:unverified',
          group: GROUP,
          title: 'Results need checking',
          state: 'warning',
          message: `${uncertain.length} task results are not fully verified. Confirmed changes are kept; uncertain actions are not automatically repeated.`,
          action: { kind: 'open', label: 'Inspect results', place: 'tasks' },
        });
      if (!items.length)
        items.push({
          id: 'tasks',
          group: GROUP,
          title: 'Background tasks',
          state: 'ok',
          message: all.some((t) => t.status === 'running' || t.status === 'queued')
            ? 'Working away in the background.'
            : 'Nothing running in the background.',
        });
      return items;
    },
  };
}
