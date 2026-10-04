import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Memory, type MemoryKind, type MemoryProvenance } from '@conch/protocol';

import { Emitter } from '../lib/emitter';
import { Mutex, safeJoin, writeFileAtomic } from '../lib/fs';
import { newId } from '../lib/ids';
import { isConsent, type PersonConsent } from './consent';
import {
  canonical,
  checkMemory,
  holdOf,
  secondLook,
  type GuardInput,
  type LookModel,
  type Verdict,
} from './guard';

/**
 * Where a write comes from, for the memory check (ADR 0087): what the chat
 * read, the person's own words, and the rest of `GuardInput`. Left out, a
 * write is "from somewhere": the check treats it like something from outside.
 */
export type WriteContext = Omit<GuardInput, 'content' | 'via'> & {
  via?: GuardInput['via'];
  /** A cheap model for the second look; it can only raise a flag. */
  look?: () => Promise<LookModel | undefined>;
};

/** A write is checked, unless it carries a person's answer (`mintConsent`, routes only). */
export type MemoryWrite = WriteContext | PersonConsent;

/** A memory as written, and what the check said about it. */
export interface Written {
  memory: Memory;
  verdict: Verdict;
}

/** Where a memory came from is a field a model reads: every label in the one canonical form. */
function cleanProvenance(p: MemoryProvenance | undefined): MemoryProvenance | undefined {
  if (!p) return undefined;
  const read = p.read?.map((label) => canonical(label).slice(0, 120)).filter(Boolean);
  return { ...p, ...(read && { read: read.slice(0, 12) }) };
}

const OK: Verdict = { verdict: 'ok', reasons: [] };

/**
 * Long-term memory, stored as one Markdown file per memory under
 * `~/.conch/memory/`. Plain files are deliberate: memories are the user's
 * data — readable, editable, greppable, easy to back up or delete.
 *
 * Every write goes through the memory check here, not in its callers (ADR
 * 0087): the words are put in one canonical form, checked, and that same form
 * is what's kept and read back. One that looks planted is kept `pending` with
 * `held`, never used until a person answers; only a person's answer
 * (`PersonConsent`, minted by the routes that take it) skips the check. Each
 * file is sealed with a key only this Conch has, so a file changed outside it
 * — by hand, by a restored backup, by anything else — is checked again when
 * it's read.
 *
 * ```md
 * ---
 * id: m_1a2b3c4d5e6f
 * kind: preference
 * source: agent
 * createdAt: 1727600000000
 * updatedAt: 1727600000000
 * seal: 3f…
 * ---
 * Prefers TypeScript examples over Python.
 * ```
 */
export class MemoryStore {
  readonly changed = new Emitter<void>();
  #mutex = new Mutex();
  #cache?: Map<string, Memory>;
  #key?: Buffer;
  readonly #keyPath: string;
  /** The check's switch (Settings → Safety); on when unknown. */
  readonly #on: () => Promise<boolean>;

  constructor(
    private readonly dir: string,
    options: { keyPath?: string; checkOn?: () => Promise<boolean> } = {},
  ) {
    this.#keyPath = options.keyPath ?? join(dirname(dir), 'memory.seal');
    this.#on = options.checkOn ?? (() => Promise.resolve(true));
  }

  async list(): Promise<Memory[]> {
    const all = [...(await this.#load()).values()];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Memory | undefined> {
    return (await this.#load()).get(id);
  }

  /** The check, outside the lock (a second look may take seconds). */
  async #check(content: string, how: MemoryWrite | undefined): Promise<Verdict> {
    if (isConsent(how)) return OK;
    const context: WriteContext = how ?? {};
    const input: GuardInput = {
      ...context,
      via: context.via ?? 'other',
      content,
      on: context.on ?? (await this.#on().catch(() => true)),
    };
    return secondLook(checkMemory(input), input, context.look);
  }

  /**
   * Remember something. It's checked (ADR 0087) unless `how` is a person's
   * answer; one that looks planted is kept waiting, with why.
   */
  async add(input: MemoryInput, how?: MemoryWrite): Promise<Memory> {
    return (await this.write(input, how)).memory;
  }

  /** `add`, with what the check said (the earlier pieces of a split plant, for the caller to hold). */
  async write(input: MemoryInput, how?: MemoryWrite): Promise<Written> {
    const content = canonical(input.content);
    if (!content) throw new Error('A memory needs words.');
    const verdict = await this.#check(input.content, how);
    const held = holdOf(verdict);
    const memory = await this.#mutex.run(async () => {
      const memories = await this.#load();
      // Re-saying something we already know refreshes it instead of duplicating.
      const existing = [...memories.values()].find(
        (m) => canonical(m.content).toLowerCase() === content.toLowerCase(),
      );
      // (Something already known never goes back to waiting for an OK.)
      if (existing) return this.#write({ ...existing, updatedAt: Date.now() });
      const now = Date.now();
      const provenance = cleanProvenance(input.provenance);
      return this.#write(
        Memory.parse({
          id: newId('m'),
          content,
          kind: input.kind ?? 'fact',
          source: input.source,
          conversationId: input.conversationId,
          createdAt: now,
          updatedAt: now,
          ...((input.pending || held) && { pending: true }),
          ...(input.untrusted && { untrusted: canonical(input.untrusted).slice(0, 300) }),
          ...(held && { held: { ...held, ...(verdict.pieces && { pieces: verdict.pieces }) } }),
          ...(isConsent(how)
            ? { provenance: { ...(provenance ?? { via: 'you' as const }), yours: true } }
            : provenance && {
                provenance: { ...provenance, ...(verdict.yours && { yours: true }) },
              }),
        }),
      );
    });
    return { memory, verdict };
  }

  /**
   * Change a memory's words or kind. Checked like a new one (ADR 0087), even
   * when only its kind changes: words that look planted make it wait again.
   */
  async update(
    id: string,
    patch: { content?: string; kind?: MemoryKind },
    how?: MemoryWrite,
  ): Promise<Memory | undefined> {
    const before = await this.get(id);
    if (!before) return undefined;
    const words = patch.content ?? before.content;
    const verdict = await this.#check(words, how);
    const held = holdOf(verdict);
    return this.#mutex.run(async () => {
      const current = (await this.#load()).get(id);
      if (!current) return undefined;
      const content = canonical(words);
      if (!content) return current;
      return this.#write({
        ...current,
        content,
        ...(patch.kind !== undefined && { kind: patch.kind }),
        ...(held && { pending: true, held }),
        ...(isConsent(how) && {
          provenance: { ...(current.provenance ?? { via: 'you' as const }), yours: true },
        }),
        updatedAt: Date.now(),
      });
    });
  }

  /**
   * You looked at a memory waiting for your OK, and keep it: as it is, or in
   * your own words (`content`). Only a person's answer keeps one; one the
   * check refused (ADR 0087) needs `anyway`.
   */
  keep(
    id: string,
    consent: PersonConsent,
    options: { content?: string; anyway?: boolean } = {},
  ): Promise<Memory | undefined | 'needs-anyway'> {
    if (!isConsent(consent)) return Promise.reject(new Error('Only a person keeps a memory.'));
    return this.#mutex.run(async () => {
      const current = (await this.#load()).get(id);
      if (!current) return undefined;
      if (current.held?.verdict === 'refuse' && !options.anyway && options.content === undefined)
        return 'needs-anyway';
      const { pending: _p, untrusted: _u, held: _h, ...kept } = current;
      const content = canonical(options.content ?? current.content);
      if (!content) return current;
      return this.#write({
        ...kept,
        content,
        // Kept by you: its words are yours now, wherever they came from.
        provenance: { ...(current.provenance ?? { via: 'chat' as const }), yours: true },
        updatedAt: Date.now(),
      });
    });
  }

  /**
   * Hold a memory already remembered (ADR 0087): with what came next, it adds
   * up to something to ask about. It waits again and isn't used meanwhile.
   * Only ever stricter, so it needs no check.
   */
  hold(id: string, held: NonNullable<Memory['held']>): Promise<Memory | undefined> {
    return this.#mutex.run(async () => {
      const current = (await this.#load()).get(id);
      if (!current) return undefined;
      return this.#write({ ...current, pending: true, held, updatedAt: Date.now() });
    });
  }

  /**
   * Put a memory back as it was (Undo after a tidy-up). Checked like any
   * write: with your Undo, as it was; otherwise words that look planted wait.
   */
  async restore(memory: Memory, how?: MemoryWrite): Promise<Memory> {
    const verdict = await this.#check(memory.content, how);
    const held = holdOf(verdict);
    const parsed = Memory.parse(memory);
    return this.#mutex.run(() =>
      this.#write({
        ...parsed,
        content: canonical(parsed.content) || parsed.content,
        ...(held && { pending: true, held }),
      }),
    );
  }

  /** Forget a memory. Only ever takes away, so it needs no check. */
  remove(id: string): Promise<Memory | undefined> {
    return this.#mutex.run(async () => {
      const memories = await this.#load();
      const current = memories.get(id);
      if (!current) return undefined;
      await rm(safeJoin(this.dir, `${id}.md`), { force: true });
      memories.delete(id);
      this.changed.emit();
      return current;
    });
  }

  /** Keyword search, ranked by term overlap then recency (the index's hybrid search is better: `MemoryIndex`). */
  async search(query: string, limit = 8): Promise<Memory[]> {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    const scored = (await this.list()).map((m) => {
      const text = m.content.toLowerCase();
      return { m, score: terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0) };
    });
    return scored
      .filter((s) => terms.length === 0 || s.score > 0)
      .sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt)
      .slice(0, limit)
      .map((s) => s.m);
  }

  async #write(memory: Memory): Promise<Memory> {
    const { key } = await this.#sealKey();
    await writeFileAtomic(safeJoin(this.dir, `${memory.id}.md`), sealed(serialise(memory), key));
    (await this.#load()).set(memory.id, memory);
    this.changed.emit();
    return memory;
  }

  /** This Conch's own key for sealing memory files; made the first time (what's there then is trusted once). */
  async #sealKey(): Promise<{ key: Buffer; fresh: boolean }> {
    if (this.#key) return { key: this.#key, fresh: false };
    try {
      const key = Buffer.from((await readFile(this.#keyPath, 'utf8')).trim(), 'base64url');
      if (key.length >= 32) {
        this.#key = key;
        return { key, fresh: false };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const key = randomBytes(32);
    await writeFileAtomic(this.#keyPath, key.toString('base64url'), 0o600);
    this.#key = key;
    return { key, fresh: true };
  }

  async #load(): Promise<Map<string, Memory>> {
    if (this.#cache) return this.#cache;
    const map = new Map<string, Memory>();
    let files: string[] = [];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith('.md'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!files.length) {
      this.#cache = map;
      return map;
    }
    const { key, fresh } = await this.#sealKey();
    for (const file of files) {
      const text = await readFile(safeJoin(this.dir, file), 'utf8');
      const memory = parse(text);
      if (!memory) continue;
      if (sealHolds(text, key)) {
        map.set(memory.id, memory);
        continue;
      }
      // No seal that holds: changed outside Conch (by hand, a restored backup,
      // anything else), so it's checked again. With no key yet (the first run
      // with seals, or a new computer), what's there gets the checks that hold
      // wherever a memory came from: secrets, hidden characters, lookalikes,
      // encoded text, beacons. With a key, a file it didn't seal is from outside.
      const verdict = checkMemory({
        content: rawContent(text) ?? memory.content,
        via: fresh ? 'tidy' : 'other',
        on: await this.#on().catch(() => true),
      });
      const held = holdOf(verdict);
      const { held: _was, ...rest } = memory;
      const checked: Memory = {
        ...rest,
        content: canonical(memory.content) || memory.content,
        ...((held || memory.pending) && { pending: true }),
        ...(held && { held }),
        // What it says about where it came from came with the file: none of it is believed.
        ...(memory.provenance && { provenance: { ...memory.provenance, yours: false } }),
      };
      map.set(checked.id, checked);
      await writeFileAtomic(safeJoin(this.dir, file), sealed(serialise(checked), key));
    }
    this.#cache = map;
    return map;
  }
}

/** What `add` takes. */
export interface MemoryInput {
  content: string;
  kind?: MemoryKind;
  source: Memory['source'];
  conversationId?: string;
  /** Waiting for the person's OK (ADR 0032), and why. Only ever stricter. */
  pending?: boolean;
  untrusted?: string;
  /** Where it came from (ADR 0087). */
  provenance?: MemoryProvenance;
}

/** The seal on a memory file: HMAC-SHA256 of the rest of it, under this Conch's key. */
function sealOf(body: string, key: Buffer): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

function sealed(text: string, key: Buffer): string {
  return text.replace(/\n---\n/, `\nseal: ${sealOf(text, key)}\n---\n`);
}

function sealHolds(text: string, key: Buffer): boolean {
  const line = /\nseal: ([A-Za-z0-9_-]+)\n/.exec(text);
  if (!line?.[1]) return false;
  const body = text.replace(line[0], '\n');
  const want = Buffer.from(sealOf(body, key));
  const got = Buffer.from(line[1]);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A file's words exactly as written, hidden characters and all, for the check. */
function rawContent(text: string): string | undefined {
  return /^---\n[\s\S]*?\n---\n?([\s\S]*)$/.exec(text)?.[1];
}

function normalise(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

export function serialise(m: Memory): string {
  const meta = [
    `id: ${m.id}`,
    `kind: ${m.kind}`,
    `source: ${m.source}`,
    ...(m.conversationId ? [`conversationId: ${m.conversationId}`] : []),
    ...(m.pending ? ['pending: true'] : []),
    ...(m.untrusted ? [`untrusted: ${m.untrusted.replace(/\s+/g, ' ')}`] : []),
    // One line of JSON each: an older Conch reads past what it doesn't know.
    ...(m.held ? [`held: ${JSON.stringify(m.held)}`] : []),
    ...(m.provenance ? [`provenance: ${JSON.stringify(m.provenance)}`] : []),
    `createdAt: ${m.createdAt}`,
    `updatedAt: ${m.updatedAt}`,
  ];
  return `---\n${meta.join('\n')}\n---\n${m.content}\n`;
}

export function parse(text: string): Memory | undefined {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  const meta: Record<string, string | number> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    meta[key] = /At$/.test(key) ? Number(value) : value;
  }
  const { pending, held, provenance, ...rest } = meta;
  const json = (value: unknown) => {
    try {
      return typeof value === 'string' ? (JSON.parse(value) as unknown) : undefined;
    } catch {
      return undefined;
    }
  };
  const result = Memory.safeParse({
    ...rest,
    ...(pending === 'true' && { pending: true }),
    ...(held !== undefined && { held: json(held) }),
    ...(provenance !== undefined && { provenance: json(provenance) }),
    content: normalise(match[2] ?? ''),
  });
  return result.success ? result.data : undefined;
}
