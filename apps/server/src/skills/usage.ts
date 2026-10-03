/**
 * When each skill was last used, and which ones Conch put on your shelf
 * (ADR 0058). Every way a skill is used ends in a `skill.used` event in a
 * chat — typed as `/name` (the composer, ⌘K, a routine's instruction, a chat
 * app), loaded with `use_skill`, or carried in with work from another chat —
 * so one listener on those events sees them all.
 *
 * The shelf only ever offers: a skill Conch suggested, learned from your
 * work or brought in from another app, on and unused for a long while, is
 * shown on the Skills page with **Turn them off** and **Keep**. A skill you
 * wrote yourself, or one from another app's folder, is never offered.
 */
import { join } from 'node:path';

import type { ServerEvent, ShelfSkill, Skill } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

/** Two months without use is a long while. */
export const SHELF_DAYS = 60;
const DAY = 86_400_000;
/** Enough to remember every skill anyone keeps. */
const MOST = 2000;

/** How a skill came to be on your shelf, when it was Conch that put it there. */
export const SkillOrigin = z.enum([
  /** Saved from "You've asked for this in 3 chats" (ADR 0032). */
  'suggested',
  /** Saved from "Save how I did this" (ADR 0058). */
  'learned',
  /** Brought from OpenClaw or Hermes (ADR 0035). */
  'imported',
]);
export type SkillOrigin = z.infer<typeof SkillOrigin>;

const UsageFile = z.object({
  /** Skill id → when it was last used. */
  used: z.record(z.string(), z.number()).default({}),
  /** Skill id → how Conch put it on your shelf, and when. */
  from: z.record(z.string(), z.object({ origin: SkillOrigin, at: z.number() })).default({}),
  /** Skill id → when you pressed Keep: asked again only after another long while. */
  kept: z.record(z.string(), z.number()).default({}),
});
type UsageFile = z.infer<typeof UsageFile>;

/** The skill a chat just used, if this event says one was. */
export function skillUsedIn(event: ServerEvent): string | undefined {
  return event.type === 'conversation.event' && event.event.type === 'skill.used'
    ? event.event.skillId
    : undefined;
}

/** The record without one key. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/** The record with one key's value under another name. */
function moved<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  const value = record[from];
  const rest = without(record, from);
  return value === undefined ? rest : { ...rest, [to]: value };
}

/** At most `MOST` entries, newest kept. */
function bounded(record: Record<string, number>): Record<string, number> {
  const entries = Object.entries(record);
  if (entries.length <= MOST) return record;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MOST));
}

/**
 * Skills that have sat unused for `days`: on, working, Conch's own folder,
 * put there by Conch — and not used, made or kept since. A skill that was
 * here before Conch kept count has no record of how it came, so it's never
 * offered.
 */
export function stale(
  skills: readonly Pick<Skill, 'id' | 'name' | 'title' | 'mode' | 'source' | 'problem'>[],
  file: UsageFile,
  now: number,
  days = SHELF_DAYS,
): ShelfSkill[] {
  const cutoff = now - days * DAY;
  const out: ShelfSkill[] = [];
  for (const skill of skills) {
    const from = file.from[skill.id];
    // Only what Conch put on the shelf; never a skill you wrote, or another app's.
    if (!from || skill.source !== 'conch') continue;
    // Off already, or broken: nothing to tidy.
    if (skill.mode === 'off' || skill.problem) continue;
    const lastUsedAt = file.used[skill.id];
    const idleSince = Math.max(lastUsedAt ?? 0, from.at, file.kept[skill.id] ?? 0);
    if (idleSince > cutoff) continue;
    out.push({
      id: skill.id,
      name: skill.name,
      title: skill.title,
      ...(lastUsedAt !== undefined && { lastUsedAt }),
      idleSince,
    });
  }
  return out.sort((a, b) => a.idleSince - b.idleSince);
}

export class SkillUsage {
  readonly #path: string;
  readonly #mutex = new Mutex();

  constructor(
    home: string,
    private readonly heal?: Heal,
    private readonly now: () => number = Date.now,
  ) {
    this.#path = join(home, 'skill-usage.json');
  }

  async read(): Promise<UsageFile> {
    return (
      await readStore(this.#path, UsageFile, {
        onRepair: () =>
          this.heal?.(
            'skills',
            'When your skills were last used couldn’t be read, so Conch started counting again from today.',
          ),
      })
    ).value;
  }

  /** Read, change, write: `fn` gives the file as it should be, or nothing to leave it. */
  #change(fn: (file: UsageFile) => UsageFile | undefined): Promise<void> {
    return this.#mutex.run(async () => {
      const next = fn(await this.read());
      if (!next) return;
      await writeJson(this.#path, { ...next, used: bounded(next.used), kept: bounded(next.kept) });
    });
  }

  /** A skill was used, just now. */
  used(id: string): Promise<void> {
    const at = this.now();
    return this.#change((file) => ({ ...file, used: { ...file.used, [id]: at } }));
  }

  /** Conch put this skill on your shelf. */
  note(id: string, origin: SkillOrigin): Promise<void> {
    const at = this.now();
    return this.#change((file) => ({ ...file, from: { ...file.from, [id]: { origin, at } } }));
  }

  /** Keep these: offered again only after another long while unused. */
  keep(ids: readonly string[]): Promise<void> {
    const at = this.now();
    return this.#change((file) => ({
      ...file,
      kept: { ...file.kept, ...Object.fromEntries(ids.map((id) => [id, at])) },
    }));
  }

  /** A skill was renamed: what Conch knows about it goes with it. */
  renamed(from: string, to: string): Promise<void> {
    return this.#change((file) =>
      from === to
        ? undefined
        : {
            used: moved(file.used, from, to),
            kept: moved(file.kept, from, to),
            from: moved(file.from, from, to),
          },
    );
  }

  /** A skill was removed. */
  forget(id: string): Promise<void> {
    return this.#change((file) => ({
      used: without(file.used, id),
      kept: without(file.kept, id),
      from: without(file.from, id),
    }));
  }

  /** What's been sitting unused, among these skills. */
  async stale(
    skills: readonly Pick<Skill, 'id' | 'name' | 'title' | 'mode' | 'source' | 'problem'>[],
    days = SHELF_DAYS,
  ): Promise<ShelfSkill[]> {
    return stale(skills, await this.read(), this.now(), days);
  }
}
