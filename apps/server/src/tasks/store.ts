/**
 * The tasks list (ADR 0033): `~/.conch/tasks.json`. Each task's work lives in
 * its own conversation, which is backed up with your chats; this list is only
 * where they stand, so it isn't backed up (a restore has no running tasks).
 */
import { join } from 'node:path';

import { Task } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

const TasksFile = z.object({ tasks: z.array(Task).default([]) });

/** Finished tasks kept in the list; older ones fall off (their chats stay). */
const KEPT_FINISHED = 100;

export const TASKS_FILE = 'tasks.json';

export class TaskStore {
  readonly #path: string;
  readonly #mutex = new Mutex();
  #tasks?: Promise<Task[]>;

  constructor(
    home: string,
    private readonly heal?: Heal,
  ) {
    this.#path = join(home, TASKS_FILE);
  }

  list(): Promise<Task[]> {
    this.#tasks ??= readStore(this.#path, TasksFile, {
      onRepair: () =>
        this.heal?.(
          'conversations',
          'The tasks list was damaged, so Conch started it again. Each task’s chat is still there.',
        ),
    }).then((read) => read.value.tasks);
    return this.#tasks;
  }

  async get(id: string): Promise<Task | undefined> {
    return (await this.list()).find((t) => t.id === id);
  }

  /** Change one task (or add it), and keep the list to a sensible size. */
  save(task: Task): Promise<Task> {
    return this.#mutex.run(async () => {
      const tasks = [...(await this.list())];
      const at = tasks.findIndex((t) => t.id === task.id);
      if (at >= 0) tasks[at] = task;
      else tasks.push(task);
      const finished = tasks.filter((t) => t.finishedAt !== undefined);
      const drop = new Set(
        finished
          .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
          .slice(KEPT_FINISHED)
          .map((t) => t.id),
      );
      const kept = tasks.filter((t) => !drop.has(t.id));
      await writeJson(this.#path, { tasks: kept });
      this.#tasks = Promise.resolve(kept);
      return task;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const tasks = await this.list();
      const kept = tasks.filter((t) => t.id !== id);
      if (kept.length === tasks.length) return false;
      await writeJson(this.#path, { tasks: kept });
      this.#tasks = Promise.resolve(kept);
      return true;
    });
  }
}
