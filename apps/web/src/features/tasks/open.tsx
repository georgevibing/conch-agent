import type { Task } from '@conch/protocol';
import type { ComponentProps } from 'react';
import { Link, useNavigate } from 'react-router';

/**
 * Where a task opens: its own chat once it has one, else the chat it was sent
 * from, else a new chat. Every way into a task goes through here (the cards,
 * the list under a chat, the pearl's list), so how a task opens is decided once.
 */
export function taskPath(task: Pick<Task, 'conversationId' | 'parentConversationId'>): string {
  if (task.conversationId) return `/c/${task.conversationId}`;
  if (task.parentConversationId) return `/c/${task.parentConversationId}`;
  return '/';
}

/** Open a task. */
export function useOpenTask(): (
  task: Pick<Task, 'conversationId' | 'parentConversationId'>,
) => void {
  const navigate = useNavigate();
  return (task) => void navigate(taskPath(task));
}

/** A link that opens a task, with its title (or anything) inside. */
export function TaskLink({
  task,
  ...props
}: Omit<ComponentProps<typeof Link>, 'to'> & {
  task: Pick<Task, 'conversationId' | 'parentConversationId'>;
}) {
  return <Link to={taskPath(task)} {...props} />;
}
