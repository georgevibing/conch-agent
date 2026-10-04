/**
 * Codex threads Conch can carry on (ADR 0066 § Carrying on). Codex keeps a
 * thread as a file in its home (`sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`),
 * but each run gets a home of its own that's removed afterwards: its sign-in
 * must never wait on disk in the clear (`home.ts`). So Conch keeps the thread
 * itself, here, between turns, and puts it back in the next run's home before
 * asking Codex to resume it.
 *
 * A thread holds the chat word for word, the way the chat's own log does, so
 * it lives under Conch's home beside it: never in backups (Conch's own log is
 * the durable record; ADR 0020), out of reach of the agent's tools
 * (`lib/protect.ts`), gone when the chat is deleted, and tidied after a month
 * unused.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { z } from 'zod';

import { readJson, safeJoin, writeFileAtomic } from '../../lib/fs';

/** Codex's thread ids are UUIDs. Nothing else becomes a file name. */
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where Codex keeps a thread, under its home's `sessions`. */
const ROLLOUT = /^\d{4}\/\d{2}\/\d{2}\/rollout-[0-9A-Za-z_-]+\.jsonl$/;
/** A thread this big has outgrown carrying: the next turn starts one afresh, with the handoff. */
export const MAX_THREAD_BYTES = 64 * 1024 * 1024;
/** Unused for this long, a kept thread goes. */
const KEEP_MS = 30 * 24 * 60 * 60_000;

const Meta = z.object({
  /** Where it sits under `sessions`, with forward slashes. */
  rollout: z.string().regex(ROLLOUT),
  /** What Conch last told Codex about itself (a digest), to say it again only when it changed. */
  instructions: z.string().max(128).optional(),
});
type Meta = z.infer<typeof Meta>;

/**
 * What a turn may use, as a short digest: a thread is carried on only while
 * it's the same. Codex keeps a thread's tools from when it started and can't
 * be given new ones (ADR 0036), so a thread whose tools no longer match —
 * an app added or disconnected, a tool turned off — isn't resumed: the model
 * would be offered what's gone and not see what's new.
 */
export function toolsDigest(
  variant: string,
  tools: readonly { name: string; schema: unknown }[],
): string {
  const shape = [...tools]
    .map((tool) => [tool.name, tool.schema] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256')
    .update(JSON.stringify([variant, shape]))
    .digest('hex')
    .slice(0, 16);
}

export function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/** `<thread id>.<tools digest>`: the resume id Conch keeps with the chat. */
export function resumeIdFor(threadId: string, tools: string): string {
  return `${threadId}.${tools}`;
}

export function parseResumeId(
  resumeId: string | undefined,
): { threadId: string; tools: string } | undefined {
  const match = /^([0-9a-f-]{36})\.([0-9a-f]{16})$/i.exec(resumeId ?? '');
  return match?.[1] && match[2] && THREAD_ID.test(match[1])
    ? { threadId: match[1], tools: match[2] }
    : undefined;
}

async function findRollout(sessions: string, threadId: string): Promise<string | undefined> {
  const entries = await readdir(sessions, { recursive: true, withFileTypes: true }).catch(() => []);
  const found = entries.find(
    (entry) => entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`),
  );
  return found ? join(found.parentPath, found.name) : undefined;
}

export class CodexThreads {
  #tidied = false;
  constructor(readonly dir: string) {}

  #file(threadId: string, ext: 'jsonl' | 'json'): string {
    if (!THREAD_ID.test(threadId)) throw new Error('Not a Codex thread id.');
    return safeJoin(this.dir, `${threadId}.${ext}`);
  }

  async meta(threadId: string): Promise<Meta | undefined> {
    if (!THREAD_ID.test(threadId)) return undefined;
    const parsed = Meta.safeParse(
      await readJson(this.#file(threadId, 'json')).catch(() => undefined),
    );
    if (!parsed.success) return undefined;
    const size = await stat(this.#file(threadId, 'jsonl')).then(
      (s) => s.size,
      () => -1,
    );
    return size > 0 && size <= MAX_THREAD_BYTES ? parsed.data : undefined;
  }

  /**
   * Put a kept thread where Codex looks for it in a run's home (`CODEX_HOME`),
   * before the run starts. False when there's nothing to put back.
   */
  async restore(threadId: string, runHome: string): Promise<boolean> {
    const meta = await this.meta(threadId);
    if (!meta) return false;
    const target = join(runHome, 'sessions', ...meta.rollout.split('/'));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(this.#file(threadId, 'jsonl'), target);
    // Used now: the tidy-up counts from here.
    const now = new Date();
    await utimes(this.#file(threadId, 'json'), now, now).catch(() => undefined);
    return true;
  }

  /**
   * Keep the thread a run wrote, after Codex has stopped (so the file is
   * whole), before the run's home is removed. A thread too big to carry on is
   * forgotten instead: the next turn starts afresh.
   */
  async keep(threadId: string, runHome: string, instructions?: string): Promise<boolean> {
    const sessions = join(runHome, 'sessions');
    const found = await findRollout(sessions, threadId);
    if (!found) return false;
    const rollout = relative(sessions, found).split(sep).join('/');
    const size = (await stat(found)).size;
    if (!ROLLOUT.test(rollout) || size > MAX_THREAD_BYTES) {
      await this.forget(threadId);
      return false;
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.#file(threadId, 'jsonl'), await readFile(found));
    await writeFileAtomic(
      this.#file(threadId, 'json'),
      JSON.stringify({ rollout, ...(instructions && { instructions }) } satisfies Meta),
    );
    void this.tidy();
    return true;
  }

  async forget(threadId: string): Promise<void> {
    if (!THREAD_ID.test(threadId)) return;
    await rm(this.#file(threadId, 'jsonl'), { force: true });
    await rm(this.#file(threadId, 'json'), { force: true });
  }

  /** Threads unused for a month go, once per start. */
  async tidy(now = Date.now()): Promise<void> {
    if (this.#tidied) return;
    this.#tidied = true;
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      const id = /^(.+)\.json$/.exec(name)?.[1];
      if (!id || !THREAD_ID.test(id)) continue;
      const used = await stat(join(this.dir, name)).then(
        (s) => s.mtimeMs,
        () => now,
      );
      if (now - used > KEEP_MS) await this.forget(id);
    }
  }
}
