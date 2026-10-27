/**
 * Commands a restart stopped (ADR 0094, 2026-10-27). When Conch closes, each managed command
 * still running is written down: its chat, its id and when it started, never the command, its
 * arguments, its output or a key. After the restart that chat's next turn hears which of its
 * commands were stopped, so the model checks what they left and runs them again on purpose
 * instead of finding out late. Nothing is rerun by itself. The list lives under `recovery/`,
 * which agent tools can't touch and backups leave out.
 *
 * A crash, a kill or a lost power never reaches `close()` (2026-10-27): so what's running is
 * also kept as it starts and let go as it ends (`running.json`, the same ids and times,
 * written a moment later so a busy chat doesn't write for every command). Whatever is still
 * listed when Conch starts again was cut off, and is told the same way.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Interrupted {
  chat: string;
  process: string;
  startedAt: number;
  stoppedAt: number;
}

/** A command running now: its chat, its id and when it started. */
export type Running = Omit<Interrupted, 'stoppedAt'>;

/** How long a change to what's running waits before it's written, gathering others. */
export const RUNNING_WRITE_MS = 1_000;

/** At most this many are kept; a week old, they're let go. */
const KEPT = 50;
const KEPT_MS = 7 * 24 * 60 * 60 * 1000;
const ID = /^[\w-]{1,80}$/;

/** Only what's allowed: two ids and two times. Anything else in the file is dropped. */
function allowed(raw: unknown): Interrupted | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { chat, process, startedAt, stoppedAt } = raw as Record<string, unknown>;
  if (typeof chat !== 'string' || !ID.test(chat)) return undefined;
  if (typeof process !== 'string' || !ID.test(process)) return undefined;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return undefined;
  if (typeof stoppedAt !== 'number' || !Number.isFinite(stoppedAt)) return undefined;
  return { chat, process, startedAt, stoppedAt };
}

export class InterruptedProcesses {
  readonly #file: string;
  readonly #runningFile: string;
  #items: Interrupted[];
  readonly #running = new Map<string, Running>();
  #pending: ReturnType<typeof setTimeout> | undefined;

  constructor(
    home: string,
    private readonly now: () => number = Date.now,
    private readonly delay = RUNNING_WRITE_MS,
  ) {
    this.#file = join(home, 'recovery', 'interrupted.json');
    this.#runningFile = join(home, 'recovery', 'running.json');
    this.#items = this.#read();
    // Still listed as running: the last Conch ended without closing. Told like a restart, as
    // stopped when that list was last written (or now, if that can't be read).
    const cut = this.#readRunning();
    if (cut.length) {
      const at = this.#writtenAt();
      this.#items = [...this.#items, ...cut.map((r) => ({ ...r, stoppedAt: at }))].slice(-KEPT);
      this.#write();
      this.#save(this.#runningFile, []);
    }
  }

  /** A command started (or was queued): kept until it ends, in case Conch doesn't close. */
  started(item: Running) {
    const kept = allowed({ ...item, stoppedAt: item.startedAt });
    if (!kept) return;
    this.#running.set(kept.process, {
      chat: kept.chat,
      process: kept.process,
      startedAt: kept.startedAt,
    });
    this.#later();
  }

  /** A command ended or was stopped: nothing to tell about it. */
  ended(process: string) {
    if (this.#running.delete(process)) this.#later();
  }

  /** Written as Conch closes: what was still running. */
  record(items: readonly Interrupted[]) {
    const fresh = items.map(allowed).filter((i): i is Interrupted => Boolean(i));
    for (const item of fresh) this.#running.delete(item.process);
    this.#flush();
    if (!fresh.length) return;
    this.#items = [...this.#items, ...fresh].slice(-KEPT);
    this.#write();
  }

  /** What's running is written now, not a moment later (closing, tests). */
  flush() {
    this.#flush();
  }

  #later() {
    if (this.#pending) return;
    this.#pending = setTimeout(() => this.#flush(), this.delay);
    this.#pending.unref?.();
  }

  #flush() {
    if (this.#pending) clearTimeout(this.#pending);
    this.#pending = undefined;
    this.#save(this.#runningFile, [...this.#running.values()]);
  }

  #readRunning(): Running[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#runningFile, 'utf8'));
      return (Array.isArray(parsed) ? parsed : [])
        .map((r: unknown) =>
          r && typeof r === 'object'
            ? allowed({ ...(r as Record<string, unknown>), stoppedAt: 0 })
            : undefined,
        )
        .filter((i): i is Interrupted => Boolean(i))
        .map(({ chat, process, startedAt }) => ({ chat, process, startedAt }))
        .slice(-KEPT);
    } catch {
      return [];
    }
  }

  #writtenAt(): number {
    try {
      return statSync(this.#runningFile).mtimeMs;
    } catch {
      return this.now();
    }
  }

  /** This chat's stopped commands, said once: taken off the list as they're told. */
  take(chat: string): Interrupted[] {
    const mine = this.#items.filter((i) => i.chat === chat);
    if (!mine.length) return [];
    this.#items = this.#items.filter((i) => i.chat !== chat);
    this.#write();
    return mine;
  }

  #read(): Interrupted[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#file, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : [];
      const since = this.now() - KEPT_MS;
      return list
        .map(allowed)
        .filter((i): i is Interrupted => Boolean(i) && (i as Interrupted).stoppedAt >= since)
        .slice(-KEPT);
    } catch {
      return [];
    }
  }

  #write() {
    this.#save(this.#file, this.#items);
  }

  #save(file: string, items: readonly object[]) {
    try {
      mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
      const next = `${file}.${process.pid}.tmp`;
      writeFileSync(next, JSON.stringify(items), { mode: 0o600 });
      renameSync(next, file);
    } catch {
      // A note that can't be kept is only a note: the work goes on.
    }
  }
}

/** What the model hears on the chat's next turn, in words it can act on. */
export function interruptedNote(items: readonly Interrupted[]): string | undefined {
  if (!items.length) return undefined;
  const ago = (ms: number) => {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
  };
  const listed = items
    .map((i) => `process ${i.process} (it had run ${ago(i.stoppedAt - i.startedAt)})`)
    .join(', ');
  return `Conch restarted while ${items.length === 1 ? 'a command of this chat was' : `${items.length} commands of this chat were`} still running: ${listed}. It was stopped before it finished, and nothing was run again. Check what it left (its files, its output in this chat), then start it again with process_start if it's still needed.`;
}
