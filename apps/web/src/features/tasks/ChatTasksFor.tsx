import { assessTask, type Task } from '@conch/protocol';
import { ChatTasks, ChatTasksToggle, type ChatTask } from '@conch/nacre';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { create } from 'zustand';

import { withCode } from './LiveTaskCard';
import { taskPath } from './open';
import { going, useStopTask, useTasks } from './queries';

/** Finished tasks stay under their chat this long, then only on Tasks and in the chat. */
export const RECENT_MS = 12 * 60 * 60 * 1000;
/** Rows under one chat; the rest are a press away on Tasks. */
const SHOWN = 8;

/**
 * Opened or closed by hand, per chat. Otherwise a chat's tasks open by
 * themselves once something is going, and stay open when it finishes, so
 * the result is where you were looking.
 */
const useTree = create<{
  open: Record<string, boolean>;
  set: (id: string, open: boolean) => void;
}>((set) => ({
  open: {},
  set: (id, open) => set((s) => ({ open: { ...s.open, [id]: open } })),
}));

const rank: Record<string, number> = { 'needs-you': 0, running: 1, queued: 2 };

/**
 * The tasks a chat sent off that belong under it in the list (ADR 0033): what
 * needs you first, then what's working, then what's waiting, then what
 * finished lately. Undefined when there's nothing to show: then the chat's row
 * stays a single line.
 */
export function useChatTasks(chatId: string, { open }: { open: boolean }): Task[] | undefined {
  const { data } = useTasks();
  // What counts as lately: from when the list first showed this chat (a restart of the page renews it).
  const [since] = useState(() => Date.now() - RECENT_MS);
  const mine = (data?.tasks ?? []).filter((t) => t.parentConversationId === chatId);
  if (!mine.length) return undefined;
  // Old ones stay out of the way, unless it's the chat you're in.
  const recent = mine.filter((t) => going(t) || open || (t.finishedAt ?? t.createdAt) > since);
  if (!recent.length) return undefined;
  return recent
    .sort(
      (a, b) =>
        (rank[a.status] ?? 3) - (rank[b.status] ?? 3) ||
        (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt),
    )
    .slice(0, SHOWN);
}

/**
 * A chat's tasks in the sidebar (ADR 0033): a badge on the chat's own row
 * that opens them, and the rows under it — live, each opening its own chat.
 * Nothing when the chat has none to show.
 */
export function useChatTaskTree({
  chatId,
  chatTitle,
  tasks = [],
  onNavigate,
}: {
  chatId: string;
  chatTitle: string;
  tasks?: Task[];
  onNavigate?: () => void;
}): { disclosure?: ReactNode; below?: ReactNode } {
  const stop = useStopTask();
  const listId = useId();
  const chosen = useTree((s) => s.open[chatId]);
  const setOpen = useTree((s) => s.set);
  const working = tasks.some(going);
  const open = chosen ?? working;
  useEffect(() => {
    if (working && chosen === undefined) setOpen(chatId, true);
  }, [working, chosen, chatId, setOpen]);
  if (!tasks.length) return {};
  const items: ChatTask[] = tasks.map((task) => ({
    id: task.id,
    link: (
      <NavLink to={taskPath(task)} onClick={onNavigate} end>
        {task.title}
      </NavLink>
    ),
    status: task.status,
    unchecked: task.status === 'unverified' && assessTask(task).verdict === 'unchecked',
    kind: task.kind,
    current:
      task.status === 'needs-you' && task.asking
        ? withCode(`Wants to ${lower(task.asking.summary)}`)
        : task.current && withCode(task.current),
    reason: task.error && withCode(firstLine(task.error)),
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    by: task.by,
    onStop: () => stop.mutate(task.id),
  }));
  return {
    disclosure: (
      <ChatTasksToggle
        tasks={items}
        open={open}
        onOpenChange={(next) => setOpen(chatId, next)}
        chat={chatTitle}
        aria-controls={listId}
      />
    ),
    below: <ChatTasks id={listId} tasks={items} open={open} chat={chatTitle} />,
  };
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Why it didn't finish, in the few words a row has room for: its first line. */
const firstLine = (text: string) => text.trim().split('\n')[0]?.replace(/\.$/, '') ?? '';
