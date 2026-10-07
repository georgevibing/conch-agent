import type { Task } from '@conch/protocol';
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** The address a task's sheet opens at (`?task=`), over the chat it came from. */
export const TASK_PARAM = 'task';

/**
 * Where a task opens: its sheet over the chat it came from, so you never lose
 * your place; its own chat when it came from nowhere.
 */
export function taskHref(
  task: Pick<Task, 'id' | 'parentConversationId' | 'conversationId'>,
): string | undefined {
  if (task.parentConversationId)
    return `/c/${task.parentConversationId}?${TASK_PARAM}=${encodeURIComponent(task.id)}`;
  return task.conversationId ? `/c/${task.conversationId}` : undefined;
}

/** Marks the history entry a sheet opened with, so closing it is going back. */
export interface SheetState {
  taskSheet?: true;
}

/** Open a task: its sheet, one step back in history from where you were. */
export function useOpenTask() {
  const navigate = useNavigate();
  return useCallback(
    (task: Pick<Task, 'id' | 'parentConversationId' | 'conversationId'>) => {
      const to = taskHref(task);
      if (to) void navigate(to, { state: { taskSheet: true } satisfies SheetState });
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
