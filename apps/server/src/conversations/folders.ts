import { join } from 'node:path';

import { ChatFolder, NewFolderBody, type FolderId, type UpdateFolderBody } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { readStore, type Heal } from '../lib/recover';

/** Lenient on purpose: a folder with an odd field is put right, not lost. */
const StoredFolder = z.object({
  id: ChatFolder.shape.id,
  name: z.string().trim().min(1).max(40).catch('Folder'),
  glyph: ChatFolder.shape.glyph.catch('folder'),
  color: ChatFolder.shape.color.catch('blue'),
  order: z.number().catch(0),
  createdAt: z.number().catch(0),
});
const FoldersFile = z.object({
  folders: z
    .array(z.unknown())
    .catch([])
    .transform((list) =>
      list.flatMap((raw) => {
        const read = StoredFolder.safeParse(raw);
        return read.success ? [read.data] : [];
      }),
    ),
});

/** The most folders a list has: plenty for sorting, never a second filing system. */
export const MAX_FOLDERS = 100;

export class FolderError extends Error {
  constructor(
    readonly code: 'not-found' | 'too-many',
    message: string,
  ) {
    super(message);
  }
}

/**
 * `~/.conch/conversations/folders.json`: the folders in the chat list (ADR
 * 0089). Which chat is in which folder is kept with the chat; this keeps only
 * the folders, so losing it loses names, never chats.
 */
export class ChatFolders {
  #mutex = new Mutex();
  #folders?: Promise<ChatFolder[]>;

  constructor(
    private readonly dir: string,
    private readonly heal?: Heal,
    private readonly changed?: (folders: ChatFolder[]) => void,
  ) {}

  get #path() {
    return join(this.dir, 'folders.json');
  }

  #load(): Promise<ChatFolder[]> {
    this.#folders ??= readStore(this.#path, FoldersFile, {
      onRepair: () =>
        this.heal?.('conversations', 'Reset your chat folders. Your chats are all still there.'),
    }).then(
      (read) => read.value.folders,
      () => [],
    );
    return this.#folders;
  }

  async list(): Promise<ChatFolder[]> {
    return [...(await this.#load())].sort((a, b) => a.order - b.order);
  }

  async has(id: FolderId): Promise<boolean> {
    return (await this.#load()).some((f) => f.id === id);
  }

  create(body: NewFolderBody): Promise<ChatFolder> {
    const input = NewFolderBody.parse(body);
    return this.#write((folders) => {
      if (folders.length >= MAX_FOLDERS)
        throw new FolderError('too-many', `A list keeps at most ${MAX_FOLDERS} folders.`);
      const folder: ChatFolder = {
        id: newId('f') as FolderId,
        ...input,
        // A new folder goes last, where you'd look for it.
        order: Math.max(0, ...folders.map((f) => f.order)) + 1,
        createdAt: Date.now(),
      };
      folders.push(folder);
      return folder;
    });
  }

  update(id: FolderId, change: UpdateFolderBody): Promise<ChatFolder> {
    return this.#write((folders) => {
      const i = folders.findIndex((f) => f.id === id);
      const folder = folders[i];
      if (!folder) throw new FolderError('not-found', 'That folder isn’t there any more.');
      const next = { ...folder, ...stripUndefined(change) };
      folders[i] = next;
      return next;
    });
  }

  remove(id: FolderId): Promise<void> {
    return this.#write((folders) => {
      const i = folders.findIndex((f) => f.id === id);
      if (i >= 0) folders.splice(i, 1);
    });
  }

  #write<T>(change: (folders: ChatFolder[]) => T): Promise<T> {
    return this.#mutex.run(async () => {
      const folders = [...(await this.#load())];
      const result = change(folders);
      this.#folders = Promise.resolve(folders);
      await writeJson(this.#path, { folders });
      this.changed?.(await this.list());
      return result;
    });
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
