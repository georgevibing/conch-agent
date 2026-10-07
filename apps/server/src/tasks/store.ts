/**
 * The tasks list (ADR 0033): `~/.conch/tasks.json`. Each task's work lives in
 * its own conversation. The ledger is backed up with chats: losing it would
 * lose the evidence needed to prevent repeated external effects.
 */
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { assessTask, Task } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, readJson, syncFile, writeJson } from '../lib/fs';
import { type Heal } from '../lib/recover';

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
    this.#tasks ??= readJson<unknown>(this.#path).then((raw) => {
      const parsed = TasksFile.safeParse(raw ?? {});
      if (!parsed.success) {
        this.heal?.(
          'conversations',
          'Paused task actions so none repeat. The task ledger needs recovery.',
        );
        throw new Error(
          'The task ledger is damaged. Restore a known-good backup before starting background actions; Conch will not discard operation receipts.',
        );
      }
      return parsed.data.tasks.map((task) =>
        task.status === 'done' &&
        task.verification !== 'verified' &&
        assessTask(task).verdict !== 'delivered'
          ? {
              ...task,
              status: 'unverified' as const,
              verification: 'unverified' as const,
              error:
                'This older task finished before result verification was available. Its summary is not proof of completion.',
            }
          : task,
      );
    });
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
      const finished = tasks.filter(
        (t) => t.finishedAt !== undefined && !t.operations?.length && !t.requestKey,
      );
      const drop = new Set(
        finished
          .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
          .slice(KEPT_FINISHED)
          .map((t) => t.id),
      );
      const kept = tasks.filter((t) => !drop.has(t.id));
      await this.#write(kept);
      this.#tasks = Promise.resolve(kept);
      return task;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const tasks = await this.list();
      const kept = tasks.filter((t) => t.id !== id);
      if (kept.length === tasks.length) return false;
      await this.#write(kept);
      this.#tasks = Promise.resolve(kept);
      return true;
    });
  }
  async #write(tasks: Task[]): Promise<void> {
    await writeJson(this.#path, { tasks });
    // Receipt/intention must reach stable storage before external effects proceed.
    await syncFile(this.#path);
    if (process.platform !== 'win32') {
      const directory = await open(dirname(this.#path), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }
}

/** Backup rollback cannot roll back external effects or forget newer receipts. */
export function mergeTaskLedgers(current: Buffer | undefined, restored: Buffer): Buffer {
  const read = (value: Buffer | undefined) =>
    TasksFile.parse(value ? JSON.parse(value.toString('utf8')) : {}).tasks;
  const local = read(current);
  const combined = new Map(local.map((task) => [task.id, task]));
  for (const older of read(restored)) {
    const here = combined.get(older.id);
    const newest = here && here.rev >= older.rev ? here : older;
    const operations = new Map((older.operations ?? []).map((op) => [op.id, op]));
    for (const op of here?.operations ?? []) operations.set(op.id, op);
    combined.set(older.id, {
      ...newest,
      restored: true,
      status: newest.archivedAt ? newest.status : 'interrupted',
      verification: 'unverified',
      modelCompleted: false,
      delivery: undefined,
      error:
        'Restored from a historical backup. Existing results must be checked before this task can continue.',
      operations: [...operations.values()].map((op) => ({ ...op, state: 'unresolved' as const })),
      rev: Math.max(here?.rev ?? 0, older.rev) + 1,
    });
  }
  return Buffer.from(JSON.stringify({ tasks: [...combined.values()] }));
}
