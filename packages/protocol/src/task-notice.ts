/**
 * What to tell someone about their tasks (ADR 0027, ADR 0033), in one place:
 * a phone's notification and the app's own toast say the same thing.
 *
 * - A task you sent away says so when it's over: Done, or Didn't finish.
 *   A helper's result goes back to its chat, whose answer says it instead.
 * - Tasks started together are told about together, once the last of them
 *   is over: "3 tasks done · 1 didn't finish", never four in a row.
 * - A tap opens the chat they came from, at the task (`?task=`).
 */
import { taskWorth } from './task-assessment';
import type { Task } from './tasks';

export interface TaskNotice {
  /** "Done: Fix the login page", "3 tasks done · 1 didn't finish". */
  title: string;
  body?: string;
  /** Said with previews off. */
  quiet: string;
  /** Where a tap opens Conch. */
  url: string;
  /** One per task, or per batch: a later notice replaces it. */
  tag: string;
  tone: 'done' | 'look' | 'failed';
  /** Who it's about, newest first. */
  tasks: Task[];
}

/** Tasks started together (one message, one batch): its batch, else its group. */
export function batchOf(task: Task): string | undefined {
  const id = (task as Task & { batchId?: unknown }).batchId ?? task.group;
  return typeof id === 'string' && id ? id : undefined;
}

/** Still at it: working, waiting its turn, or waiting for you. */
const going = (task: Task) =>
  task.status === 'queued' || task.status === 'running' || task.status === 'needs-you';

/** Over in a way worth saying: you stopping it says nothing new. */
const told = (task: Task) =>
  task.status === 'done' || task.status === 'unverified' || task.status === 'failed';

/** A task's own place: the chat it came from, open at it. */
export function taskLink(task: Task): string {
  if (task.parentConversationId)
    return `/c/${task.parentConversationId}?task=${encodeURIComponent(task.id)}`;
  return task.conversationId ? `/c/${task.conversationId}` : '/';
}

const MAX = 180;
const clip = (text: string, max = MAX) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** The first thing a result says, without its markdown. */
function headline(text: string | undefined): string | undefined {
  const line = text
    ?.split('\n')
    .map((l) =>
      l
        .replace(/^\s*(#+|[-*+]|\d+[.)])\s+/, '')
        .replace(/[*_`]+/g, '')
        .trim(),
    )
    .find(Boolean);
  return line ? clip(line) : undefined;
}

/** Done, but there's a concrete reason to look: something it did can't be confirmed. */
function worthALook(task: Task): boolean {
  return taskWorth(task) !== undefined;
}

function one(task: Task): TaskNotice {
  const title = clip(task.title, 60);
  if (task.status === 'failed')
    return {
      title: `Didn’t finish: ${title}`,
      body: headline(task.error) ?? 'Something went wrong.',
      quiet: 'A task didn’t finish.',
      url: taskLink(task),
      tag: `task-${task.id}`,
      tone: 'failed',
      tasks: [task],
    };
  const worth = taskWorth(task);
  const look = worth !== undefined;
  return {
    title: look ? `Done, worth a look: ${title}` : `Done: ${title}`,
    body: worth ?? headline(task.summary) ?? 'It’s ready.',
    quiet: 'A task finished.',
    url: taskLink(task),
    tag: `task-${task.id}`,
    tone: look ? 'look' : 'done',
    tasks: [task],
  };
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What to say now that `task` changed, given every task there is (its batch
 * among them). Nothing when there's nothing to say yet: it isn't over, it
 * was a helper, it was stopped, or others started with it are still going.
 */
export function taskFinishNotice(task: Task, all: readonly Task[]): TaskNotice | undefined {
  if (task.kind !== 'background' || !told(task)) return undefined;
  const batch = batchOf(task);
  if (!batch) return one(task);
  const siblings = [
    task,
    ...all.filter((t) => t.id !== task.id && t.kind === 'background' && batchOf(t) === batch),
  ];
  if (siblings.some(going)) return undefined;
  const over = siblings.filter(told).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  if (over.length === 1) return one(task);
  const failed = over.filter((t) => t.status === 'failed');
  const [lone] = failed.length === 1 ? failed : [];
  const done = over.length - failed.length;
  const title = !failed.length
    ? `${count(done, 'task')} done`
    : !done
      ? `${count(failed.length, 'task')} didn’t finish`
      : `${count(done, 'task')} done · ${failed.length} didn’t finish`;
  // What went wrong first: that's what needs you.
  const body = [
    failed.length && `Didn’t finish: ${failed.map((t) => t.title).join(', ')}.`,
    done &&
      `Done: ${over
        .filter((t) => t.status !== 'failed')
        .map((t) => t.title)
        .join(', ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
  const parent = task.parentConversationId;
  return {
    title,
    body: clip(body),
    quiet: failed.length ? 'Your tasks are over; some didn’t finish.' : 'Your tasks are done.',
    // The one that didn't finish, if there's just one; else the chat they came from.
    url: lone ? taskLink(lone) : parent ? `/c/${parent}` : taskLink(task),
    tag: `tasks-${batch}`,
    tone: failed.length ? 'failed' : over.some(worthALook) ? 'look' : 'done',
    tasks: over,
  };
}
