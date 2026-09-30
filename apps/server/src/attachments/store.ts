import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ATTACHMENT_LIMITS, Attachment, countLines, Id } from '@conch/protocol';

import { Mutex, readJson, safeJoin, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { cleanName, sniff } from './sniff';

/** An attachment on disk, and the conversations it was sent in. */
interface Stored extends Attachment {
  /** The file's name in its folder (the shown name, made safe to write). */
  file: string;
  conversations: string[];
}

export class AttachmentError extends Error {
  constructor(
    readonly code: 'too-large' | 'empty' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

/** How long an upload that was never sent is kept (the tab closed, the draft was dropped). */
export const UNSENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PASTED_NAME = 'Pasted text';

/**
 * `~/.conch/attachments/<id>/` — one folder per attachment: `meta.json` and
 * the file itself under its own (cleaned) name, so an agent that opens it
 * by path sees `report.pdf`, not an opaque blob.
 *
 * An upload belongs to nobody until a message is sent with it. Sent ones
 * live as long as a conversation that used them; unsent ones are swept
 * after a day.
 */
export class AttachmentStore {
  readonly #mutex = new Mutex();

  constructor(readonly dir: string) {}

  /** The folder an attachment lives in (for engines that open files themselves). */
  folder(id: string): string {
    return safeJoin(this.dir, Id.parse(id));
  }

  async save(input: {
    name: string;
    bytes: Buffer;
    claimedType?: string;
    pasted?: boolean;
  }): Promise<Attachment> {
    const { bytes } = input;
    if (bytes.length > ATTACHMENT_LIMITS.maxBytes)
      throw new AttachmentError(
        'too-large',
        `That file is over ${ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB, the most Conch takes.`,
      );
    if (!bytes.length) throw new AttachmentError('empty', 'That file is empty.');
    const pasted = Boolean(input.pasted);
    const shown = pasted ? PASTED_NAME : cleanName(input.name, ATTACHMENT_LIMITS.maxName);
    const found = sniff(bytes, shown, input.claimedType);
    // A paste is text by definition; if the bytes disagree, it's treated as a file.
    const kind = pasted && found.kind !== 'text' ? 'file' : found.kind;
    const id = newId('att');
    const attachment: Attachment = {
      id,
      name: shown,
      mimeType: pasted && kind === 'text' ? 'text/plain' : found.mimeType,
      size: bytes.length,
      kind,
      ...(pasted && { pasted: true }),
      ...(found.text !== undefined && { lines: countLines(found.text) }),
      ...(found.width && found.height && { width: found.width, height: found.height }),
      createdAt: Date.now(),
    };
    const file = pasted ? 'pasted-text.txt' : cleanName(shown);
    const folder = this.folder(id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(safeJoin(folder, file), bytes, { mode: 0o600 });
    await writeJson(join(folder, 'meta.json'), { ...attachment, file, conversations: [] });
    return Attachment.parse(attachment);
  }

  async #read(id: string): Promise<Stored | undefined> {
    if (!Id.safeParse(id).success) return undefined;
    const stored = await readJson<Stored>(join(this.folder(id), 'meta.json')).catch(
      () => undefined,
    );
    return stored && typeof stored.file === 'string' ? stored : undefined;
  }

  async get(id: string): Promise<{ attachment: Attachment; path: string } | undefined> {
    const stored = await this.#read(id);
    if (!stored) return undefined;
    const { file, conversations: _, ...attachment } = stored;
    const parsed = Attachment.safeParse(attachment);
    if (!parsed.success) return undefined;
    return { attachment: parsed.data, path: safeJoin(this.folder(id), file) };
  }

  /** Bytes of an attachment, or undefined if it's gone. */
  async bytes(id: string): Promise<Buffer | undefined> {
    const found = await this.get(id);
    return found ? readFile(found.path).catch(() => undefined) : undefined;
  }

  /**
   * Hand attachments to a conversation as its message is sent. Unknown ids are
   * refused as a whole, so a message never goes out missing something the
   * person saw attached.
   */
  claim(ids: readonly string[], conversationId: string): Promise<Attachment[]> {
    return this.#mutex.run(async () => {
      const out: Attachment[] = [];
      const stored: Stored[] = [];
      for (const id of new Set(ids)) {
        const found = await this.#read(id);
        if (!found)
          throw new AttachmentError(
            'not-found',
            'Something you attached is no longer here. Attach it again and resend.',
          );
        stored.push(found);
      }
      for (const found of stored) {
        if (!found.conversations.includes(conversationId)) {
          found.conversations.push(conversationId);
          await writeJson(join(this.folder(found.id), 'meta.json'), found);
        }
        const { file: _f, conversations: _c, ...attachment } = found;
        out.push(Attachment.parse(attachment));
      }
      return out;
    });
  }

  /** A conversation was deleted: drop what only it used. */
  forget(conversationId: string, ids: readonly string[]): Promise<void> {
    return this.#mutex.run(async () => {
      for (const id of new Set(ids)) {
        const found = await this.#read(id);
        if (!found) continue;
        found.conversations = found.conversations.filter((c) => c !== conversationId);
        if (found.conversations.length) await writeJson(join(this.folder(id), 'meta.json'), found);
        else await rm(this.folder(id), { recursive: true, force: true });
      }
    });
  }

  /** Remove an upload that hasn't been sent (the person took it off the message). */
  discard(id: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const found = await this.#read(id);
      if (!found || found.conversations.length) return false;
      await rm(this.folder(id), { recursive: true, force: true });
      return true;
    });
  }

  /**
   * Clean up: uploads never sent and older than a day, and folders left
   * half-written by a crash (no readable `meta.json`). Returns how many went.
   */
  sweep(now = Date.now()): Promise<number> {
    return this.#mutex.run(async () => {
      let removed = 0;
      const entries = await readdir(this.dir).catch(() => [] as string[]);
      for (const name of entries) {
        if (!Id.safeParse(name).success) continue;
        const found = await this.#read(name);
        const age = found
          ? now - found.createdAt
          : now - ((await stat(this.folder(name)).catch(() => undefined))?.mtimeMs ?? now);
        if ((found?.conversations.length ?? 0) > 0 || age < UNSENT_MAX_AGE_MS) continue;
        await rm(this.folder(name), { recursive: true, force: true });
        removed++;
      }
      return removed;
    });
  }
}
