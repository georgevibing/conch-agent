/** Repair everything's look at tasks (ADR 0033). */
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
    title: 'Tasks',
    async run() {
      const { tasks: all } = await tasks.list();
      const stuck = all.filter((t) => t.kind === 'background' && t.status === 'interrupted');
      // Worth a look only for a concrete reason, as on their cards: an action it
      // couldn't confirm worked, or something asked for that isn't confirmed.
      const uncertain = all.filter(
        (t) =>
          ['unverified', 'done', 'failed', 'interrupted', 'stopped'].includes(t.status) &&
          (assessTask(t).verdict === 'uncertain' ||
            (assessTask(t).verdict === 'incomplete' &&
              (t.modelCompleted || !!t.expectations?.length))),
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
          action: open(stuck.length === 1 ? 'Open it' : 'Show them', stuck),
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
          action: open(waiting.length === 1 ? 'Open it' : 'Show them', waiting),
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
          action: open('Have a look', uncertain),
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
