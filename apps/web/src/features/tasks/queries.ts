import type { ServerEvent, Task, TaskList } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { tasksApi } from './api';

export const taskKeys = { all: ['tasks'] as const };

export function useTasks() {
  return useQuery({ queryKey: taskKeys.all, queryFn: tasksApi.list, staleTime: 30_000 });
}

/** One task, live. */
export function useTask(id: string | undefined) {
  return useTasks().data?.tasks.find((t) => t.id === id);
}

/** Still going: waiting its turn, working, or waiting for you. */
export const going = (task: Pick<Task, 'status'>) =>
  task.status === 'queued' || task.status === 'running' || task.status === 'needs-you';

/** Keep the newest copy of a task: a reply can arrive after the live event that overtook it. */
function put(client: QueryClient, task: Task) {
  client.setQueryData<TaskList>(taskKeys.all, (list) => {
    if (!list) return list;
    const cached = list.tasks.find((t) => t.id === task.id);
    if (cached && cached.rev > task.rev) return list;
    return { ...list, tasks: [task, ...list.tasks.filter((t) => t.id !== task.id)] };
  });
}

/**
 * Task events from the live socket. A background task that finishes or needs
 * you says so in the app (the notification on your phone is the server's).
 */
export function applyTaskEvent(
  client: QueryClient,
  event: Extract<ServerEvent, { type: `task.${string}` }>,
  navigate?: (to: string) => void,
) {
  if (event.type === 'task.deleted') {
    client.setQueryData<TaskList>(taskKeys.all, (list) =>
      list ? { ...list, tasks: list.tasks.filter((t) => t.id !== event.taskId) } : list,
    );
    return;
  }
  const { task } = event;
  const before = client.getQueryData<TaskList>(taskKeys.all)?.tasks.find((t) => t.id === task.id);
  put(client, task);
  if (task.kind !== 'background' || !before || before.status === task.status) return;
  const where = task.parentConversationId ?? task.conversationId;
  const open = where ? { label: 'Open', onClick: () => navigate?.(`/c/${where}`) } : undefined;
  // Already looking at it: the card in the chat says so.
  const here = where && window.location.pathname === `/c/${where}`;
  if (task.status === 'done' && !here)
    toast.success(`Done: ${task.title}`, { description: task.summary, action: open });
  else if (task.status === 'unverified' && !here)
    toast(`Result needs checking: ${task.title}`, { description: task.error, action: open });
  else if (task.status === 'failed')
    toast.error(`Didn’t finish: ${task.title}`, { description: task.error, action: open });
  else if (task.status === 'needs-you' && task.conversationId)
    toast(`${task.title} needs your OK`, {
      action: { label: 'See', onClick: () => navigate?.(`/c/${task.conversationId}`) },
    });
}

function useTaskMutation(fn: (id: string) => Promise<Task>, failed: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (task) => put(client, task),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : failed),
  });
}

export const useStopTask = () => useTaskMutation(tasksApi.stop, 'Couldn’t stop it.');
export const useRetryTask = () => useTaskMutation(tasksApi.retry, 'Couldn’t start it again.');

export function useRemoveTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onSuccess: (_r, id) =>
      client.setQueryData<TaskList>(taskKeys.all, (list) =>
        list ? { ...list, tasks: list.tasks.filter((t) => t.id !== id) } : list,
      ),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Couldn’t remove it.'),
  });
}

/** Send something away to be done in the background, from a chat. */
export function useStartTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: tasksApi.create,
    onSuccess: (task) => put(client, task),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Couldn’t start it.'),
  });
}
