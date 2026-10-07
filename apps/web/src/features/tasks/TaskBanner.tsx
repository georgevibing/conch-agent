import { assessTask } from '@conch/protocol';
import { TASK_STATUS_LABELS, TaskStatusMark } from '@conch/nacre';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';

import { useConversations } from '../../api/queries';
import { useTask } from './queries';
import styles from './Tasks.module.css';

/**
 * Shown at the top of a conversation a task runs in: the way back to the chat
 * it came from, and how it's going. What a task is lives in the docs.
 */
export function TaskBanner({ conversationId }: { conversationId?: string }) {
  const { data: conversations } = useConversations();
  const origin = conversations?.find((c) => c.id === conversationId)?.origin;
  const task = useTask(origin?.kind === 'task' ? origin.taskId : undefined);
  if (origin?.kind !== 'task') return null;
  const fromId = task?.parentConversationId;
  const from = conversations?.find((c) => c.id === fromId)?.title;
  const unchecked = task?.status === 'unverified' && assessTask(task).verdict === 'unchecked';
  return (
    <nav className={styles.banner} aria-label="Task">
      <Link className={styles.back} to={fromId ? `/c/${fromId}` : '/tasks'}>
        <ChevronLeft aria-hidden />
        <span className={styles.backTitle}>
          {fromId ? (from ?? 'Back to the chat') : 'All tasks'}
        </span>
      </Link>
      {task && (
        <span className={styles.state} data-status={task.status} role="status">
          <TaskStatusMark status={task.status} />
          <span>{unchecked ? 'Finished' : TASK_STATUS_LABELS[task.status]}</span>
        </span>
      )}
    </nav>
  );
}
