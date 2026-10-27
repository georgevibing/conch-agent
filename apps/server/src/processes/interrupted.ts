/**
 * Commands a restart stopped (ADR 0094, 2026-10-27). When Conch closes, each managed command
 * still running is written down: its chat, its id and when it started, never the command, its
 * arguments, its output or a key. After the restart that chat's next turn hears which of its
 * commands were stopped, so the model checks what they left and runs them again on purpose
 * instead of finding out late. Nothing is rerun by itself. The list lives under `recovery/`,
 * which agent tools can't touch and backups leave out.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Interrupted {
  chat: string;
  process: string;
  startedAt: number;
  stoppedAt: number;
}

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
  #items: Interrupted[];

  constructor(
    home: string,
    private readonly now: () => number = Date.now,
  ) {
    this.#file = join(home, 'recovery', 'interrupted.json');
    this.#items = this.#read();
  }

  /** Written as Conch closes: what was still running. */
  record(items: readonly Interrupted[]) {
    const fresh = items.map(allowed).filter((i): i is Interrupted => Boolean(i));
    if (!fresh.length) return;
    this.#items = [...this.#items, ...fresh].slice(-KEPT);
    this.#write();
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
    try {
      mkdirSync(join(this.#file, '..'), { recursive: true, mode: 0o700 });
      const next = `${this.#file}.${process.pid}.tmp`;
      writeFileSync(next, JSON.stringify(this.#items), { mode: 0o600 });
      renameSync(next, this.#file);
    } catch {
      // A note that can't be kept is only a note: closing goes on.
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
