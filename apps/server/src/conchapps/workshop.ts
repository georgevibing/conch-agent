/**
 * Apps being made (ADR 0061 §4): each draft is a folder in
 * `CONCH_HOME/app-workshop/<draftId>/` — its files (`files/…`), what Conch
 * knows about it (`draft.json`), and scratch data for `app_try` (`data/`,
 * never shipped). Drafts are written only through the maker's tools, so they
 * work the same with every provider, and each belongs to one chat.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import {
  APP_LIMITS,
  APP_PICTURES,
  AppId,
  type AppPictureName,
  ConchAppCheck,
  Id,
  isAppPicture,
} from '@conch/protocol';
import { z } from 'zod';

import { newId } from '../lib/ids';
import { Mutex, readJson, removeTree, safeJoin, writeJson } from '../lib/fs';
import { describePicture, picturesIn, readPicture } from './picture';
import { folderBytes, pathIn, writeFiles } from './store';
import type { AppFiles } from './types';

const DraftFile = z.object({
  id: z.string(),
  conversationId: z.string(),
  /** The app it changes, when it's a change to one you have. */
  appId: AppId.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** The last check, for the exact files it looked at (`check.hash`). */
  check: ConchAppCheck.optional(),
  /** Tools `app_try` ran without throwing, per set of files (hash → tools). */
  tried: z.record(z.string(), z.array(z.string())).default({}),
});
export type DraftInfo = z.infer<typeof DraftFile>;

export class WorkshopError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid' | 'too-big',
    message: string,
  ) {
    super(message);
  }
}

/** Drafts with no chat left are tidied after this long. */
export const ORPHAN_MS = 30 * 24 * 60 * 60_000;

const SIG = 'conch-app.sig';

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

export class Workshop {
  readonly root: string;
  #mutex = new Mutex();

  constructor(home: string) {
    this.root = join(home, 'app-workshop');
  }

  #dir(draftId: string) {
    if (!Id.safeParse(draftId).success)
      throw new WorkshopError('not-found', 'There’s no draft with that id.');
    return safeJoin(this.root, draftId);
  }

  filesDir(draftId: string) {
    return join(this.#dir(draftId), 'files');
  }

  dataDir(draftId: string) {
    return join(this.#dir(draftId), 'data');
  }

  async info(draftId: string): Promise<DraftInfo> {
    const raw = await readJson<unknown>(join(this.#dir(draftId), 'draft.json')).catch(
      () => undefined,
    );
    const parsed = DraftFile.safeParse(raw);
    if (!parsed.success) throw new WorkshopError('not-found', 'There’s no draft with that id.');
    return parsed.data;
  }

  async #save(info: DraftInfo) {
    await writeJson(join(this.#dir(info.id), 'draft.json'), DraftFile.parse(info));
  }

  /** Change what's known about a draft. */
  patch(draftId: string, fn: (info: DraftInfo) => void): Promise<DraftInfo> {
    return this.#mutex.run(async () => {
      const info = await this.info(draftId);
      fn(info);
      await this.#save(info);
      return info;
    });
  }

  async all(): Promise<DraftInfo[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    const out: DraftInfo[] = [];
    for (const entry of entries)
      if (entry.isDirectory()) {
        const info = await this.info(entry.name).catch(() => undefined);
        if (info) out.push(info);
      }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** A chat's drafts, newest first. */
  async ofChat(conversationId: string): Promise<DraftInfo[]> {
    return (await this.all()).filter((d) => d.conversationId === conversationId);
  }

  /** A new draft with these files. */
  create(input: { conversationId: string; appId?: string; files: AppFiles }): Promise<DraftInfo> {
    return this.#mutex.run(async () => {
      limits(input.files);
      const id = newId('draft');
      const dir = this.#dir(id);
      await writeFiles(join(dir, 'files'), input.files);
      await mkdir(join(dir, 'data'), { recursive: true, mode: 0o700 });
      const now = Date.now();
      const info: DraftInfo = {
        id,
        conversationId: input.conversationId,
        ...(input.appId && { appId: input.appId }),
        createdAt: now,
        updatedAt: now,
        tried: {},
      };
      await this.#save(info);
      return info;
    });
  }

  /** Every file in a draft, by path, as bytes. */
  async files(draftId: string): Promise<Map<string, Buffer>> {
    const base = this.filesDir(draftId);
    const out = new Map<string, Buffer>();
    const visit = async (dir: string, rel: string) => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(join(dir, entry.name), path);
        else if (entry.isFile()) out.set(path, await readFile(join(dir, entry.name)));
      }
    };
    await visit(base, '');
    return out;
  }

  /** Write one file, held to the package's limits as it's written. */
  write(draftId: string, path: string, content: string | Buffer): Promise<DraftInfo> {
    return this.#mutex.run(async () => {
      const info = await this.info(draftId);
      if (path === SIG)
        throw new WorkshopError(
          'invalid',
          'conch-app.sig is written by Conch when the app is shared; leave it out.',
        );
      let target: string;
      try {
        target = pathIn(this.filesDir(draftId), path);
      } catch {
        throw new WorkshopError(
          'invalid',
          `“${path}” isn’t a path Conch can keep in an app. Use a path inside the app’s folder with letters, numbers, dashes and dots, like pages/main.html.`,
        );
      }
      const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
      if (isAppPicture(path) && typeof content === 'string')
        throw new WorkshopError(
          'invalid',
          `${path} is the app’s picture: set it with app_icon, from a link, a file or base64.`,
        );
      const files = await this.files(draftId);
      files.set(path, bytes);
      limits(files);
      await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { mode: 0o600 });
      info.updatedAt = Date.now();
      await this.#save(info);
      return info;
    });
  }

  /**
   * The draft's picture (ADR 0090): this one under its own name, or none.
   * Any other picture it had goes, so a draft never holds two.
   */
  setPicture(
    draftId: string,
    picture?: { name: AppPictureName; bytes: Buffer },
  ): Promise<DraftInfo> {
    return this.#mutex.run(async () => {
      const info = await this.info(draftId);
      const files = await this.files(draftId);
      for (const name of picturesIn(files)) files.delete(name);
      if (picture) files.set(picture.name, picture.bytes);
      limits(files);
      const dir = this.filesDir(draftId);
      for (const name of Object.keys(APP_PICTURES))
        if (name !== picture?.name) await rm(pathIn(dir, name), { force: true });
      if (picture) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(pathIn(dir, picture.name), picture.bytes, { mode: 0o600 });
      }
      info.updatedAt = Date.now();
      await this.#save(info);
      return info;
    });
  }

  async read(draftId: string, path: string): Promise<string> {
    await this.info(draftId);
    let target: string;
    try {
      target = pathIn(this.filesDir(draftId), path);
    } catch {
      throw new WorkshopError('invalid', `“${path}” isn’t a path inside the app’s folder.`);
    }
    try {
      const bytes = await readFile(target);
      if (!isAppPicture(path)) return bytes.toString('utf8');
      // A picture isn't words: say what it is instead.
      const read = readPicture(bytes);
      return read.ok
        ? `${path} is the app’s picture: ${describePicture({ ...read, bytes: bytes.length })}. app_icon changes or removes it.`
        : `${path} is meant to be the app’s picture, but ${read.problem}`;
    } catch {
      throw new WorkshopError(
        'not-found',
        `The draft has no file called “${path}”. Call app_read without a path to list its files.`,
      );
    }
  }

  remove(draftId: string, path: string): Promise<DraftInfo> {
    return this.#mutex.run(async () => {
      const info = await this.info(draftId);
      let target: string;
      try {
        target = pathIn(this.filesDir(draftId), path);
      } catch {
        throw new WorkshopError('invalid', `“${path}” isn’t a path inside the app’s folder.`);
      }
      if (
        !(await stat(target).then(
          (s) => s.isFile(),
          () => false,
        ))
      )
        throw new WorkshopError('not-found', `The draft has no file called “${path}”.`);
      await rm(target, { force: true });
      info.updatedAt = Date.now();
      await this.#save(info);
      return info;
    });
  }

  /** A draft and everything in it. */
  async discard(draftId: string): Promise<void> {
    await removeTree(this.#dir(draftId));
  }

  /** Drafts whose chat is gone, untouched for 30 days. How many went. */
  async tidy(chatExists: (id: string) => Promise<boolean>, now = Date.now()): Promise<number> {
    let gone = 0;
    for (const draft of await this.all()) {
      if (now - draft.updatedAt < ORPHAN_MS) continue;
      if (await chatExists(draft.conversationId)) continue;
      await this.discard(draft.id);
      gone++;
    }
    return gone;
  }

  async bytes(): Promise<number> {
    return folderBytes(this.root);
  }
}

/** The package's limits, in words that say what to do. */
export function limits(files: AppFiles): void {
  if (files.size > APP_LIMITS.files)
    throw new WorkshopError(
      'too-big',
      `The app has more than ${APP_LIMITS.files} files; join some together or remove ones it doesn’t need.`,
    );
  let total = 0;
  for (const [path, bytes] of files) {
    const ext = extname(path).toLowerCase();
    if (!isAppPicture(path) && !(APP_LIMITS.extensions as readonly string[]).includes(ext))
      throw new WorkshopError(
        'invalid',
        `“${path}” isn’t a kind of file an app can hold. Use one of ${APP_LIMITS.extensions.join(', ')}; a picture can only be the app’s icon, set with app_icon.`,
      );
    total += bytes.length;
  }
  if (total > APP_LIMITS.bytes)
    throw new WorkshopError(
      'too-big',
      `The app is over 2 MB (${kb(total)}); make its files smaller or leave out what it doesn’t need.`,
    );
}
