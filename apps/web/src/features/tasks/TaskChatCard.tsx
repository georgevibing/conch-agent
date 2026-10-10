import { taskWorth, type Task } from '@conch/protocol';
import { TaskCard, TaskGroupCard, type TaskGroupItem } from '@conch/nacre';
import { useState } from 'react';

import type { TaskNote } from '../../live/reducer';
import { useLive } from '../../live/LiveProvider';
import { LiveTaskCard, useWaiting, withCode } from './LiveTaskCard';
import { useOpenTask } from './open';
import { useRemoveTask, useTasks } from './queries';
import styles from './Tasks.module.css';

/**
 * The tasks a reply started, as their card in the chat they came from (ADR
 * 0033): one on its own as its card; several as one, a line each, that
 * becomes their result once they've all finished. Live while the tasks are in
 * the list, and what the chat last heard of them once they're gone from there.
 */
export function TaskChatCard({ tasks: notes }: { tasks: TaskNote[] }) {
  const all = useTasks().data?.tasks;
  const open = useOpenTask();
  const live = notes.map((note) => all?.find((t) => t.id === note.taskId));
  if (notes.length === 1) {
    const [note] = notes;
    const [task] = live;
    if (!note) return null;
    return (
      <div className={styles.chatCard}>
        {task ? (
          <LiveTaskCard task={task} variant="compact" />
        ) : (
          <TaskCard
            variant="compact"
            title={note.title}
            status={note.state}
            summary={note.summary}
            by={note.by}
          />
        )}
      </div>
    );
  }
  return (
    <BatchCard
      notes={notes}
      live={live}
      onOpen={(id) => {
        const task = all?.find((t) => t.id === id);
        if (task) open(task);
      }}
    />
  );
}

function BatchCard({
  notes,
  live,
  onOpen,
}: {
  notes: TaskNote[];
  live: (Task | undefined)[];
  onOpen: (id: string) => void;
}) {
  const socket = useLive();
  const remove = useRemoveTask();
  const waitingOf = useWaiting();
  // How many this computer takes at once right now, while some wait for room (ADR 0129).
  const capacity = useTasks().data?.capacity?.words;
  // The answer is on its way: its buttons wait for it to land.
  const [answered, setAnswered] = useState<string>();
  const items: TaskGroupItem[] = notes.map((note, i) => {
    const task = live[i];
    if (!task)
      return { id: note.taskId, title: note.title, status: note.state, summary: note.summary };
    const asking = task.status === 'needs-you' && task.asking?.here ? task.asking : undefined;
    const conversation = task.conversationId;
    const answer = (decision: 'allow' | 'deny') => {
      if (!asking || !conversation) return;
      setAnswered(asking.permissionId);
      socket.respond(conversation, asking.permissionId, decision);
    };
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      worth: taskWorth(task),
      current:
        task.status === 'needs-you' && task.asking && !asking
          ? withCode(`Wants to ${lower(task.asking.summary)}`)
          : task.current && withCode(task.current),
      waiting: waitingOf(task),
      summary: task.summary,
      error: task.error,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      // Looked at: its line goes, and so does Health's ask to check it.
      onChecked: () => remove.mutate(task.id),
      ...(asking &&
        conversation && {
          asking: {
            summary: withCode(lower(asking.summary)),
            command: asking.command,
            why: asking.taint,
            pending: answered === asking.permissionId,
            onAllow: () => answer('allow'),
            onDeny: () => answer('deny'),
          },
        }),
    };
  });
  const known = new Set(live.flatMap((t) => (t ? [t.id] : [])));
  return (
    <TaskGroupCard
      className={styles.chatCard}
      tasks={items}
      capacity={capacity}
      // What's gone from the list has nothing left to open.
      onOpen={known.size ? (id) => known.has(id) && onOpen(id) : undefined}
    />
  );
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
