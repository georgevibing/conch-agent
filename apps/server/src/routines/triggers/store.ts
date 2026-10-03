import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { OnlyIf, Trigger } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, safeJoin, writeJson } from '../../lib/fs';
import { readStore, type Heal } from '../../lib/recover';

/** `routines/when/<id>.json`: what starts a When-routine (kept in backups). */
export const WhenFile = z.object({
  when: Trigger,
  onlyIf: OnlyIf.optional(),
});
export type WhenFile = z.infer<typeof WhenFile>;

const Pending = z.object({
  id: z.string(),
  at: z.number(),
  label: z.string(),
  link: z.string().optional(),
  detail: z.string(),
  /** The only-if couldn't be checked for it. */
  unchecked: z.boolean().optional(),
  chain: z.array(z.string()).optional(),
});

/**
 * `routines/when/<id>.seen.json`: the pulse's bookkeeping (derived: a
 * restored backup starts watching from now instead of replaying).
 */
export const SeenFile = z.object({
  /** When the pulse started looking for this routine. */
  since: z.number().optional(),
  /** Ids already acted on (or passed over), newest last. */
  seen: z.array(z.string()).default([]),
  /** Waiting for the next run. */
  pending: z.array(Pending).default([]),
  /** When event runs started, for the hourly guard. */
  fired: z.array(z.number()).default([]),
  /** When only-if checks ran, for their hourly guard. */
  judged: z.array(z.number()).default([]),
  /** The source's own bookkeeping (a cursor, a page's text). */
  source: z.record(z.string(), z.unknown()).default({}),
  noticed: z.number().int().nonnegative().default(0),
  woke: z.number().int().nonnegative().default(0),
  passed: z.number().int().nonnegative().default(0),
  lastNoticedAt: z.number().optional(),
  checkedAt: z.number().optional(),
  /** Failing since, and why. */
  failing: z
    .object({
      since: z.number(),
      count: z.number().int().nonnegative(),
      kind: z.enum(['needs-you', 'retry']),
      message: z.string(),
      fix: z
        .object({ label: z.string(), place: z.string(), focus: z.string().optional() })
        .optional(),
    })
    .optional(),
});
export type SeenFile = z.infer<typeof SeenFile>;
export type PendingHappening = z.infer<typeof Pending>;

const MAX_SEEN = 500;

/**
 * Where When-routines keep their trigger and the pulse its bookkeeping:
 * a folder of their own beside the routines, so a Conch that doesn't know
 * triggers never reads them as broken routines (ADR 0051, ADR 0056).
 */
export class WhenStore {
  readonly dir: string;
  #mutex = new Mutex();
  #when = new Map<string, WhenFile | null>();
  #seen = new Map<string, SeenFile>();

  constructor(
    routinesDir: string,
    private readonly heal?: Heal,
  ) {
    this.dir = join(routinesDir, 'when');
  }

  async get(id: string): Promise<WhenFile | undefined> {
    const known = this.#when.get(id);
    if (known !== undefined) return known ?? undefined;
    const read = await readStore(safeJoin(this.dir, `${id}.json`), WhenFile.optional(), {
      fallback: () => undefined,
      salvage: false,
      onRepair: () =>
        this.heal?.(
          'routines',
          'What starts one of your routines couldn’t be read, so Conch set it aside. Open the routine to choose again.',
        ),
    });
    this.#when.set(id, read.value ?? null);
    return read.value;
  }

  set(id: string, value: WhenFile): Promise<void> {
    return this.#mutex.run(async () => {
      const parsed = WhenFile.parse(value);
      await writeJson(safeJoin(this.dir, `${id}.json`), parsed);
      this.#when.set(id, parsed);
    });
  }

  remove(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      this.#when.set(id, null);
      this.#seen.delete(id);
      await rm(safeJoin(this.dir, `${id}.json`), { force: true });
      await rm(safeJoin(this.dir, `${id}.seen.json`), { force: true });
    });
  }

  /** Forget the pulse's bookkeeping (turned off, or its trigger changed). */
  reset(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      this.#seen.delete(id);
      await rm(safeJoin(this.dir, `${id}.seen.json`), { force: true });
    });
  }

  async seen(id: string): Promise<SeenFile> {
    const known = this.#seen.get(id);
    if (known) return known;
    const read = await readStore(safeJoin(this.dir, `${id}.seen.json`), SeenFile);
    this.#seen.set(id, read.value);
    return read.value;
  }

  /** Change the bookkeeping in one step (never interleaved with another). */
  updateSeen(id: string, change: (seen: SeenFile) => void): Promise<SeenFile> {
    return this.#mutex.run(async () => {
      const current = structuredClone(await this.seen(id));
      change(current);
      const next = SeenFile.parse(current);
      if (next.seen.length > MAX_SEEN) next.seen = next.seen.slice(-MAX_SEEN);
      await writeJson(safeJoin(this.dir, `${id}.seen.json`), next);
      this.#seen.set(id, next);
      return next;
    });
  }

  /** Every routine that has a trigger file. */
  async ids(): Promise<string[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    return names
      .filter((n) => n.endsWith('.json') && !n.endsWith('.seen.json') && !n.includes('.broken-'))
      .map((n) => n.slice(0, -'.json'.length));
  }
}
