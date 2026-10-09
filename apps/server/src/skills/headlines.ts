/**
 * Headlines for skills (ADR 0003 § Headlines): a long description in a few
 * words, for the skills list and the cards. Kept beside the skills
 * (`skill-headlines.json`), for exactly the description each was written
 * for, and never in a skill's own SKILL.md: that file is the skill's, signed
 * and read by every model, and stays as it is.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { needsHeadline, type Skill } from '@conch/protocol';
import { z } from 'zod';

import { Headliner, type HeadlinerDeps } from '../memory/headline';
import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

/** The most kept: a skill gone since takes its headline with it at the next write. */
const KEEP = 500;

const HeadlineFile = z.object({
  skills: z
    .record(z.string(), z.object({ of: z.string(), headline: z.string().min(1).max(80) }))
    .default({}),
});
type HeadlineFile = z.infer<typeof HeadlineFile>;

const hashOf = (text: string) =>
  createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('base64url').slice(0, 16);

export class SkillHeadlines {
  readonly #path: string;
  readonly #mutex = new Mutex();
  #cache: HeadlineFile | undefined;
  readonly headliner: Headliner;

  constructor(
    private readonly deps: {
      home: string;
      heal?: Heal;
      /** A headline was written: the list is worth reading again. */
      changed?: () => void;
    } & Omit<HeadlinerDeps, 'of' | 'save'>,
  ) {
    this.#path = join(deps.home, 'skill-headlines.json');
    this.headliner = new Headliner({
      ...deps,
      of: 'skill',
      save: (id, description, headline) => this.#put(id, description, headline),
    });
  }

  async #read(): Promise<HeadlineFile> {
    this.#cache ??= (
      await readStore(this.#path, HeadlineFile, {
        onRepair: () =>
          this.deps.heal?.('skills', 'Set aside damaged skill headlines; they’re written again'),
      }).catch(() => ({ value: HeadlineFile.parse({}) }))
    ).value;
    return this.#cache;
  }

  #put(id: string, description: string, headline: string): Promise<void> {
    return this.#mutex.run(async () => {
      const file = await this.#read();
      file.skills[id] = { of: hashOf(description), headline };
      const entries = Object.entries(file.skills);
      if (entries.length > KEEP) file.skills = Object.fromEntries(entries.slice(-KEEP));
      await writeJson(this.#path, file);
      this.deps.changed?.();
    });
  }

  /**
   * The skills as they're shown, each with its headline when there's one for
   * its description as it is now; any long one without is asked for, in the
   * background.
   */
  async fill<S extends Skill>(skills: readonly S[]): Promise<S[]> {
    const file = await this.#read();
    const missing: { key: string; text: string }[] = [];
    const out = skills.map((skill) => {
      const kept = file.skills[skill.id];
      if (kept && kept.of === hashOf(skill.description))
        return { ...skill, headline: kept.headline };
      if (needsHeadline(skill.description))
        missing.push({ key: skill.id, text: skill.description });
      return skill;
    });
    this.headliner.want(missing);
    return out;
  }
}
