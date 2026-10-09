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

/**
 * Opens the one task's chat, or (several) the newest one's: where its card is.
 * Never the pearl's list alone, which shows only work still going.
 */
function open(label: string, tasks: Task[]): DoctorItem['action'] {
  const focus = chatOf(tasks[0]);
  return { kind: 'open', label, place: 'tasks', ...(focus && { focus }) };
}

export function tasksCheck(
  tasks: Pick<TaskService, 'list' | 'remove'> & Partial<Pick<TaskService, 'orphans'>>,
): DoctorCheck {
  return {
    id: 'tasks',
    group: GROUP,
    title: 'Tasks',
    async run({ repair }) {
      const items: DoctorItem[] = [];
      /** Removes their cards (receipts stay); how many went. */
      const putAway = async (list: Task[]) => {
        let cleared = 0;
        for (const task of list)
          await tasks.remove(task.id).then(
            () => cleared++,
            () => undefined,
          );
        return cleared;
      };
      // Cards whose chat was deleted have nowhere to be seen or removed: not
      // the person's to check. Repair puts them away.
      const orphans = (await tasks.orphans?.().catch(() => [])) ?? [];
      const orphaned = new Set(orphans.map((t) => t.id));
      if (orphans.length && repair) {
        const cleared = await putAway(orphans);
        if (cleared)
          items.push({
            id: 'tasks:orphaned',
            group: GROUP,
            title: 'Tasks',
            state: 'fixed',
            message:
              cleared === 1
                ? 'Put away 1 finished task from a chat you deleted.'
                : `Put away ${cleared} finished tasks from chats you deleted.`,
          });
      }
      const all = (await tasks.list()).tasks.filter((t) => !orphaned.has(t.id));
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
      // Checked on its row or card, or all at once by Repair everything: pressing
      // it is saying you've looked, so their cards go (receipts stay).
      const checked = repair && uncertain.length ? await putAway(uncertain) : 0;
      if (checked)
        items.push({
          id: 'tasks:checked',
          group: GROUP,
          title: 'Tasks to check',
          state: 'fixed',
          message: checked === 1 ? 'Marked 1 task checked.' : `Marked ${checked} tasks checked.`,
        });
      if (uncertain.length > checked)
        items.push({
          id: 'tasks:unverified',
          group: GROUP,
          title: 'Tasks to check',
          state: 'warning',
          message:
            uncertain.length === 1
              ? `“${uncertain[0]?.title}” couldn’t confirm what it did. Look, then mark it checked.`
              : `${uncertain.length} tasks couldn’t confirm what they did. Look, then mark each checked.`,
          // Only on a look: after a repair, what's left is what it couldn't put away.
          ...(!repair && { repairable: true }),
          action: open(uncertain.length === 1 ? 'Review it' : 'Review tasks', uncertain),
        });
      if (!items.some((item) => item.state !== 'fixed')) {
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
