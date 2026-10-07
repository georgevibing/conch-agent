import { taskWorth, type Task } from '@conch/protocol';
import { ChatTasks, ChatTasksToggle, type ChatTask } from '@conch/nacre';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { create } from 'zustand';

import { withCode } from './LiveTaskCard';
import { TASK_PARAM, taskPath, type SheetState } from './open';
import { going, useStopTask, useTasks } from './queries';
import { isTaskFresh, useKnownConversations } from './seen';

/** Finished tasks you've seen stay under their chat (folded, "Earlier") this long. */
const RECENT_MS = 12 * 60 * 60 * 1000;
/** Rows under one chat; the rest are a press away in the chat itself. */
const SHOWN = 8;

/**
 * Opened or closed by hand, per chat. Otherwise a chat's tasks open by
 * themselves while something is going or new, so the result is where you
 * were looking. And the rows you had in front of you in a chat, kept there
 * until you leave it (adding to them as more arrive).
 */
const useTree = create<{
  open: Record<string, boolean | undefined>;
  set: (id: string, open: boolean | undefined) => void;
  kept: Record<string, string[] | undefined>;
  keep: (id: string, rows: string[] | undefined) => void;
}>((set) => ({
  open: {},
  set: (id, open) => set((s) => ({ open: { ...s.open, [id]: open } })),
  kept: {},
  keep: (id, rows) =>
    set((s) => {
      const before = s.kept[id];
      const next = rows && [...new Set([...(before ?? []), ...rows])];
      if (next?.length === before?.length) return s;
      return { kept: { ...s.kept, [id]: next } };
    }),
}));

const rank: Record<string, number> = { 'needs-you': 0, running: 1, queued: 2 };
const newest = (a: Task, b: Task) =>
  (rank[a.status] ?? 3) - (rank[b.status] ?? 3) ||
  (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt);

/** A chat's tasks for the list: what matters now, and what's folded away. */
export interface ChatTaskSet {
  /** Going, finished and new to you, or in front of you this visit. */
  now: Task[];
  /** Finished and seen: under "Earlier". */
  earlier: Task[];
  /** Which of `now` are new to you. */
  fresh: Set<string>;
  /** You're in the chat, or in one of its tasks. */
  here: boolean;
}

/**
 * The tasks a chat sent off that belong under it in the list (ADR 0033),
 * tidied: what needs you first, then what's working, waiting, and what
 * finished while you were elsewhere. What's finished and seen folds away
 * under "Earlier"; once nothing is going or new, the chat's row is a single
 * line again. While you're in the chat (or one of its tasks) nothing leaves
 * from under you: the rows you had stay until you go. Undefined when there's
 * nothing under it at all.
 */
export function useChatTasks(
  chatId: string,
  { open, current }: { open: boolean; current?: string },
): ChatTaskSet | undefined {
  const { data } = useTasks();
  const conversations = useKnownConversations();
  // What counts as lately: from when the list first showed this chat (a restart of the page renews it).
  const [since] = useState(() => Date.now() - RECENT_MS);
  // The rows in front of you this visit: kept until you leave.
  const kept = useTree((s) => s.kept[chatId]);
  const keep = useTree((s) => s.keep);
  const mine = (data?.tasks ?? []).filter((t) => t.parentConversationId === chatId);
  const here = open || (Boolean(current) && mine.some((t) => t.conversationId === current));
  const fresh = new Set(mine.filter((t) => isTaskFresh(t, conversations)).map((t) => t.id));
  const recent = mine.filter((t) => here || going(t) || (t.finishedAt ?? t.createdAt) > since);
  const matters = (t: Task) =>
    going(t) || fresh.has(t.id) || (here && Boolean(kept?.includes(t.id)));
  let now = recent.filter(matters).sort(newest).slice(0, SHOWN);
  let earlier = recent.filter((t) => !matters(t)).sort(newest);
  // In the chat with nothing going or new: its tasks are rows, not folded.
  if (here && !now.length) [now, earlier] = [earlier.slice(0, SHOWN), []];
  else earlier = earlier.slice(0, Math.max(0, SHOWN - now.length));

  const showing = here ? now.map((t) => t.id).join(' ') : '';
  useEffect(() => {
    keep(chatId, showing ? showing.split(' ') : undefined);
  }, [chatId, showing, keep]);
  if (!now.length && !earlier.length) return undefined;
  return { now, earlier, fresh, here };
}

/**
 * A chat's tasks in the sidebar (ADR 0033): a badge on the chat's own row
 * that opens them, and the rows under it — live, each opening its own chat.
 * With nothing going or new and the chat not in front of you, there's no
 * badge, and the rows fold shut: they're in the chat, on its cards.
 */
export function useChatTaskTree({
  chatId,
  chatTitle,
  tasks,
  onNavigate,
}: {
  chatId: string;
  chatTitle: string;
  tasks?: ChatTaskSet;
  onNavigate?: () => void;
}): { disclosure?: ReactNode; below?: ReactNode } {
  const stop = useStopTask();
  const listId = useId();
  const location = useLocation();
  const sheet = new URLSearchParams(location.search).get(TASK_PARAM);
  const chosen = useTree((s) => s.open[chatId]);
  const setOpen = useTree((s) => s.set);
  const now = tasks?.now ?? [];
  const lively = now.some((t) => going(t) || tasks?.fresh.has(t.id));
  const quiet = !tasks?.here && !lively;
  // Opened by itself, it stays open when what was going finishes: the result is
  // where you were looking. Gone quiet away from it, it's tidied, and the next
  // time opens by itself again.
  const was = useRef(quiet);
  useEffect(() => {
    if (lively && chosen === undefined) setOpen(chatId, true);
    if (quiet && !was.current && chosen !== undefined) setOpen(chatId, undefined);
    was.current = quiet;
  }, [lively, quiet, chosen, chatId, setOpen]);
  if (!tasks) return {};
  const open = !quiet && (chosen ?? lively);
  const row = (task: Task): ChatTask => ({
    id: task.id,
    link: (
      <Link
        to={taskPath(task)}
        state={{ taskSheet: true } satisfies SheetState}
        onClick={onNavigate}
        // Open over its chat, or as its own chat ("Continue in full").
        aria-current={
          sheet === task.id || location.pathname === `/c/${task.conversationId}`
            ? 'page'
            : undefined
        }
      >
        {task.title}
      </Link>
    ),
    status: task.status,
    worth: taskWorth(task),
    current:
      task.status === 'needs-you' && task.asking
        ? withCode(`Wants to ${lower(task.asking.summary)}`)
        : task.current && withCode(task.current),
    reason: task.error && withCode(firstLine(task.error)),
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    by: task.by,
    fresh: tasks.fresh.has(task.id),
    onStop: () => stop.mutate(task.id),
  });
  const items = quiet ? [] : now.map(row);
  return {
    disclosure: quiet ? undefined : (
      <ChatTasksToggle
        tasks={items}
        open={open}
        onOpenChange={(next) => setOpen(chatId, next)}
        chat={chatTitle}
        aria-controls={listId}
      />
    ),
    below: (
      <ChatTasks
        id={listId}
        tasks={items}
        earlier={quiet ? [] : tasks.earlier.map(row)}
        open={open}
        chat={chatTitle}
      />
    ),
  };
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Why it didn't finish, in the few words a row has room for: its first line. */
const firstLine = (text: string) => text.trim().split('\n')[0]?.replace(/\.$/, '') ?? '';
