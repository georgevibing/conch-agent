/**
 * Where artifacts live (ADR 0034): `~/.conch/artifacts/<id>/artifact.json`
 * (what it is and its versions) and `v<n>.<ext>` (each version, as it was).
 * A damaged `artifact.json` is set aside and rebuilt from the versions that
 * are still there, so nothing you made is lost to one bad write.
 */
import { mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  Artifact,
  ARTIFACT_FILES,
  ARTIFACT_MAX,
  ARTIFACT_VERSIONS,
  type ArtifactKind,
} from '@conch/protocol';

import { Mutex, safeJoin, syncFile, writeFileAtomic, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { readStore, type Heal } from '../lib/recover';

export class ArtifactError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'too-big' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

const versionFile = (kind: ArtifactKind, n: number) => `v${n}.${ARTIFACT_FILES[kind].ext}`;

/** A task's operation always names the same output, including across a crash. */
export const artifactOperationId = (conversationId: string, operationId: string) =>
  `a_${createHash('sha256')
    .update(JSON.stringify([conversationId, operationId]))
    .digest('hex')}`;

export class ArtifactStore {
  readonly dir: string;
  readonly #mutex = new Mutex();

  constructor(
    home: string,
    private readonly heal?: Heal,
  ) {
    this.dir = join(home, 'artifacts');
  }

  #folder(id: string) {
    return safeJoin(this.dir, id);
  }

  async #read(id: string): Promise<Artifact | undefined> {
    const folder = this.#folder(id);
    const exists = await stat(folder).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!exists) return undefined;
    const read = await readStore(join(folder, 'artifact.json'), Artifact.nullable(), {
      fallback: () => null,
      onRepair: () => this.heal?.('conversations', 'Rebuilt a damaged page from its versions'),
    });
    if (read.value) return read.value;
    return this.#rebuild(id);
  }

  /** From the versions on disk, when `artifact.json` is gone or damaged. */
  async #rebuild(id: string): Promise<Artifact | undefined> {
    const files = await readdir(this.#folder(id)).catch(() => [] as string[]);
    const versions = files
      .map((f) => /^v(\d+)\.([a-z]+)$/.exec(f))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => ({ n: Number(m[1]), ext: m[2] ?? '' }))
      .sort((a, b) => a.n - b.n);
    const first = versions[0];
    if (!first) return undefined;
    const kind = (Object.entries(ARTIFACT_FILES).find(([, f]) => f.ext === first.ext)?.[0] ??
      'markdown') as ArtifactKind;
    const now = Date.now();
    const artifact: Artifact = {
      id,
      title: 'Untitled',
      kind,
      conversationId: '',
      createdAt: now,
      updatedAt: now,
      versions: versions.map((v) => ({ n: v.n, at: now, size: 0 })),
    };
    await writeJson(join(this.#folder(id), 'artifact.json'), artifact);
    return artifact;
  }

  async get(id: string): Promise<Artifact> {
    const found = await this.#read(id);
    if (!found) throw new ArtifactError('not-found', 'That isn’t here any more.');
    return found;
  }

  async list(): Promise<Artifact[]> {
    const ids = await readdir(this.dir).catch(() => [] as string[]);
    const all = await Promise.all(
      ids
        .filter((id) => /^a_[A-Za-z0-9]+$/.test(id))
        .map((id) => this.#read(id).catch(() => undefined)),
    );
    return all.filter((a): a is Artifact => Boolean(a)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async content(
    id: string,
    n?: number,
  ): Promise<{ artifact: Artifact; n: number; content: string }> {
    const artifact = await this.get(id);
    const version = n ?? artifact.versions.at(-1)?.n ?? 1;
    if (!artifact.versions.some((v) => v.n === version))
      throw new ArtifactError('not-found', 'That version isn’t kept any more.');
    const content = await readFile(
      join(this.#folder(id), versionFile(artifact.kind, version)),
      'utf8',
    ).catch(() => {
      throw new ArtifactError('not-found', 'That version’s file is missing.');
    });
    return { artifact, n: version, content };
  }

  /** A new artifact, at version 1. */
  async create(input: {
    title: string;
    kind: ArtifactKind;
    content: string;
    conversationId: string;
    note?: string;
    refresh?: string;
    navigates?: boolean;
    operationId?: string;
  }): Promise<Artifact> {
    if (input.content.length > ARTIFACT_MAX)
      throw new ArtifactError(
        'too-big',
        `That’s more than ${ARTIFACT_MAX.toLocaleString('en')} characters.`,
      );
    return this.#mutex.run(async () => {
      const id = input.operationId
        ? artifactOperationId(input.conversationId, input.operationId)
        : newId('a');
      if (input.operationId) {
        const existing = await this.#read(id);
        if (existing) {
          const saved = await this.content(id, 1);
          if (
            existing.conversationId !== input.conversationId ||
            existing.kind !== input.kind ||
            existing.title !== input.title ||
            saved.content !== input.content
          )
            throw new ArtifactError(
              'invalid',
              'This operation already saved a different document. Review it before trying again.',
            );
          return existing;
        }
      }
      const folder = this.#folder(id);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const now = Date.now();
      await writeFileAtomic(join(folder, versionFile(input.kind, 1)), input.content);
      const artifact: Artifact = {
        id,
        title: input.title,
        kind: input.kind,
        conversationId: input.conversationId,
        createdAt: now,
        updatedAt: now,
        versions: [
          {
            n: 1,
            at: now,
            size: input.content.length,
            ...(input.note && { note: input.note }),
            ...(input.navigates && { navigates: true }),
          },
        ],
        ...(input.refresh && { refresh: { prompt: input.refresh } }),
        ...(input.navigates && { navigates: true }),
      };
      await writeJson(join(folder, 'artifact.json'), artifact);
      if (input.operationId) {
        // Only a durable result can support a durable completion receipt.
        for (const path of [
          join(folder, versionFile(input.kind, 1)),
          join(folder, 'artifact.json'),
        ]) {
          await syncFile(path);
        }
        if (process.platform !== 'win32') {
          for (const path of [folder, this.dir]) {
            const directory = await open(path, 'r');
            try {
              await directory.sync();
            } finally {
              await directory.close();
            }
          }
        }
      }
      return artifact;
    });
  }

  /** A new version. Old ones go past the limit; the first always stays. */
  async addVersion(
    id: string,
    input: {
      content: string;
      note?: string;
      refreshed?: boolean;
      navigates?: boolean;
      edited?: boolean;
      /** Only if the newest version is still this one (`conflict` otherwise). */
      base?: number;
    },
  ): Promise<Artifact> {
    if (input.content.length > ARTIFACT_MAX)
      throw new ArtifactError(
        'too-big',
        `That’s more than ${ARTIFACT_MAX.toLocaleString('en')} characters.`,
      );
    return this.#mutex.run(async () => {
      const artifact = await this.get(id);
      const latest = artifact.versions.at(-1)?.n ?? 0;
      if (input.base !== undefined && input.base !== latest)
        throw new ArtifactError(
          'conflict',
          `It changed while you were editing: version ${latest} is newer than the one you started from.`,
        );
      const n = latest + 1;
      const folder = this.#folder(id);
      await writeFileAtomic(join(folder, versionFile(artifact.kind, n)), input.content);
      const now = Date.now();
      let versions = [
        ...artifact.versions,
        {
          n,
          at: now,
          size: input.content.length,
          ...(input.note && { note: input.note }),
          ...(input.refreshed && { refreshed: true }),
          ...(input.navigates && { navigates: true }),
          ...(input.edited && { edited: true }),
        },
      ];
      while (versions.length > ARTIFACT_VERSIONS) {
        const gone = versions[1];
        if (!gone) break;
        versions = [versions[0] as (typeof versions)[number], ...versions.slice(2)];
        await rm(join(folder, versionFile(artifact.kind, gone.n)), { force: true });
      }
      const next: Artifact = {
        ...artifact,
        versions,
        updatedAt: now,
        navigates: input.navigates ? true : undefined,
      };
      if (!next.navigates) delete next.navigates;
      await writeJson(join(folder, 'artifact.json'), next);
      return next;
    });
  }

  update(id: string, patch: (a: Artifact) => Artifact): Promise<Artifact> {
    return this.#mutex.run(async () => {
      const next = Artifact.parse(patch(await this.get(id)));
      await writeJson(join(this.#folder(id), 'artifact.json'), next);
      return next;
    });
  }

  remove(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      await this.get(id);
      await rm(this.#folder(id), { recursive: true, force: true });
    });
  }
}
