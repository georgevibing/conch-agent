/** Repair everything's look at tasks (ADR 0033). */
import { assessTask, type DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { TaskService } from './service';

const GROUP = 'Tasks';

export function tasksCheck(tasks: TaskService): DoctorCheck {
  return {
    id: 'tasks',
    group: GROUP,
    title: 'Tasks',
    async run() {
      const { tasks: all } = await tasks.list();
      const stuck = all.filter((t) => t.kind === 'background' && t.status === 'interrupted');
      // Worth a look only for a concrete reason, as on their cards: an action it
      // couldn't confirm worked, or something asked for that isn't confirmed.
      const uncertain = all.filter(
        (t) =>
          ['unverified', 'done', 'failed', 'interrupted', 'stopped'].includes(t.status) &&
          ['uncertain', 'incomplete'].includes(assessTask(t).verdict),
      );
      const waiting = all.filter((t) => t.status === 'needs-you');
      const items: DoctorItem[] = [];
      if (stuck.length)
        items.push({
          id: 'tasks:interrupted',
          group: GROUP,
          title: 'Tasks',
          state: 'warning',
          message:
            stuck.length === 1
              ? `“${stuck[0]?.title}” didn’t finish: Conch stopped while it was working. Resume it to carry on.`
              : `${stuck.length} tasks didn’t finish: Conch stopped while they were working. Resume them to carry on.`,
          action: { kind: 'open', label: 'Open Tasks', place: 'tasks' },
        });
      if (waiting.length)
        items.push({
          id: 'tasks:waiting',
          group: GROUP,
          title: 'Tasks',
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
          title: 'Worth a look',
          state: 'warning',
          message:
            uncertain.length === 1
              ? `“${uncertain[0]?.title}” couldn’t confirm everything it did. What it confirmed is kept; Conch won’t repeat the rest by itself.`
              : `${uncertain.length} tasks couldn’t confirm everything they did. What they confirmed is kept; Conch won’t repeat the rest by itself.`,
          action: { kind: 'open', label: 'Have a look', place: 'tasks' },
        });
      if (!items.length) {
        const working = all.filter((t) => t.status === 'running' || t.status === 'queued').length;
        items.push({
          id: 'tasks',
          group: GROUP,
          title: 'Tasks',
          state: 'ok',
          message: working
            ? `Working on ${working} ${working === 1 ? 'task' : 'tasks'}.`
            : 'No tasks running.',
        });
      }
      return items;
    },
  };
}
