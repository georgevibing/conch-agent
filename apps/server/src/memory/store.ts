import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Memory, type MemoryAbout, type MemoryKind, type MemoryProvenance } from '@conch/protocol';

import { Emitter } from '../lib/emitter';
import { Mutex, safeJoin, writeFileAtomic } from '../lib/fs';
import { newId } from '../lib/ids';
import { isConsent, NEW_MEMORY, spendConsent, wordsHash, type PersonConsent } from './consent';
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

/** A write is checked, unless it carries a person's answer for exactly these words. */
export type MemoryWrite = WriteContext | PersonConsent;

/** A memory as written, and what the check said about it. */
export interface Written {
  memory: Memory;
  verdict: Verdict;
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
  /** What a learned fact is about, and the record that taught it (ADR 0088). */
  about?: MemoryAbout;
  learned?: string;
}

/**
 * Where memories that stopped being true are kept (ADR 0088), sealed like
 * the rest. The version before reads only `memory/*.md`, so after going back
 * one never returns as if it were still true.
 */
export const PAST_DIR = 'superseded';

/** At most this many past memories are read back (the newest). */
const PAST_MAX = 500;

/** How a write is let through: checked, a person's answer, or only ever stricter. */
type Gate = 'check' | 'person' | 'stricter';

/** Every way a memory changes, as `#commit` sees it (tests hold each method to it). */
export type CommitMethod =
  | 'add'
  | 'update'
  | 'keep'
  | 'hold'
  | 'restore'
  | 'unforget'
  | 'remove'
  | 'supersede'
  | 'unsupersede';

const OK: Verdict = { verdict: 'ok', reasons: [] };

/** A check that couldn't finish never lets a memory through: it waits for the person. */
export const UNCHECKED: Verdict = {
  verdict: 'ask',
  reasons: [
    {
      code: 'unchecked',
      words: 'I couldn’t check this one properly, so it waits for you to look at it.',
    },
  ],
};

/** The deterministic check; an exception holds the memory, never lets it through. */
let check = checkMemory;
function guarded(input: GuardInput): Verdict {
  try {
    return check(input);
  } catch {
    return UNCHECKED;
  }
}

/** For tests: a check that fails. */
export function useCheckForTests(replacement: typeof checkMemory | undefined): void {
  check = replacement ?? checkMemory;
}

/** Where a memory came from is a field a model reads: every label in the one canonical form. */
function cleanProvenance(p: MemoryProvenance | undefined): MemoryProvenance | undefined {
  if (!p) return undefined;
  const read = p.read?.map((label) => canonical(label).slice(0, 120)).filter(Boolean);
  return { ...p, ...(read && { read: read.slice(0, 12) }) };
}

const contextOf = (how: MemoryWrite | undefined): WriteContext =>
  !how || isConsent(how) || 'hash' in how ? {} : how;

/**
 * Long-term memory, stored as one Markdown file per memory under
 * `~/.conch/memory/`. Plain files are deliberate: memories are the user's
 * data — readable, editable, greppable, easy to back up or delete.
 *
 * Every change goes through one gate, `#commit`, here rather than in its
 * callers (ADR 0087):
 *
 * - the words are put in one canonical form, checked, and that same form is
 *   what's kept and read back;
 * - one that looks planted is kept `pending` with `held`, in the same atomic
 *   write as its words, so it's never recallable without a verdict; a check
 *   that throws holds it;
 * - only a person's answer (`PersonConsent`), bound to this memory and to the
 *   exact words they saw, and good once, skips the check or lets a held one go;
 *   without one, nothing ever gets less strict;
 * - each file carries a hash of its words and a seal over the whole record
 *   under a key only this Conch has, so a file changed outside it — by hand, by
 *   a restored backup, by anything else — is checked again when it's read, and
 *   what it says about its verdict or where it came from isn't believed.
 *
 * ```md
 * ---
 * id: m_1a2b3c4d5e6f
 * kind: preference
 * source: agent
 * createdAt: 1727600000000
 * updatedAt: 1727600000000
 * hash: 9c…
 * seal: 3f…
 * ---
 * Prefers TypeScript examples over Python.
 * ```
 */
export class MemoryStore {
  readonly changed = new Emitter<void>();
  #mutex = new Mutex();
  #cache?: Map<string, Memory>;
  #loading?: Promise<Map<string, Memory>>;
  /** The hash of each memory's words as committed: recall uses only what still matches. */
  #hashes = new Map<string, string>();
  #key?: Buffer;
  readonly #keyPath: string;
  /** The check's switch (Settings → Safety); on when unknown. */
  readonly #on: () => Promise<boolean>;
  readonly #onCommit?: (method: CommitMethod) => void;

  constructor(
    private readonly dir: string,
    options: {
      keyPath?: string;
      checkOn?: () => Promise<boolean>;
      /** Every change, as it goes through the gate (for tests). */
      onCommit?: (method: CommitMethod) => void;
    } = {},
  ) {
    this.#keyPath = options.keyPath ?? join(dirname(dir), 'memory.seal');
    this.#on = options.checkOn ?? (() => Promise.resolve(true));
    this.#onCommit = options.onCommit;
  }

  /** Everything, held memories too (for the person, never for a model). */
  async list(): Promise<Memory[]> {
    const all = [...(await this.#load()).values()];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Memory | undefined> {
    return (await this.#load()).get(id);
  }

  /**
   * What a model may be given (ADR 0087): not waiting for an OK, and still
   * exactly the words that were checked. Recall, the prompt and search use this.
   */
  async usable(): Promise<Memory[]> {
    return (await this.list()).filter(
      (m) => !m.pending && !m.held && this.#hashes.get(m.id) === wordsHash(m.content),
    );
  }

  async #input(content: string, how: MemoryWrite | undefined): Promise<GuardInput> {
    const context = contextOf(how);
    return {
      ...context,
      via: context.via ?? 'other',
      content,
      on: context.on ?? (await this.#on().catch(() => true)),
    };
  }

  /**
   * The one gate every change goes through. `make` gets the memory as it is
   * now (inside the lock) and says what it should become: `undefined` leaves
   * it, `null` forgets it — or, with `replacedBy`, moves it to what used to be
   * true (ADR 0088).
   */
  async #commit(
    method: CommitMethod,
    id: string | undefined,
    make: (current: Memory | undefined) => Memory | null | undefined,
    how: MemoryWrite | undefined,
    gate: Gate,
    replacedBy?: string,
  ): Promise<{ memory?: Memory; verdict: Verdict }> {
    this.#onCommit?.(method);
    // The second look may take seconds: asked before the lock, about the words as they'd be.
    const look = contextOf(how).look;
    let raised: { content: string; verdict: Verdict } | undefined;
    if (gate === 'check' && look) {
      const preview = make(id ? await this.get(id) : undefined);
      if (preview) {
        const input = await this.#input(preview.content, how);
        raised = {
          content: canonical(preview.content).slice(0, 2000),
          verdict: await secondLook(guarded(input), input, look).catch(() => UNCHECKED),
        };
      }
    }
    return this.#mutex.run(async () => {
      const memories = await this.#load();
      const current = id ? memories.get(id) : undefined;
      if (id && !current) return { verdict: OK };
      const next = make(current);
      if (next === undefined) return { ...(current && { memory: current }), verdict: OK };
      if (next === null) {
        if (!current) return { verdict: OK };
        const { key } = await this.#sealKey();
        if (replacedBy) {
          // No longer true (ADR 0088): kept, sealed and dated, with what replaced it.
          const past: Memory = { ...current, invalidAt: Date.now(), supersededBy: replacedBy };
          await writeFileAtomic(this.#past(current.id), sealed(serialise(past), key));
        } else {
          // Kept aside, sealed, for Undo on "Forgot": the server's own copy, never the client's.
          await writeFileAtomic(this.#tomb(current.id), sealed(serialise(current), key));
        }
        await rm(safeJoin(this.dir, `${current.id}.md`), { force: true });
        memories.delete(current.id);
        this.#hashes.delete(current.id);
        this.changed.emit();
        return { memory: current, verdict: OK };
      }
      const content = canonical(next.content).slice(0, 2000);
      if (!content) return { ...(current && { memory: current }), verdict: OK };

      let verdict: Verdict = OK;
      let yours = false;
      // A restored memory is about itself even when it was gone; a new one has no id yet.
      const about = current?.id ?? (method === 'restore' ? next.id : NEW_MEMORY);
      if (gate === 'person') {
        // A person's answer, about this memory and exactly these words, once.
        if (!spendConsent(how, about, content))
          throw new Error('Only a person can do that, for the words they saw.');
        yours = true;
      } else if (gate === 'check') {
        if (spendConsent(how, about, content)) yours = true;
        else {
          verdict = guarded(await this.#input(next.content, how));
          // The second look only ever raises, and only about these very words.
          if (verdict.verdict === 'ok' && raised?.content === content) verdict = raised.verdict;
        }
      }
      const held = holdOf(verdict);
      const provenance = cleanProvenance(next.provenance);
      const { pending: _p, held: _h, untrusted, provenance: _v, ...rest } = next;
      const committed: Memory = {
        ...rest,
        content,
        ...(untrusted && { untrusted: canonical(untrusted).slice(0, 300) }),
        ...(provenance && { provenance }),
      };
      if (yours) {
        // A person's Undo puts it back as it was: it doesn't make it theirs.
        committed.provenance =
          method === 'restore' ? provenance : { ...(provenance ?? { via: 'you' }), yours: true };
        if (!committed.provenance) delete committed.provenance;
        // Only Keep lifts a hold: an edit, even yours, leaves a waiting memory
        // waiting, and one put back waits if it was waiting.
        const waiting =
          method === 'keep'
            ? undefined
            : current?.pending
              ? current
              : next.pending
                ? next
                : undefined;
        if (waiting) {
          committed.pending = true;
          if (waiting.held) committed.held = waiting.held;
        }
      } else {
        // Without a person, nothing gets less strict than it was or was asked to be.
        if (held || current?.pending || next.pending) committed.pending = true;
        const was = current?.pending ? current.held : undefined;
        const stricter = held
          ? { ...held, ...(verdict.pieces && { pieces: verdict.pieces }) }
          : (next.held ?? was);
        if (stricter && committed.pending) committed.held = stricter;
        // Put back from Conch's own sealed copy, it keeps where it came from.
        if (method === 'unforget') {
          if (provenance) committed.provenance = provenance;
        } else if (gate === 'check' && verdict.yours && provenance && !committed.held)
          committed.provenance = { ...provenance, yours: true };
        else if (provenance?.yours) committed.provenance = { ...provenance, yours: false };
      }
      const record = Memory.parse(committed);
      // Its verdict and its words in one atomic write: never recallable without a verdict.
      const { key } = await this.#sealKey();
      await writeFileAtomic(safeJoin(this.dir, `${record.id}.md`), sealed(serialise(record), key));
      memories.set(record.id, record);
      this.#hashes.set(record.id, wordsHash(record.content));
      this.changed.emit();
      return { memory: record, verdict };
    });
  }

  /**
   * Remember something. It's checked (ADR 0087) unless `how` is a person's
   * answer for these words; one that looks planted is kept waiting, with why.
   */
  async add(input: MemoryInput, how?: MemoryWrite): Promise<Memory> {
    return (await this.write(input, how)).memory;
  }

  /** `add`, with what the check said (the earlier pieces of a split plant, for the caller to hold). */
  async write(input: MemoryInput, how?: MemoryWrite): Promise<Written> {
    const content = canonical(input.content);
    if (!content) throw new Error('A memory needs words.');
    // Re-saying something we already know refreshes it instead of duplicating:
    // it neither goes back to waiting for an OK, nor comes out of it.
    const existing = (await this.list()).find(
      (m) => m.content.toLowerCase() === content.toLowerCase(),
    );
    if (existing) {
      const { memory, verdict } = await this.#commit(
        'add',
        existing.id,
        (current) => current && { ...current, updatedAt: Date.now() },
        undefined,
        'stricter',
      );
      return { memory: memory ?? existing, verdict };
    }
    const now = Date.now();
    const id = newId('m');
    const { memory, verdict } = await this.#commit(
      'add',
      undefined,
      () => ({
        id,
        content: input.content.slice(0, 4000),
        kind: input.kind ?? 'fact',
        source: input.source,
        ...(input.conversationId && { conversationId: input.conversationId }),
        createdAt: now,
        updatedAt: now,
        ...(input.pending && { pending: true }),
        ...(input.untrusted && { untrusted: input.untrusted.slice(0, 600) }),
        ...(input.provenance && { provenance: input.provenance }),
        ...(input.about && { about: input.about }),
        ...(input.learned && { learned: input.learned }),
      }),
      how,
      'check',
    );
    if (!memory) throw new Error('That memory couldn’t be kept.');
    return { memory, verdict };
  }

  /**
   * Change a memory's words or kind. Checked like a new one (ADR 0087), even
   * when only its kind changes; with a person's answer for the new words, theirs.
   * It never lifts a hold: only `keep` does.
   */
  async update(
    id: string,
    patch: { content?: string; kind?: MemoryKind; provenance?: MemoryProvenance },
    how?: MemoryWrite,
  ): Promise<Memory | undefined> {
    return (
      await this.#commit(
        'update',
        id,
        (current) =>
          current && {
            ...current,
            ...(patch.content !== undefined && { content: patch.content }),
            ...(patch.kind !== undefined && { kind: patch.kind }),
            ...(patch.provenance !== undefined && { provenance: patch.provenance }),
            updatedAt: Date.now(),
          },
        how,
        'check',
      )
    ).memory;
  }

  /**
   * You looked at a memory waiting for your OK, and keep it: as you saw it, or
   * in your own words (`content`). Only a person's answer for exactly those
   * words keeps one; one the check refused (ADR 0087) needs `anyway`.
   */
  async keep(
    id: string,
    consent: PersonConsent,
    options: { content?: string; anyway?: boolean } = {},
  ): Promise<Memory | undefined | 'needs-anyway'> {
    const current = await this.get(id);
    if (!current) return undefined;
    if (current.held?.verdict === 'refuse' && !options.anyway && options.content === undefined)
      return 'needs-anyway';
    return (
      await this.#commit(
        'keep',
        id,
        (now) => {
          if (!now) return undefined;
          const { pending: _p, untrusted: _u, held: _h, ...kept } = now;
          return {
            ...kept,
            content: options.content ?? now.content,
            updatedAt: Date.now(),
          };
        },
        consent,
        'person',
      )
    ).memory;
  }

  /**
   * Hold a memory already remembered (ADR 0087): with what came next, it adds
   * up to something to ask about. It waits again and isn't used meanwhile.
   */
  async hold(id: string, held: NonNullable<Memory['held']>): Promise<Memory | undefined> {
    return (
      await this.#commit(
        'hold',
        id,
        (current) => current && { ...current, pending: true, held, updatedAt: Date.now() },
        undefined,
        'stricter',
      )
    ).memory;
  }

  /**
   * Put a memory back as it was (Undo after a tidy-up). Checked like any
   * write: with your Undo for these words, as it was; otherwise words that
   * look planted wait.
   */
  async restore(memory: Memory, how?: MemoryWrite): Promise<Memory> {
    const parsed = Memory.parse(memory);
    const exists = Boolean(await this.get(parsed.id));
    const { memory: restored } = await this.#commit(
      'restore',
      exists ? parsed.id : undefined,
      () => parsed,
      how,
      'check',
    );
    return restored ?? parsed;
  }

  /** Forget a memory. Conch keeps its own sealed copy aside, for Undo. */
  async remove(id: string): Promise<Memory | undefined> {
    return (await this.#commit('remove', id, () => null, undefined, 'stricter')).memory;
  }

  /** Where a forgotten memory's copy is kept for Undo. */
  #tomb(id: string): string {
    return safeJoin(join(this.dir, '.forgotten'), `${id}.md`);
  }

  /**
   * Undo on "Forgot": put back a memory from Conch's own copy, made when it was
   * forgotten (ADR 0087). Only an id comes in, never the words. The copy is
   * spent; it comes back with the provenance and the hold it had, through the
   * same check as any write, and it's never made the person's by this.
   */
  async unforget(id: string): Promise<Memory | undefined> {
    if (!/^m_[\w-]{1,64}$/.test(id) || (await this.get(id))) return undefined;
    // Spent once, under the lock: a second Undo finds nothing.
    const text = await this.#mutex.run(async () => {
      const path = this.#tomb(id);
      const found = await readFile(path, 'utf8').catch(() => undefined);
      if (found !== undefined) await rm(path, { force: true });
      return found;
    });
    const was = text && parse(text);
    if (!text || !was || was.id !== id) return undefined;
    const { key } = await this.#sealKey();
    const ours = sealHolds(text, key) && hashLine(text) === wordsHash(was.content);
    const memory: Memory = ours
      ? was
      : {
          ...was,
          ...(was.provenance && { provenance: { ...was.provenance, yours: false } }),
        };
    const yours = ours && Boolean(was.provenance?.yours);
    const context: WriteContext = ours
      ? {
          via: 'chat',
          read: (was.provenance?.read ?? []).map((label) => ({
            kind: label.includes('.') ? ('web' as const) : ('app' as const),
            label,
          })),
          said: yours ? [was.content] : [],
        }
      : { via: 'other' };
    try {
      return (
        await this.#commit(
          'unforget',
          undefined,
          () => ({ ...memory, updatedAt: Date.now() }),
          context,
          'check',
        )
      ).memory;
    } catch (error) {
      // It didn't go back: the copy stays for another try.
      await writeFileAtomic(this.#tomb(id), text).catch(() => undefined);
      throw error;
    }
  }

  /**
   * What's true now replaces a memory (ADR 0088). The new one is written
   * through the check like any memory; once it's usable, the old one moves to
   * `memory/superseded/`, sealed, saying when it stopped being true and what
   * replaced it. A new one that waits (asked to, held, or waiting for an OK)
   * leaves the old one where it is: nothing is retired on words nobody has
   * looked at. Words already known are that memory, refreshed, and nothing is
   * retired by them: a supersede only ever retires for a memory it made.
   */
  async supersede(
    id: string,
    next: MemoryInput,
    how?: MemoryWrite,
  ): Promise<{ before: Memory; after: Memory; retired: boolean } | undefined> {
    const before = await this.get(id);
    if (!before) return undefined;
    const known = new Set((await this.list()).map((m) => m.id));
    const { memory: after } = await this.write(next, how);
    if (known.has(after.id)) return { before, after, retired: false };
    const retired = next.pending || after.pending ? false : await this.retire(id, after.id);
    return { before, after, retired };
  }

  /**
   * A memory that waited to replace another was kept: the other one stops
   * being true now. Only ever stricter: it only moves a usable memory out of
   * use. One held or waiting for an OK stays where the person will see it.
   */
  async retire(id: string, replacedBy: string): Promise<boolean> {
    const [target, replacement] = [await this.get(id), await this.get(replacedBy)];
    if (!target || target.pending || target.held) return false;
    if (!replacement || replacement.pending) return false;
    let moved = false;
    await this.#commit(
      'supersede',
      id,
      // Decided again under the lock: held since, it stays.
      (current) => {
        if (!current || current.pending || current.held) return undefined;
        moved = true;
        return null;
      },
      undefined,
      'stricter',
      replacedBy,
    );
    return moved;
  }

  /**
   * Undo a supersede: the memory that stopped being true comes back from
   * Conch's own sealed copy, through the same check as any write (like
   * `unforget`), and then the one that replaced it goes. A stop part way
   * leaves both, never neither: a copy that can't be put back leaves the new
   * one too. With no copy at all (forgotten from Earlier) the new one still
   * goes: that's what Undo asked. Only ids come in, never words.
   */
  async unsupersede(afterId: string, beforeId: string): Promise<Memory | undefined> {
    if (!/^m_[\w-]{1,64}$/.test(beforeId)) return undefined;
    if (await this.get(beforeId)) {
      await this.remove(afterId);
      return undefined;
    }
    const text = await readFile(this.#past(beforeId), 'utf8').catch(() => undefined);
    if (text === undefined) {
      await this.remove(afterId);
      return undefined;
    }
    const was = parse(text);
    if (was?.id !== beforeId) return undefined;
    const { key } = await this.#sealKey();
    const ours = sealHolds(text, key) && hashLine(text) === wordsHash(was.content);
    const { invalidAt: _i, supersededBy: _s, ...live } = was;
    const memory: Memory = ours
      ? live
      : { ...live, ...(live.provenance && { provenance: { ...live.provenance, yours: false } }) };
    // As `unforget`: the person's own words only where the copy says they were.
    const yours = ours && Boolean(live.provenance?.yours);
    const context: WriteContext = ours
      ? {
          via: 'chat',
          read: (live.provenance?.read ?? []).map((label) => ({
            kind: label.includes('.') ? ('web' as const) : ('app' as const),
            label,
          })),
          said: yours ? [live.content] : [],
        }
      : { via: 'other' };
    const restored = (
      await this.#commit('unsupersede', undefined, () => memory, context, 'check').catch(() => ({
        memory: undefined,
      }))
    ).memory;
    if (!restored) return undefined;
    await rm(this.#past(beforeId), { force: true });
    await this.remove(afterId);
    return restored;
  }

  /**
   * Memories that stopped being true, newest first (ADR 0088). A copy Conch
   * sealed, with the words it was sealed with, is read as it is. One that
   * wasn't — brought back from a backup (the key never travels), or changed
   * by hand — is checked again, as from somewhere, and left out if the check
   * would hold it; what it says about where it came from isn't believed. One
   * that's live again (a stop part way through) counts as live.
   */
  async listPast(): Promise<Memory[]> {
    const live = await this.#load();
    let files: string[] = [];
    try {
      files = (await readdir(join(this.dir, PAST_DIR))).filter((f) => f.endsWith('.md'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!files.length) return [];
    const { key } = await this.#sealKey();
    const on = await this.#on().catch(() => true);
    const past: Memory[] = [];
    for (const file of files) {
      const text = await readFile(join(this.dir, PAST_DIR, file), 'utf8').catch(() => '');
      const memory = parse(text);
      if (!memory || live.has(memory.id) || `${memory.id}.md` !== file) continue;
      // What used to be true is handed to a model (recall): never words held or waiting.
      if (memory.pending || memory.held) continue;
      if (sealHolds(text, key) && hashLine(text) === wordsHash(memory.content)) {
        past.push(memory);
        continue;
      }
      const verdict = guarded({ content: rawContent(text) ?? memory.content, via: 'other', on });
      if (verdict.verdict !== 'ok') continue;
      // Where it says it came from isn't believed; a note that it came from outside only adds care.
      const { provenance, ...rest } = memory;
      const cleaned = cleanProvenance(provenance);
      past.push({
        ...rest,
        content: canonical(memory.content).slice(0, 2000) || memory.content,
        ...(cleaned && { provenance: { ...cleaned, yours: false } }),
      });
    }
    return past.sort((a, b) => (b.invalidAt ?? 0) - (a.invalidAt ?? 0)).slice(0, PAST_MAX);
  }

  /**
   * Forget something that used to be true (Earlier → Forget). It's only ever
   * Conch's own copy of a memory out of use: no live memory is touched.
   */
  async forgetPast(id: string): Promise<boolean> {
    if (!/^m_[\w-]{1,64}$/.test(id)) return false;
    return this.#mutex.run(async () => {
      const path = this.#past(id);
      const there = await readFile(path, 'utf8').then(
        () => true,
        () => false,
      );
      if (there) await rm(path, { force: true });
      return there;
    });
  }

  /** Where a memory that stopped being true is kept. */
  #past(id: string): string {
    return safeJoin(join(this.dir, PAST_DIR), `${id}.md`);
  }

  /** Keyword search over what a model may be given, ranked by term overlap then recency (`MemoryIndex` is better). */
  async search(query: string, limit = 8): Promise<Memory[]> {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    const scored = (await this.usable()).map((m) => {
      const text = m.content.toLowerCase();
      return { m, score: terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0) };
    });
    return scored
      .filter((s) => terms.length === 0 || s.score > 0)
      .sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt)
      .slice(0, limit)
      .map((s) => s.m);
  }

  /** This Conch's own key for sealing memory files; made the first time there's a memory. */
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
    this.#loading ??= this.#read().finally(() => {
      this.#loading = undefined;
    });
    return this.#loading;
  }

  /** Every startup reader shares one snapshot; a late read cannot replace newer writes. */
  async #read(): Promise<Map<string, Memory>> {
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
    const on = await this.#on().catch(() => true);
    for (const file of files) {
      const text = await readFile(safeJoin(this.dir, file), 'utf8');
      const memory = parse(text);
      if (!memory) continue;
      if (sealHolds(text, key) && hashLine(text) === wordsHash(memory.content)) {
        map.set(memory.id, memory);
        this.#hashes.set(memory.id, wordsHash(memory.content));
        continue;
      }
      // No seal that holds, or words that aren't the ones it was sealed with:
      // changed outside Conch (by hand, a restored backup, an import, anything
      // else). Its verdict and where it says it came from aren't believed; it's
      // checked again. With no key yet (the first run with seals, a new
      // computer), what's there gets the checks that hold wherever a memory
      // came from; with a key, a file it didn't seal is from outside.
      const verdict = guarded({
        content: rawContent(text) ?? memory.content,
        via: fresh ? 'chat' : 'other',
        on,
      });
      const held = holdOf(verdict);
      const { held: _claimed, untrusted: _note, provenance, pending, ...rest } = memory;
      const cleaned = cleanProvenance(provenance);
      const checked = Memory.parse({
        ...rest,
        content: canonical(memory.content).slice(0, 2000) || memory.content,
        ...((held || pending) && { pending: true }),
        ...(held && { held }),
        ...(pending &&
          !held && { untrusted: 'This changed outside Conch, so it waits for your OK.' }),
        ...(cleaned && { provenance: { ...cleaned, yours: false } }),
      });
      // Held in memory first: even if the file can't be written, it isn't used.
      map.set(checked.id, checked);
      this.#hashes.set(checked.id, wordsHash(checked.content));
      await writeFileAtomic(safeJoin(this.dir, file), sealed(serialise(checked), key)).catch(
        () => undefined,
      );
    }
    this.#cache = map;
    return map;
  }
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

/** The hash of its words a file says it was written with. */
function hashLine(text: string): string | undefined {
  return /\nhash: ([0-9a-f]{64})\n/.exec(text)?.[1];
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
    // Optional, so the version before reads the memory and leaves them out (ADR 0051, ADR 0088).
    ...(m.about ? [`about: ${m.about}`] : []),
    ...(m.learned ? [`learned: ${m.learned}`] : []),
    `createdAt: ${m.createdAt}`,
    `updatedAt: ${m.updatedAt}`,
    ...(m.invalidAt !== undefined ? [`invalidAt: ${m.invalidAt}`] : []),
    ...(m.supersededBy ? [`supersededBy: ${m.supersededBy}`] : []),
    `hash: ${wordsHash(m.content)}`,
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
  const { pending, held, provenance, hash: _hash, seal: _seal, ...rest } = meta;
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
