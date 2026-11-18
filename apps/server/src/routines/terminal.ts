/**
 * `conch routines` in this computer's terminal (ADR 0154): list them, pause or
 * resume one, export them for another agent to recreate.
 *
 * The terminal reaches the running Conch the way launchers do (ADR 0063): a
 * file in a folder only your account can write (`here/routines`), and Conch
 * answers beside it. Nothing goes over the network, so whatever listens on
 * Conch's port while it's stopped learns nothing, and the change goes through
 * `RoutineService` like any other, so the Routines page sees it at once and
 * the running Conch never writes an older copy over it. With no Conch
 * running, the terminal changes the files itself.
 *
 * Having the terminal is having the computer, as for `conch devices`: a
 * person, or an agent they run there for them. Conch's own assistant is
 * refused these commands (`lib/protect.ts`). A routine that has never been
 * turned on stays a draft until someone turns it on from its card in Conch.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, watch as watchFolder, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { Routine, RoutineExport, type RoutinePause, type UpdateRoutineBody } from '@conch/protocol';
import { z } from 'zod';

import { writeFileAtomic } from '../lib/fs';
import { exportRoutines } from './export';

/** Where the terminal leaves its asks, and Conch its answers: only your account can write here. */
export const routineAsksDir = (home: string) => join(home, 'here', 'routines');

const ASK = /^([0-9a-f]{16,64})\.ask$/;

export const RoutineAsk = z.discriminatedUnion('op', [
  z.object({ op: z.literal('list') }),
  z.object({ op: z.literal('export'), ref: z.string().min(1).max(200).optional() }),
  z.object({
    op: z.literal('pause'),
    ref: z.string().min(1).max(200),
    reason: z.string().max(200).optional(),
  }),
  z.object({ op: z.literal('resume'), ref: z.string().min(1).max(200) }),
]);
export type RoutineAsk = z.infer<typeof RoutineAsk>;

const Choice = z.object({ id: z.string(), title: z.string(), status: z.string() });

export const RoutineAnswer = z.union([
  z.object({
    ok: z.literal(true),
    routines: z.array(Routine),
    /** Nothing needed changing (already paused, already on). */
    unchanged: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(true), export: RoutineExport }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    /** When a name fits more than one, the ones it fits. */
    choices: z.array(Choice).optional(),
  }),
]);
export type RoutineAnswer = z.infer<typeof RoutineAnswer>;

export interface TerminalRoutines {
  list(): Promise<Routine[]>;
  update(
    id: string,
    input: UpdateRoutineBody,
    meta?: { paused?: Omit<RoutinePause, 'at'> },
  ): Promise<Routine>;
}

const tidy = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** The routine `ref` names: its id, its title, or the one title holding those words. */
export function findRoutine(
  routines: readonly Routine[],
  ref: string,
): { routine: Routine } | { error: string; choices?: z.infer<typeof Choice>[] } {
  const byId = routines.find((r) => r.id === ref.trim());
  if (byId) return { routine: byId };
  const want = tidy(ref);
  const choice = (r: Routine) => ({ id: r.id, title: r.title, status: r.status });
  const exact = routines.filter((r) => tidy(r.title) === want);
  const near = exact.length ? exact : routines.filter((r) => tidy(r.title).includes(want));
  if (near.length === 1 && near[0]) return { routine: near[0] };
  if (near.length > 1)
    return {
      error: `“${ref}” fits more than one routine. Say which by its id.`,
      choices: near.map(choice),
    };
  return { error: `No routine is called “${ref}”.` };
}

/** What the terminal asked, done: the same in the running Conch and with none running. */
export async function answerAsk(
  routines: TerminalRoutines,
  ask: RoutineAsk,
  now = Date.now(),
): Promise<RoutineAnswer> {
  const all = await routines.list();
  if (ask.op === 'list') return { ok: true, routines: all };
  if (ask.op === 'export') {
    if (!ask.ref) return { ok: true, export: exportRoutines(all, now) };
    const found = findRoutine(all, ask.ref);
    if ('error' in found) return { ok: false, ...found };
    return { ok: true, export: exportRoutines([found.routine], now) };
  }
  const found = findRoutine(all, ask.ref);
  if ('error' in found) return { ok: false, ...found };
  const { routine } = found;
  try {
    if (ask.op === 'pause') {
      if (routine.status === 'completed')
        return {
          ok: false,
          error: `“${routine.title}” ran once and is finished: nothing to pause.`,
        };
      const reason = ask.reason?.replace(/\s+/g, ' ').trim();
      if (routine.status === 'paused' && (!reason || reason === routine.pausedBecause?.reason))
        return { ok: true, routines: [routine], unchanged: true };
      const paused = await routines.update(
        routine.id,
        { status: 'paused' },
        reason ? { paused: { reason, by: 'terminal' } } : {},
      );
      return { ok: true, routines: [paused] };
    }
    if (routine.status === 'active') return { ok: true, routines: [routine], unchanged: true };
    if (routine.status === 'draft')
      return {
        ok: false,
        error: `“${routine.title}” hasn’t been turned on yet. Look it over and press Turn on on its card in Conch.`,
      };
    if (routine.status === 'completed')
      return { ok: false, error: `“${routine.title}” ran once and is finished.` };
    return { ok: true, routines: [await routines.update(routine.id, { status: 'active' })] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The running Conch's side: answers each ask as it arrives (and once a second, where a change is missed). */
export class RoutineAsks {
  constructor(private readonly deps: { home: string; routines: TerminalRoutines }) {}

  /** Answer every ask waiting. */
  async answer(): Promise<number> {
    const dir = routineAsksDir(this.deps.home);
    let answered = 0;
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const id = ASK.exec(name)?.[1];
      if (!id) continue;
      const asked = join(dir, name);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(asked, 'utf8'));
      } catch {
        continue; // Being written: read next time.
      }
      await rm(asked, { force: true });
      const ask = RoutineAsk.safeParse(raw);
      const answer: RoutineAnswer = ask.success
        ? await answerAsk(this.deps.routines, ask.data)
        : { ok: false, error: 'That isn’t something conch routines asks.' };
      await writeFileAtomic(join(dir, `${id}.answer`), `${JSON.stringify(answer)}\n`, 0o600);
      answered++;
    }
    return answered;
  }

  /** Watch the folder; returns stop. Asks a crash left behind are cleared first. */
  watch(): () => void {
    const dir = routineAsksDir(this.deps.home);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(dir, 0o700);
    let busy = false;
    let again = false;
    const run = () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      void this.answer()
        .catch(() => 0)
        .finally(() => {
          busy = false;
          if (again) {
            again = false;
            run();
          }
        });
    };
    let watcher: FSWatcher | undefined;
    try {
      watcher = watchFolder(dir, run);
      watcher.on('error', () => undefined);
    } catch {
      // Polling below still answers.
    }
    const timer = setInterval(run, 1_000);
    timer.unref();
    void this.#sweep().finally(run);
    return () => {
      watcher?.close();
      clearInterval(timer);
    };
  }

  /** Answers nobody collected (a terminal closed while it waited). */
  async #sweep() {
    const dir = routineAsksDir(this.deps.home);
    for (const name of await readdir(dir).catch(() => [] as string[]))
      if (name.endsWith('.answer')) await rm(join(dir, name), { force: true });
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The terminal's side: ask the running Conch and wait for its answer.
 * Undefined when no Conch answers in time (an older one, say).
 */
export async function askRunning(
  home: string,
  ask: RoutineAsk,
  timeoutMs = 5_000,
): Promise<RoutineAnswer | undefined> {
  const dir = routineAsksDir(home);
  if (!existsSync(dir)) return undefined;
  const base = join(dir, randomBytes(12).toString('hex'));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(`${base}.ask`, `${JSON.stringify(ask)}\n`, 0o600);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (existsSync(`${base}.answer`)) {
        const parsed = RoutineAnswer.safeParse(
          JSON.parse(await readFile(`${base}.answer`, 'utf8')),
        );
        return parsed.success ? parsed.data : { ok: false, error: 'Conch’s answer didn’t read.' };
      }
      await pause(100);
    }
    return undefined;
  } finally {
    await rm(`${base}.ask`, { force: true });
    await rm(`${base}.answer`, { force: true });
  }
}
