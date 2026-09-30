import { readdir, readFile, rm } from 'node:fs/promises';

import { Routine, RoutineRun } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, safeJoin, writeFileAtomic } from '../lib/fs';
import { isBrokenCopy, setAside, type Heal } from '../lib/recover';

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
 *
 * A routine file that won't read is set aside whole (`<id>.broken-<time>.json`)
 * rather than patched: a routine runs by itself, and one with a guessed
 * schedule or prompt would do something you never asked for.
 */
export class RoutineStore {
  #mutex = new Mutex();
  #routines?: Promise<Map<string, StoredRoutine>>;
  #runs = new Map<string, RoutineRun[]>();

  constructor(
    private readonly dir: string,
    private readonly heal?: Heal,
  ) {}

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
        // A line that won't read is skipped, not the whole history.
        for (const line of text.split('\n').filter(Boolean)) {
          const parsed = RoutineRun.safeParse(parseLine(line));
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

  #load(): Promise<Map<string, StoredRoutine>> {
    this.#routines ??= this.#read().catch((error: unknown) => {
      this.#routines = undefined;
      throw error;
    });
    return this.#routines;
  }

  async #read(): Promise<Map<string, StoredRoutine>> {
    const map = new Map<string, StoredRoutine>();
    let files: string[] = [];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith('.json') && !isBrokenCopy(f));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const file of files) {
      const path = safeJoin(this.dir, file);
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch {
        continue; // Gone, or held open for a moment: it's read next time.
      }
      const raw = parseLine(bytes.toString('utf8'));
      const parsed = StoredRoutine.safeParse(raw);
      if (parsed.success) {
        map.set(parsed.data.id, parsed.data);
        continue;
      }
      await this.#setAside(path, bytes, raw);
    }
    return map;
  }

  /** Keep a routine that won't read out of the way, where it can't run, and say so once. */
  async #setAside(path: string, bytes: Buffer, raw: unknown) {
    try {
      const aside = await setAside(path, { bytes });
      if (!aside.fresh) return;
      await rm(path, { force: true });
      const title =
        typeof raw === 'object' && raw !== null && 'title' in raw && typeof raw.title === 'string'
          ? raw.title.trim().slice(0, 80)
          : '';
      this.heal?.(
        'routines',
        title
          ? `The routine “${title}” couldn’t be read, so Conch set it aside instead of running it wrong.`
          : 'A routine couldn’t be read, so Conch set it aside instead of running it wrong.',
      );
    } catch {
      // Couldn't move it: it's skipped (never run) and tried again next start.
    }
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
