import { taskFinishNotice, taskLink } from '@conch/protocol';
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
 * Task events from the live socket. A task you started that finishes or needs
 * you says so in the app (the notification on your phone is the server's).
 */
export function applyTaskEvent(
  client: QueryClient,
  event: Extract<ServerEvent, { type: `task.${string}` }>,
  navigate?: (to: string) => void,
) {
  // How many run at once right now (ADR 0129): the header of a batch's card says it.
  if (event.type === 'task.capacity') {
    client.setQueryData<TaskList>(taskKeys.all, (list) =>
      list
        ? { ...list, capacity: event.capacity, concurrent: Math.max(1, event.capacity.atOnce) }
        : list,
    );
    return;
  }
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
  // Already looking at it (its chat, or the one it came from): the card says so.
  const at = window.location.pathname;
  const here = (t: Task) =>
    (t.parentConversationId && at === `/c/${t.parentConversationId}`) ||
    (t.conversationId && at === `/c/${t.conversationId}`);
  if (task.status === 'needs-you') {
    if (!here(task))
      toast(`A task needs your OK`, {
        description: task.title,
        action: { label: 'See', onClick: () => navigate?.(taskLink(task)) },
      });
    return;
  }
  // The same words as the phone's notification; tasks started together, once.
  const notice = taskFinishNotice(task, client.getQueryData<TaskList>(taskKeys.all)?.tasks ?? []);
  if (!notice) return;
  const open = { label: 'Open', onClick: () => navigate?.(notice.url) };
  // Not finishing says so even while you look: the card alone is easy to miss.
  if (notice.tone === 'failed')
    toast.error(notice.title, { id: notice.tag, description: notice.body, action: open });
  else if (!notice.tasks.every(here))
    (notice.tone === 'done' ? toast.success : toast)(notice.title, {
      id: notice.tag,
      description: notice.body,
      action: open,
    });
}

/**
 * Stop or start again: the card shows `status` the moment it's pressed, and
 * goes back if the gateway says no. Half a revision ahead, so a word sent
 * before the press can't undo it, and the gateway's next one replaces it.
 */
function useTaskMutation(
  fn: (id: string) => Promise<Task>,
  status: Task['status'],
  failed: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onMutate: (id) => {
      const before = client.getQueryData<TaskList>(taskKeys.all)?.tasks.find((t) => t.id === id);
      if (before) put(client, { ...before, status, rev: before.rev + 0.5 });
      return { before };
    },
    onSuccess: (task) => put(client, task),
    onError: (error, _id, context) => {
      const before = context?.before;
      if (before)
        client.setQueryData<TaskList>(taskKeys.all, (list) =>
          list
            ? { ...list, tasks: list.tasks.map((t) => (t.id === before.id ? before : t)) }
            : list,
        );
      toast.error(error instanceof ApiError ? error.message : failed);
    },
  });
}

export const useStopTask = () => useTaskMutation(tasksApi.stop, 'stopped', 'Couldn’t stop it.');
export const useRetryTask = () =>
  useTaskMutation(tasksApi.retry, 'queued', 'Couldn’t start it again.');

/**
 * "Start now" on a task that waits only for room (ADR 0129). It stays Waiting
 * until the gateway starts it; if it can't, it says why.
 */
export function useStartNowTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: tasksApi.startNow,
    onSuccess: (task) => put(client, task),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Couldn’t start it now.'),
  });
}

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
