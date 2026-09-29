import { readdir, readFile, rm } from 'node:fs/promises';

import { Routine, RoutineRun } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, safeJoin, writeFileAtomic } from '../lib/fs';

/** What's on disk: the routine minus fields the server computes, plus scheduler bookkeeping. */
export const StoredRoutine = Routine.omit({
  scheduleText: true,
  nextRunAt: true,
  lastRun: true,
  runCount: true,
}).extend({
  /** The scheduled time most recently handled (run, skipped or missed). */
  lastScheduledFor: z.number().optional(),
  /** Start of interval schedules, so "every 2 hours" doesn't drift. */
  anchor: z.number().optional(),
});
export type StoredRoutine = z.infer<typeof StoredRoutine>;

const MAX_RUNS = 200;

/**
 * `~/.conch/routines/<id>.json` for each routine and `<id>.runs.jsonl` for its
 * history — plain files you can read, back up or delete.
 */
export class RoutineStore {
  #mutex = new Mutex();
  #routines?: Map<string, StoredRoutine>;
  #runs = new Map<string, RoutineRun[]>();

  constructor(private readonly dir: string) {}

  async all(): Promise<StoredRoutine[]> {
    return [...(await this.#load()).values()];
  }

  async get(id: string): Promise<StoredRoutine | undefined> {
    return (await this.#load()).get(id);
  }

  save(routine: StoredRoutine): Promise<StoredRoutine> {
    return this.#mutex.run(async () => {
      const parsed = StoredRoutine.parse(routine);
      await writeFileAtomic(
        safeJoin(this.dir, `${parsed.id}.json`),
        `${JSON.stringify(parsed, null, 2)}\n`,
      );
      (await this.#load()).set(parsed.id, parsed);
      return parsed;
    });
  }

  remove(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      (await this.#load()).delete(id);
      this.#runs.delete(id);
      await rm(safeJoin(this.dir, `${id}.json`), { force: true });
      await rm(safeJoin(this.dir, `${id}.runs.jsonl`), { force: true });
    });
  }

  /** Most recent first. */
  async runs(routineId: string): Promise<RoutineRun[]> {
    let runs = this.#runs.get(routineId);
    if (!runs) {
      runs = [];
      try {
        const text = await readFile(safeJoin(this.dir, `${routineId}.runs.jsonl`), 'utf8');
        for (const line of text.split('\n').filter(Boolean)) {
          const parsed = RoutineRun.safeParse(JSON.parse(line));
          if (parsed.success) runs.push(parsed.data);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      this.#runs.set(routineId, runs);
    }
    return [...runs].sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Insert or update a run by id. */
  saveRun(run: RoutineRun): Promise<RoutineRun> {
    return this.#mutex.run(async () => {
      const runs = (await this.runs(run.routineId)).reverse();
      const index = runs.findIndex((r) => r.id === run.id);
      if (index === -1) runs.push(run);
      else runs[index] = run;
      const kept = runs.slice(-MAX_RUNS);
      this.#runs.set(run.routineId, kept);
      await writeFileAtomic(
        safeJoin(this.dir, `${run.routineId}.runs.jsonl`),
        `${kept.map((r) => JSON.stringify(r)).join('\n')}\n`,
      );
      return run;
    });
  }

  async #load(): Promise<Map<string, StoredRoutine>> {
    if (this.#routines) return this.#routines;
    const map = new Map<string, StoredRoutine>();
    let files: string[] = [];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const file of files) {
      try {
        const parsed = StoredRoutine.safeParse(
          JSON.parse(await readFile(safeJoin(this.dir, file), 'utf8')),
        );
        if (parsed.success) map.set(parsed.data.id, parsed.data);
      } catch {
        // A hand-edited file that no longer parses is skipped, not fatal.
      }
    }
    this.#routines = map;
    return map;
  }
}
