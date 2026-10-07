import type { Task } from '@conch/protocol';
import { useCallback, type ComponentProps } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

/** The address a task's sheet opens at (`?task=`), over the chat it came from. */
export const TASK_PARAM = 'task';

/**
 * Where a task opens: its sheet over the chat it came from, so you never lose
 * your place; its own chat when it came from nowhere. Every way into a task goes
 * through here (the cards, the list under a chat, the pearl's list, toasts), so
 * how a task opens is decided once.
 */
export function taskHref(
  task: Pick<Task, 'id' | 'parentConversationId' | 'conversationId'>,
): string | undefined {
  if (task.parentConversationId)
    return `/c/${task.parentConversationId}?${TASK_PARAM}=${encodeURIComponent(task.id)}`;
  return task.conversationId ? `/c/${task.conversationId}` : undefined;
}

type Opens = Pick<Task, 'id' | 'parentConversationId' | 'conversationId'>;

/** Where a task opens, or a new chat when it has nowhere yet. */
export function taskPath(task: Opens): string {
  return taskHref(task) ?? '/';
}

/** Marks the history entry a sheet opened with, so closing it is going back. */
export interface SheetState {
  taskSheet?: true;
}

/** Open a task: its sheet, one step back in history from where you were. */
export function useOpenTask() {
  const navigate = useNavigate();
  return useCallback(
    (task: Opens) => {
      void navigate(taskPath(task), { state: { taskSheet: true } satisfies SheetState });
    },
    [navigate],
  );
}

/** The task whose sheet is open here, and how to close it or show another. */
export function useTaskSheet() {
  const location = useLocation();
  const navigate = useNavigate();
  const taskId = new URLSearchParams(location.search).get(TASK_PARAM) ?? undefined;
  const opened = (location.state as SheetState | null)?.taskSheet === true;
  const close = useCallback(() => {
    // Opened from here: back is where you were. Arrived at it (a link, a reload): stay, without it.
    if (opened) void navigate(-1);
    else {
      const search = new URLSearchParams(location.search);
      search.delete(TASK_PARAM);
      const rest = search.toString();
      void navigate(`${location.pathname}${rest ? `?${rest}` : ''}`, { replace: true });
    }
  }, [opened, navigate, location.pathname, location.search]);
  const show = useCallback(
    (id: string) => {
      const search = new URLSearchParams(location.search);
      search.set(TASK_PARAM, id);
      void navigate(`${location.pathname}?${search.toString()}`, {
        replace: true,
        state: location.state as SheetState | null,
      });
    },
    [navigate, location.pathname, location.search, location.state],
  );
  return { taskId, close, show };
}

/** A link that opens a task, with its title (or anything) inside. */
export function TaskLink({
  task,
  ...props
}: Omit<ComponentProps<typeof Link>, 'to' | 'state'> & { task: Opens }) {
  return <Link to={taskPath(task)} state={{ taskSheet: true } satisfies SheetState} {...props} />;
}
