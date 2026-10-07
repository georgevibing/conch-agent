/** Repair everything's look at background tasks (ADR 0033). */
import { assessTask, type DoctorItem, type Task } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { TaskService } from './service';

const GROUP = 'Tasks';

/**
 * Where one task is seen to: the chat it came from, where its card is, or its
 * own chat when that's where it's answered (or it came from none).
 */
const chatOf = (task: Task | undefined) =>
  task?.status === 'needs-you' && !task.asking?.here
    ? (task.conversationId ?? task.parentConversationId)
    : (task?.parentConversationId ?? task?.conversationId);

/** Opens the one task's chat, or (several) the likeliest one's with the pearl's list. */
function open(label: string, tasks: Task[]): DoctorItem['action'] {
  const focus = tasks.length === 1 ? chatOf(tasks[0]) : undefined;
  return { kind: 'open', label, place: 'tasks', ...(focus && { focus }) };
}

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
              ? `“${stuck[0]?.title}” stopped when Conch did. Run it again from its card.`
              : `${stuck.length} tasks stopped when Conch did. Run them again from their cards.`,
          action: open(stuck.length === 1 ? 'Open it' : 'Show them', stuck),
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
          action: open(waiting.length === 1 ? 'Open it' : 'Show them', waiting),
        });
      if (uncertain.length)
        items.push({
          id: 'tasks:unverified',
          group: GROUP,
          title: 'Results need checking',
          state: 'warning',
          message: `${uncertain.length} task results are not fully verified. Confirmed changes are kept; uncertain actions are not automatically repeated.`,
          action: open('Inspect results', uncertain),
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
