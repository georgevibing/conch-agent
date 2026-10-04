import type { TaskKind, TaskStatus } from '@conch/protocol';
import { TaskCard } from '@conch/nacre';

import { LiveTaskCard } from './LiveTaskCard';
import { useTask } from './queries';
import styles from './Tasks.module.css';

/**
 * A task's card in the chat it was sent from: live while the task is in the
 * list, and what the chat last heard of it once it's gone from there.
 */
export function TaskChatCard({
  taskId,
  title,
  kind,
  state,
  summary,
  by,
}: {
  taskId: string;
  title: string;
  kind: TaskKind;
  state: TaskStatus;
  summary?: string;
  by?: string;
}) {
  const task = useTask(taskId);
  return (
    <div className={styles.chatCard}>
      {task ? (
        <LiveTaskCard task={task} variant="compact" />
      ) : (
        <TaskCard
          variant="compact"
          kind={kind}
          title={title}
          status={state}
          summary={summary}
          by={by}
        />
      )}
    </div>
  );
}
