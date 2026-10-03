import { cp, lstat, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';

import {
  Id,
  SkillMode,
  SkillName,
  type Skill,
  type SkillCapability,
  type SkillDetail,
  type SkillProblemKind,
  type SkillReview,
  type SkillSource,
  type SkillSourceInfo,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, safeJoin, writeFileAtomic, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import { humanize, slugify } from './draft';
import { permissionsValue, readPermissions } from './permissions';
import { folderSignature, scanSkill } from './scan';
import { checkSignature, SIG_FILE } from './signing';
import type { SkillTrust } from './trust';
import {
  joinSkill,
  readFlag,
  readKey,
  setKeys,
  splitSkill,
  splitTitle,
  withTitle,
} from './frontmatter';

/** A folder Conch looks for skills in. */
export interface SkillRoot {
  source: SkillSource;
  label: string;
  dir: string;
  /** How many folder levels hold skills (OpenClaw and Hermes allow a category level). */
  depth: 1 | 2;
}

/** Bigger than any sensible skill; a larger file isn't read. */
export const SKILL_FILE_MAX = 256 * 1024;
/** A file a skill points to, read through `use_skill`. */
export const RESOURCE_FILE_MAX = 128 * 1024;
const PER_SOURCE_MAX = 500;
const FILES_LISTED_MAX = 40;

export const SOURCE_LABELS: Record<SkillSource, string> = {
  conch: 'Conch',
  agents: 'Shared agent skills',
  claude: 'Claude Code',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
};

/** Where other agents keep their skills (ADR 0013). Conch reads them; it never writes there. */
export function externalRoots(home = homedir()): SkillRoot[] {
  return [
    {
      source: 'agents',
      label: SOURCE_LABELS.agents,
      dir: join(home, '.agents', 'skills'),
      depth: 1,
    },
    {
      source: 'claude',
      label: SOURCE_LABELS.claude,
      dir: join(home, '.claude', 'skills'),
      depth: 1,
    },
    {
      source: 'openclaw',
      label: SOURCE_LABELS.openclaw,
      dir: join(home, '.openclaw', 'skills'),
      depth: 2,
    },
    {
      source: 'openclaw',
      label: SOURCE_LABELS.openclaw,
      dir: join(home, '.openclaw', 'workspace', 'skills'),
      depth: 2,
    },
    {
      source: 'hermes',
      label: SOURCE_LABELS.hermes,
      dir: join(home, '.hermes', 'skills'),
      depth: 2,
    },
  ];
}

export class SkillError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'read-only' | 'needs-review',
    message: string,
  ) {
    super(message);
  }
}

/** A skill as the store knows it: what the browser sees, plus where the file is. */
export interface LoadedSkill extends Skill {
  file: string;
  /** From the file (`disable-model-invocation`), before any choice made in Conch. */
  fileMode: 'auto' | 'manual';
  /** The signing key, when its signature holds: what "Trust this publisher" trusts. */
  signerKey?: string;
}

const ModesFile = z.object({
  /** Choices made in Conch that the skill's own file doesn't hold. */
  modes: z.record(z.string(), SkillMode).default({}),
  /**
   * Another app's skill, as it was when you turned it on (ADR 0028): if any
   * file in it changes, it's off again until you look at what it says now.
   */
  pins: z
    .record(
      z.string(),
      z.object({
        hash: z.string(),
        at: z.number(),
        /** Signed by a publisher you trust when turned on: its signed updates carry on (ADR 0031). */
        publisher: z.string().optional(),
      }),
    )
    .default({}),
  /** Skills Conch found worrying that you looked at and turned on anyway, as they were then. */
  acks: z.record(z.string(), z.string()).default({}),
});

const exists = (path: string) =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );

/**
 * Skills on disk: Conch's own (`~/.conch/skills/<name>/SKILL.md`, editable)
 * and those in other agents' folders (read-only here). Nothing is cached for
 * long — a folder can change behind our back — but a scan is a few `readdir`s.
 */
export class SkillStore {
  readonly dir: string;
  #mutex = new Mutex();
  #cache?: { at: number; skills: LoadedSkill[]; sources: SkillSourceInfo[] };

  constructor(
    home: string,
    private readonly external: SkillRoot[] = [],
    /** Folders a connected provider reads by itself, and who that is. */
    private readonly nativelyLoaded: () => Map<SkillSource, string> = () => new Map(),
    private readonly heal?: Heal,
    /** Whose signatures you trust (ADR 0031). Without it, every signed skill is "untrusted". */
    private readonly trust?: SkillTrust,
  ) {
    this.dir = join(home, 'skills');
    this.#modesPath = join(home, 'skills.json');
  }

  readonly #modesPath: string;

  get roots(): SkillRoot[] {
    return [
      { source: 'conch', label: SOURCE_LABELS.conch, dir: this.dir, depth: 1 },
      ...this.external,
    ];
  }

  /** Forget the last scan (after a change here, or when asked to look again). */
  invalidate() {
    this.#cache = undefined;
  }

  async list(options: { fresh?: boolean } = {}) {
    if (!options.fresh && this.#cache && Date.now() - this.#cache.at < 2_000) return this.#cache;
    const { modes, pins, acks } = await this.#choices();
    const publishers = (await this.trust?.list().catch(() => undefined)) ?? [];
    const trusted = new Set(publishers.map((p) => p.fingerprint));
    const trustedNames = new Set(publishers.map((p) => p.name.trim().toLowerCase()));
    const native = this.nativelyLoaded();
    const skills: LoadedSkill[] = [];
    const sources: SkillSourceInfo[] = [];
    const ids = new Set<string>();
    for (const root of this.roots) {
      const found = await exists(root.dir);
      const folders = found ? await this.#scan(root.dir, root.depth) : [];
      let count = 0;
      for (const folder of folders) {
        const skill = await this.#load(
          root,
          folder,
          { modes, pins, acks },
          ids,
          native.get(root.source),
          { fingerprints: trusted, names: trustedNames },
        );
        if (!skill) continue;
        skills.push(skill);
        ids.add(skill.id);
        count++;
      }
      const same = sources.find((s) => s.id === root.source);
      if (same) {
        same.count += count;
        same.found ||= found;
      } else {
        sources.push({ id: root.source, label: root.label, path: root.dir, found, count });
      }
    }
    skills.sort(
      (a, b) =>
        Number(b.source === 'conch') - Number(a.source === 'conch') ||
        a.title.localeCompare(b.title),
    );
    this.#cache = { at: Date.now(), skills, sources };
    return this.#cache;
  }

  async get(id: string): Promise<LoadedSkill> {
    const skill = (await this.list()).skills.find((s) => s.id === id);
    if (!skill) throw new SkillError('not-found', 'That skill isn’t there any more.');
    return skill;
  }

  /** Find a usable skill by its name, as typed after a slash. Conch's own win. */
  async byName(name: string): Promise<LoadedSkill | undefined> {
    const lower = name.toLowerCase();
    return (await this.list()).skills.find(
      (s) => s.name.toLowerCase() === lower && s.mode !== 'off' && !s.problem,
    );
  }

  async detail(id: string): Promise<SkillDetail> {
    const skill = await this.get(id);
    const { body } = await this.#read(skill.file);
    const { instructions } = splitTitle(body);
    return { ...publicSkill(skill), instructions };
  }

  /** The instructions to follow, with the folder filled in where the skill asks for it. */
  async instructions(skill: LoadedSkill): Promise<string> {
    const { body } = await this.#read(skill.file);
    return fillPlaceholders(splitTitle(body).instructions, skill.path);
  }

  /** One of a skill's own files, as text. Only inside its folder; symlinks can't lead out. */
  async resource(skill: LoadedSkill, file: string): Promise<string> {
    const root = await realpath(skill.path);
    const target = resolve(root, file);
    if (relative(root, target).startsWith('..') || !target.startsWith(root + sep))
      throw new SkillError('invalid', `“${file}” isn’t in this skill’s folder.`);
    let real: string;
    try {
      real = await realpath(target);
    } catch {
      throw new SkillError('not-found', `This skill has no file called “${file}”.`);
    }
    if (!real.startsWith(root + sep))
      throw new SkillError('invalid', `“${file}” isn’t in this skill’s folder.`);
    const info = await stat(real);
    if (!info.isFile()) throw new SkillError('invalid', `“${file}” isn’t a file.`);
    if (info.size > RESOURCE_FILE_MAX)
      throw new SkillError('invalid', `“${file}” is too big to read here (over 128 KB).`);
    const text = await readFile(real, 'utf8');
    if (text.includes('\0')) throw new SkillError('invalid', `“${file}” isn’t a text file.`);
    return fillPlaceholders(text, skill.path);
  }

  // ── Changing Conch's own skills ─────────────────────────────────────────

  /** A name no other Conch skill has: `base`, else `base-2`, `base-3`… */
  async freeName(base: string): Promise<string> {
    const taken = new Set(
      (await this.list({ fresh: true })).skills
        .filter((s) => s.source === 'conch')
        .map((s) => s.name),
    );
    const root = SkillName.safeParse(base).success ? base : slugify(base);
    let name = root;
    for (let n = 2; taken.has(name) || (await exists(join(this.dir, name))); n++)
      name = `${root.slice(0, 60)}-${n}`;
    return name;
  }

  create(input: {
    name: string;
    title: string;
    description: string;
    instructions: string;
    mode: 'auto' | 'manual' | 'off';
    /** What it says it may do (ADR 0031); unset says nothing. */
    permissions?: { capabilities: SkillCapability[]; commands?: string[]; apps?: string[] };
  }): Promise<LoadedSkill> {
    return this.#mutex.run(async () => {
      const name = SkillName.parse(input.name);
      const folder = safeJoin(this.dir, name);
      if (await exists(folder))
        throw new SkillError('invalid', `There’s already a skill called ${name}.`);
      const front = setKeys(undefined, [
        ['name', name],
        ['description', input.description],
        ['disable-model-invocation', input.mode === 'manual' ? true : undefined],
        ['permissions', input.permissions ? permissionsValue(input.permissions) : undefined],
      ]);
      await writeFileAtomic(
        join(folder, 'SKILL.md'),
        joinSkill({ front, body: withTitle(input.title, input.instructions) }),
        0o600,
      );
      if (input.mode === 'off') await this.#setMode(name, 'off');
      this.invalidate();
      return this.get(name);
    });
  }

  update(
    id: string,
    patch: {
      title?: string;
      description?: string;
      instructions?: string;
      name?: string;
      mode?: 'auto' | 'manual' | 'off';
      acknowledged?: string;
    },
  ): Promise<LoadedSkill> {
    return this.#mutex.run(async () => {
      let skill = await this.get(id);
      if (!skill.editable) {
        // Only the mode of someone else's skill is ours to keep.
        const { acknowledged, ...rest } = patch;
        if (rest.mode && Object.keys(rest).length === 1) {
          // On, as it is right now: if it changes later, it's off again (ADR 0028).
          const review =
            (await this.#checkReviewed(skill, rest.mode, acknowledged)) ??
            (await scanSkill(skill.path));
          await this.#setMode(
            skill.id,
            rest.mode,
            review.hash,
            review.verdict === 'danger' ? acknowledged : undefined,
            skill.signature?.state === 'verified' ? skill.signature.fingerprint : undefined,
          );
          this.invalidate();
          return this.get(skill.id);
        }
        throw new SkillError(
          'read-only',
          `${skill.sourceLabel} owns this skill. Make a copy to change it.`,
        );
      }
      if (patch.name && patch.name !== skill.name) {
        const name = SkillName.parse(patch.name);
        const to = safeJoin(this.dir, name);
        if (await exists(to))
          throw new SkillError('invalid', `There’s already a skill called ${name}.`);
        await rename(skill.path, to);
        const modes = await this.#modes();
        if (modes[skill.id]) {
          await this.#setMode(name, modes[skill.id]);
          await this.#setMode(skill.id, undefined);
        }
        this.invalidate();
        skill = await this.get(name);
      }
      const reviewed = await this.#checkReviewed(skill, patch.mode, patch.acknowledged);
      const file = await this.#read(skill.file);
      const current = splitTitle(file.body);
      const title = patch.title ?? current.title ?? skill.title;
      const instructions = patch.instructions ?? current.instructions;
      const mode = patch.mode ?? skill.mode;
      // A skill of ours is named after its folder, as the standard asks.
      const front = setKeys(file.front, [
        ['name', basename(skill.path)],
        ...(patch.description !== undefined
          ? [['description', patch.description] as [string, string]]
          : []),
        ...(patch.mode !== undefined && mode !== 'off'
          ? [
              ['disable-model-invocation', mode === 'manual' ? true : undefined] as [
                string,
                true | undefined,
              ],
            ]
          : []),
      ]);
      // Only a new title or new instructions rewrite the body; anything else
      // (a description, the mode) leaves what the person wrote exactly as it was.
      const body =
        patch.title === undefined && patch.instructions === undefined
          ? file.body
          : withTitle(title, instructions);
      await writeFileAtomic(skill.file, joinSkill({ front, body }), 0o600);
      if (patch.mode !== undefined)
        await this.#setMode(
          skill.id,
          mode === 'off' ? 'off' : undefined,
          undefined,
          // The OK holds for the file as it is now that it's written.
          reviewed?.verdict === 'danger' ? (await scanSkill(skill.path)).hash : undefined,
        );
      this.invalidate();
      return this.get(skill.id);
    });
  }

  remove(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      const skill = await this.get(id);
      if (!skill.editable)
        throw new SkillError('read-only', `${skill.sourceLabel} owns this skill; remove it there.`);
      await rm(safeJoin(this.dir, basename(skill.path)), { recursive: true, force: true });
      await this.#setMode(skill.id, undefined);
      this.invalidate();
    });
  }

  /** Copy another agent's skill into Conch's folder, where it can be changed. */
  async copy(id: string): Promise<LoadedSkill> {
    const skill = await this.get(id);
    const name = await this.freeName(slugify(skill.name));
    return this.#mutex.run(async () => {
      const to = safeJoin(this.dir, name);
      await cp(skill.path, to, {
        recursive: true,
        // Copy what links point to, never the links: a copy mustn't reach back out.
        dereference: true,
        // Dot-files (a `.git`, an editor's swap file) stay behind.
        filter: (from) =>
          !relative(skill.path, from)
            .split(sep)
            .some((part) => part.startsWith('.')),
      });
      const file = await this.#read(join(to, 'SKILL.md'));
      await writeFileAtomic(
        join(to, 'SKILL.md'),
        joinSkill({ front: setKeys(file.front, [['name', name]]), body: file.body }),
        0o600,
      );
      this.invalidate();
      return this.get(name);
    });
  }

  /**
   * Bring a skill folder from another agent in as one of Conch's own (ADR
   * 0035), Off until you turn it on. Only regular files come over — never a
   * link, never a dot-file — and at most 200 files and 10 MB.
   */
  async adopt(folder: string, base: string): Promise<LoadedSkill> {
    const name = await this.freeName(slugify(base) || 'imported-skill');
    return this.#mutex.run(async () => {
      const to = safeJoin(this.dir, name);
      let files = 0;
      let bytes = 0;
      await cp(folder, to, {
        recursive: true,
        // A link is skipped, not followed: a skill mustn't carry your files in with it.
        verbatimSymlinks: true,
        filter: async (from) => {
          if (
            relative(folder, from)
              .split(sep)
              .some((part) => part.startsWith('.'))
          )
            return false;
          const info = await lstat(from);
          if (info.isSymbolicLink()) return false;
          if (info.isFile()) {
            files += 1;
            bytes += info.size;
            if (files > 200 || bytes > 10 * 1024 * 1024) return false;
          }
          return true;
        },
      });
      const file = await this.#read(join(to, 'SKILL.md'));
      await writeFileAtomic(
        join(to, 'SKILL.md'),
        joinSkill({ front: setKeys(file.front, [['name', name]]), body: file.body }),
        0o600,
      );
      await this.#setMode(name, 'off');
      this.invalidate();
      return this.get(name);
    });
  }

  // ── Internals ───────────────────────────────────────────────────────────

  async #read(file: string): Promise<{ front: string | undefined; body: string }> {
    const info = await stat(file);
    if (info.size > SKILL_FILE_MAX) throw new SkillError('invalid', 'SKILL.md is too big to read.');
    return splitSkill(await readFile(file, 'utf8'));
  }

  /** Folders that hold a SKILL.md, up to `depth` levels down. Dot-folders are skipped. */
  async #scan(dir: string, depth: number): Promise<string[]> {
    const out: string[] = [];
    const visit = async (at: string, level: number) => {
      let entries;
      try {
        entries = await readdir(at, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (out.length >= PER_SOURCE_MAX) return;
        if (entry.name.startsWith('.')) continue;
        const path = join(at, entry.name);
        if (!entry.isDirectory() && !(entry.isSymbolicLink() && (await exists(path)))) continue;
        if (
          await stat(join(path, 'SKILL.md')).then(
            (s) => s.isFile(),
            () => false,
          )
        )
          out.push(path);
        else if (level < depth) await visit(path, level + 1);
      }
    };
    await visit(dir, 1);
    return out;
  }

  async #load(
    root: SkillRoot,
    folder: string,
    choices: z.infer<typeof ModesFile>,
    taken: Set<string>,
    loadedBy: string | undefined,
    trusted: { fingerprints: ReadonlySet<string>; names: ReadonlySet<string> },
  ): Promise<LoadedSkill | undefined> {
    const file = join(folder, 'SKILL.md');
    const folderName = folder.slice(folder.lastIndexOf(sep) + 1);
    let parsed: { front: string | undefined; body: string } = { front: undefined, body: '' };
    let problem: string | undefined;
    let problemKind: SkillProblemKind | undefined;
    let updatedAt = Date.now();
    try {
      const info = await lstat(file);
      updatedAt = info.mtimeMs;
      parsed = await this.#read(file);
    } catch (error) {
      problem =
        error instanceof SkillError ? error.message : 'Conch couldn’t read this skill’s SKILL.md.';
      problemKind = 'unreadable';
    }
    const name = readKey(parsed.front, 'name')?.trim() || folderName;
    const description = readKey(parsed.front, 'description')?.replace(/\s+/g, ' ').trim() ?? '';
    if (!problem && parsed.front === undefined) {
      problem = 'Its SKILL.md has no front matter (the --- block with a name and description).';
      problemKind = 'no-front-matter';
    } else if (!problem && !description) {
      problem = 'It has no description, so an assistant wouldn’t know when to use it.';
      problemKind = 'no-description';
    }
    const { title } = splitTitle(parsed.body);
    const fileMode = readFlag(parsed.front, 'disable-model-invocation') ? 'manual' : 'auto';

    const id = uniqueId(
      root.source === 'conch' ? folderName : `${root.source}_${folderName}`,
      taken,
    );
    if (!id) return undefined;
    const { modes, pins, acks } = choices;
    const chosen = modes[id];
    // Skills found in other apps start Off: a folder appearing on disk mustn't start steering chats.
    let mode = chosen ?? (root.source === 'conch' ? fileMode : 'off');
    // Read through before it steers anything, and held to what you turned on (ADR 0028).
    const review = await this.#review(folder);
    const pin = pins[id];
    // Who made it, provably (ADR 0031): a signature that doesn't hold turns it off.
    const signature = await this.#signature(folder, name, trusted.fingerprints);
    const lookalike =
      signature.state === 'untrusted' &&
      trusted.names.has((signature.publisher ?? '').trim().toLowerCase());
    const followsPublisher =
      signature.state === 'verified' &&
      pin?.publisher !== undefined &&
      pin.publisher === signature.fingerprint;
    if (signature.state === 'invalid') {
      mode = 'off';
      problem ??= `${signature.problem ?? 'Its signature doesn’t hold.'} It’s off so it can’t steer anything.`;
      problemKind ??= 'bad-signature';
    } else if (review.verdict === 'danger' && acks[id] !== review.hash) {
      // Worrying, and nobody has looked: never offered to an assistant until someone does.
      mode = 'off';
      const first = review.findings.find((f) => f.severity === 'danger');
      problem ??= `Conch found something worrying in it: ${first?.message.charAt(0).toLowerCase()}${first?.message.slice(1) ?? ''} Look at it before turning it on.`;
      problemKind ??= 'needs-review';
    } else if (
      root.source !== 'conch' &&
      mode !== 'off' &&
      pin &&
      pin.hash !== review.hash &&
      // An update signed by the publisher you trusted when you turned it on carries on.
      !followsPublisher
    ) {
      mode = 'off';
      problem ??= `It changed in ${root.label} since you turned it on, so it’s off until you look at it again.`;
      problemKind ??= 'changed';
    }
    return {
      id,
      name,
      title: title?.slice(0, 80) || humanize(name),
      description,
      source: root.source,
      sourceLabel: root.label,
      editable: root.source === 'conch' && SkillName.safeParse(folderName).success,
      mode,
      path: folder,
      files: await listFiles(folder),
      ...(loadedBy && { loadedBy }),
      ...(problem && { problem }),
      ...(problemKind && { problemKind }),
      updatedAt,
      review,
      permissions: readPermissions(parsed.front),
      signature: {
        state: signature.state,
        ...(signature.publisher && { publisher: signature.publisher }),
        ...(signature.fingerprint && { fingerprint: signature.fingerprint }),
        ...(signature.problem && { problem: signature.problem }),
        ...(lookalike && { lookalike }),
      },
      ...(signature.key && { signerKey: signature.key }),
      file,
      fileMode,
    };
  }

  readonly #signatures = new Map<
    string,
    { key: string; signature: Awaited<ReturnType<typeof checkSignature>> }
  >();

  /** A folder's signature, checked again only when a file in it or whom you trust changed. */
  async #signature(folder: string, name: string, trusted: ReadonlySet<string>) {
    const key = `${await folderSignature(folder, { withSignature: true })}|${name}|${[...trusted].sort().join(',')}`;
    const cached = this.#signatures.get(folder);
    if (cached?.key === key) return cached.signature;
    const signature = await checkSignature(folder, name, trusted);
    this.#signatures.set(folder, { key, signature });
    return signature;
  }

  readonly #reviews = new Map<string, { signature: string; review: SkillReview }>();

  /** The review of a folder, read again only when a file in it changed. */
  async #review(folder: string): Promise<SkillReview> {
    const signature = await folderSignature(folder);
    const cached = this.#reviews.get(folder);
    if (cached?.signature === signature) return cached.review;
    const review = await scanSkill(folder);
    this.#reviews.set(folder, { signature, review });
    return review;
  }

  /**
   * Choices made in Conch. A damaged file goes back to each skill's own
   * default: off for other agents' skills, so nothing new starts loading.
   */
  async #modes(): Promise<Record<string, SkillMode>> {
    return (await this.#choices()).modes;
  }

  async #choices(): Promise<z.infer<typeof ModesFile>> {
    const read = await readStore(this.#modesPath, ModesFile, {
      onRepair: (state) =>
        this.heal?.(
          'skills',
          state === 'salvaged'
            ? 'Some of your choices of which skills are on couldn’t be read, so Conch kept a copy and reset just those.'
            : 'Your choices of which skills are on couldn’t be read, so Conch kept a copy and went back to each skill’s default.',
        ),
    });
    return read.value;
  }

  /**
   * Remember a mode. Turning another app's skill on pins it as it is now
   * (`hash`); turning it off lets the pin go, and any OK given to a worrying
   * one (`acknowledged`), so turning it on again means looking again.
   */
  async #setMode(
    id: string,
    mode: SkillMode | undefined,
    hash?: string,
    acknowledged?: string,
    publisher?: string,
  ) {
    const { modes, pins, acks } = await this.#choices();
    const { [id]: _previous, ...others } = modes;
    const { [id]: _pin, ...otherPins } = pins;
    const { [id]: _ack, ...otherAcks } = acks;
    const on = mode !== 'off';
    await writeJson(this.#modesPath, {
      modes: mode === undefined ? others : { ...others, [id]: mode },
      pins:
        on && mode && hash
          ? { ...otherPins, [id]: { hash, at: Date.now(), ...(publisher && { publisher }) } }
          : otherPins,
      acks: !on ? otherAcks : acknowledged ? { ...otherAcks, [id]: acknowledged } : acks,
    });
  }

  /**
   * Turning on a skill Conch found worrying needs its review's hash: proof
   * the person saw what it does, for exactly this version (ADR 0028).
   */
  async #checkReviewed(skill: LoadedSkill, mode: SkillMode | undefined, acknowledged?: string) {
    if (!mode || mode === 'off') return undefined;
    // What's in it isn't what was signed: nothing turns it on but a new signature (ADR 0031).
    if (skill.signature?.state === 'invalid')
      throw new SkillError(
        'needs-review',
        `${skill.signature.problem ?? 'Its signature doesn’t hold.'} Get it again from whoever made it.`,
      );
    const review = await scanSkill(skill.path);
    if (review.verdict !== 'danger') return review;
    if (acknowledged !== review.hash)
      throw new SkillError(
        'needs-review',
        'Conch found something worrying in this skill. Look at what it found, then turn it on if you still want it.',
      );
    return review;
  }

  /** Remember a mode for a skill Conch doesn't own, or turn one of ours off. */
  setMode(id: string, mode: SkillMode, acknowledged?: string) {
    return this.#mutex.run(async () => {
      const skill = (await this.list()).skills.find((s) => s.id === id);
      const review = skill ? await this.#checkReviewed(skill, mode, acknowledged) : undefined;
      const hash =
        skill && skill.source !== 'conch'
          ? (review ?? (await scanSkill(skill.path))).hash
          : undefined;
      await this.#setMode(
        id,
        mode,
        hash,
        review?.verdict === 'danger' ? acknowledged : undefined,
        skill?.signature?.state === 'verified' ? skill.signature.fingerprint : undefined,
      );
      this.invalidate();
    });
  }
}

/** An id that is safe on the wire and in a URL, and unique in this list. */
function uniqueId(base: string, taken: Set<string>): string | undefined {
  const clean = base
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, 100);
  if (!clean) return undefined;
  let id = clean;
  for (let n = 2; taken.has(id); n++) id = `${clean}-${n}`;
  return Id.safeParse(id).success ? id : undefined;
}

/** Other files in a skill's folder, relative with forward slashes, two levels deep. */
async function listFiles(folder: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (at: string, prefix: string, level: number) => {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= FILES_LISTED_MAX) return;
      if (entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (level < 3) await visit(join(at, entry.name), rel, level + 1);
      } else if (rel !== 'SKILL.md' && rel !== SIG_FILE) out.push(rel); // A signature is about the skill, not in it.
    }
  };
  await visit(folder, '', 1);
  return out;
}

/** The placeholders OpenClaw, Hermes and Claude Code use for a skill's own folder. */
export function fillPlaceholders(text: string, dir: string): string {
  return text
    .replaceAll('{baseDir}', dir)
    .replaceAll('${HERMES_SKILL_DIR}', dir)
    .replaceAll('${CLAUDE_SKILL_DIR}', dir)
    .replaceAll('${SKILL_DIR}', dir);
}

/** What the browser may see: everything but where the file is. */
export function publicSkill(skill: LoadedSkill): Skill {
  const { file: _file, fileMode: _fileMode, signerKey: _signerKey, ...rest } = skill;
  return rest;
}
