import { Navigate } from 'react-router';

import { taskPath } from './open';
import { going, useTasks } from './queries';

/**
 * Tasks had a page of their own; now they live under the chat they came from
 * and in the pearl's list. An old link (a bookmark, a notification) goes to
 * the chat of the task most worth seeing: one waiting for you, one working,
 * or the newest, else a new chat.
 */
export function TasksMoved() {
  const { data, isPending } = useTasks();
  if (isPending) return null;
  const tasks = [...(data?.tasks ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const pick = tasks.find((t) => t.status === 'needs-you') ?? tasks.find(going) ?? tasks.at(0);
  const where = pick?.parentConversationId
    ? `/c/${pick.parentConversationId}`
    : pick && taskPath(pick);
  return <Navigate to={where ?? '/'} replace />;
}
