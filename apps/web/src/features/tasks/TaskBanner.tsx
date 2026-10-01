import { ListChecks } from 'lucide-react';
import { Link } from 'react-router';

import { useConversations } from '../../api/queries';
import { useTask } from './queries';
import styles from './Tasks.module.css';

/** Shown at the top of a conversation a task runs in. */
export function TaskBanner({ conversationId }: { conversationId?: string }) {
  const { data: conversations } = useConversations();
  const origin = conversations?.find((c) => c.id === conversationId)?.origin;
  const task = useTask(origin?.kind === 'task' ? origin.taskId : undefined);
  if (origin?.kind !== 'task') return null;
  const from = task?.parentConversationId;
  return (
    <div className={styles.banner} role="note">
      <ListChecks size={14} aria-hidden />
      <span>
        {task?.kind === 'helper'
          ? 'A helper working on part of a bigger job.'
          : 'Working in the background.'}{' '}
        {task?.status === 'needs-you'
          ? 'It’s waiting for your OK below.'
          : 'You can watch, answer what it asks, or stop it.'}
      </span>
      {from ? <Link to={`/c/${from}`}>Back to the chat</Link> : <Link to="/tasks">All tasks</Link>}
    </div>
  );
}
