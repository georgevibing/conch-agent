import { taskWorth } from '@conch/protocol';
import { TaskStatusMark } from '@conch/nacre';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';

import { useConversations } from '../../api/queries';
import { taskStatusWords } from './outcome';
import { LiveTaskCard } from './LiveTaskCard';
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
  if (origin?.kind !== 'task' || !task) return null;
  const fromId = task.parentConversationId;
  const from = conversations?.find((c) => c.id === fromId)?.title;
  // Sent from no chat, its card has nowhere else to be: it's here, at the top, in full.
  if (!fromId)
    return (
      <div className={styles.standalone}>
        <LiveTaskCard task={task} />
      </div>
    );
  return (
    <nav className={styles.banner} aria-label="Task">
      <Link className={styles.back} to={`/c/${fromId}`}>
        <ChevronLeft aria-hidden />
        <span className={styles.backTitle}>{from ?? 'Back to the chat'}</span>
      </Link>
      <span className={styles.state} data-status={task.status} role="status">
        <TaskStatusMark status={task.status} worth={taskWorth(task)} />
        <span>{taskStatusWords(task)}</span>
      </span>
    </nav>
  );
}
