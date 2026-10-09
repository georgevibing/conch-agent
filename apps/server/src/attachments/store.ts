import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ATTACHMENT_LIMITS, Attachment, countLines, Id } from '@conch/protocol';

import { Mutex, readJson, safeJoin, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { CONVERTIBLE, fitPicture, toJpeg, type PictureConverter } from './fit';
import { cleanName, extension, sniff, type ImageType } from './sniff';

/** An attachment on disk, and the conversations it was sent in. */
interface Stored extends Attachment {
  /** The file's name in its folder (the shown name, made safe to write). */
  file: string;
  conversations: string[];
  /**
   * Kept for a message that's waiting (a voice note Conch can't hear yet,
   * ADR 0077): not swept with unsent uploads until it goes.
   */
  held?: boolean;
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
/** How long one held for a waiting message is kept (a voice note waits at most a week). */
export const HELD_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

const PASTED_NAME = 'Pasted text';
/** The picture as models get it, beside the original (`forModels`). */
const FITTED = '.for-models';

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

  constructor(
    readonly dir: string,
    private readonly options: {
      /** What turns a HEIC photo into a JPEG (`fit.ts`; tests pretend). */
      converters?: readonly PictureConverter[];
      /**
       * Uploads an unsent message still holds (a draft, ADR 0124): never
       * swept while it does, however old they are.
       */
      drafted?: (now: number) => Promise<ReadonlySet<string>>;
    } = {},
  ) {}

  /** The folder an attachment lives in (for engines that open files themselves). */
  folder(id: string): string {
    return safeJoin(this.dir, Id.parse(id));
  }

  async save(input: {
    name: string;
    bytes: Buffer;
    claimedType?: string;
    pasted?: boolean;
    /** A voice note's words (ADR 0077). */
    transcript?: string;
    /** It waits for something before it's sent: kept until then. */
    held?: boolean;
    /** What Conch knows of a file it made: pages, sheets, slides, its preview picture. */
    facts?: Pick<Attachment, 'pages' | 'sheets' | 'slides' | 'preview'>;
  }): Promise<Attachment> {
    let { bytes } = input;
    if (bytes.length > ATTACHMENT_LIMITS.maxBytes)
      throw new AttachmentError(
        'too-large',
        `That file is over ${ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB, the most Conch takes.`,
      );
    if (!bytes.length) throw new AttachmentError('empty', 'That file is empty.');
    const pasted = Boolean(input.pasted);
    let shown = pasted ? PASTED_NAME : cleanName(input.name, ATTACHMENT_LIMITS.maxName);
    let found = sniff(bytes, shown, input.claimedType);
    // A photo no model reads (an iPhone's HEIC) is kept as the JPEG every one does, and every
    // browser shows. When this computer can't convert it, it stays a file, said so in the chat.
    if (!pasted && found.kind === 'file' && CONVERTIBLE.has(found.mimeType)) {
      const jpeg = await toJpeg(bytes, extension(shown), this.options.converters);
      if (jpeg) {
        bytes = jpeg;
        shown = cleanName(
          `${shown.replace(/\.[a-z0-9]{1,5}$/i, '')}.jpg`,
          ATTACHMENT_LIMITS.maxName,
        );
        found = sniff(bytes, shown, 'image/jpeg');
      }
    }
    // Text that wasn't UTF-8 is kept as UTF-8, so every model and every program reads it.
    if (found.transcoded && found.text !== undefined) bytes = Buffer.from(found.text, 'utf8');
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
      ...(input.transcript && { transcript: input.transcript.slice(0, 20_000) }),
      ...(input.facts?.pages && { pages: input.facts.pages }),
      ...(input.facts?.sheets && { sheets: input.facts.sheets }),
      ...(input.facts?.slides && { slides: input.facts.slides }),
      ...(input.facts?.preview && { preview: input.facts.preview }),
      createdAt: Date.now(),
    };
    const file = pasted ? 'pasted-text.txt' : cleanName(shown);
    const folder = this.folder(id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(safeJoin(folder, file), bytes, { mode: 0o600 });
    await writeJson(join(folder, 'meta.json'), {
      ...attachment,
      file,
      conversations: [],
      ...(input.held && { held: true }),
    });
    return Attachment.parse(attachment);
  }

  /** A waiting voice note was heard: keep its words with it, and let it go out. */
  transcribed(id: string, transcript: string): Promise<Attachment | undefined> {
    return this.#mutex.run(async () => {
      const found = await this.#read(id);
      if (!found) return undefined;
      found.transcript = transcript.slice(0, 20_000);
      delete found.held;
      await writeJson(join(this.folder(id), 'meta.json'), found);
      const { file: _f, conversations: _c, held: _h, ...attachment } = found;
      return Attachment.parse(attachment);
    });
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
    const { file, conversations: _, held: _held, ...attachment } = stored;
    const parsed = Attachment.safeParse(attachment);
    if (!parsed.success) return undefined;
    return { attachment: parsed.data, path: safeJoin(this.folder(id), file) };
  }

  /**
   * One of this conversation's own files (sent in it, or made in it), with
   * where it is; undefined for an unknown id or another chat's file, so a
   * chat can never reach for someone else's.
   */
  async inConversation(
    id: string,
    conversationId: string,
  ): Promise<{ attachment: Attachment; path: string } | undefined> {
    const stored = await this.#read(id);
    if (!stored?.conversations.includes(conversationId)) return undefined;
    return this.get(id);
  }

  /** Includes finished files made here, even if a turn stopped before its result was logged. */
  async forConversation(conversationId: string): Promise<Attachment[]> {
    const items: Attachment[] = [];
    for (const id of await readdir(this.dir).catch(() => [] as string[])) {
      const stored = await this.#read(id);
      if (!stored?.conversations.includes(conversationId)) continue;
      const parsed = Attachment.safeParse(stored);
      if (parsed.success) items.push(parsed.data);
    }
    return items;
  }

  /**
   * A picture as it goes to a model (`fit.ts`): upright, scaled to fit, no
   * location in it. Made once and kept beside the original, so a chat that
   * carries on doesn't make it again; the original stays as it was sent.
   */
  async forModels(
    id: string,
  ): Promise<{ bytes: Buffer; mimeType: ImageType; path: string } | undefined> {
    const found = await this.get(id);
    if (found?.attachment.kind !== 'image') return undefined;
    const original = await readFile(found.path).catch(() => undefined);
    if (!original) return undefined;
    const mimeType = found.attachment.mimeType as ImageType;
    for (const ext of ['jpeg', 'png', 'webp']) {
      const kept = join(this.folder(id), `${FITTED}.${ext}`);
      const bytes = await readFile(kept).catch(() => undefined);
      if (bytes?.length) return { bytes, mimeType: `image/${ext}` as ImageType, path: kept };
    }
    const fitted = await fitPicture(original, mimeType);
    if (!fitted.changed) return { bytes: original, mimeType, path: found.path };
    const path = join(this.folder(id), `${FITTED}.${fitted.mimeType.slice('image/'.length)}`);
    await writeFile(path, fitted.bytes, { mode: 0o600 }).catch(() => undefined);
    return { bytes: fitted.bytes, mimeType: fitted.mimeType, path };
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
        if (!found.conversations.includes(conversationId) || found.held) {
          found.conversations.push(conversationId);
          found.conversations = [...new Set(found.conversations)];
          delete found.held;
          await writeJson(join(this.folder(found.id), 'meta.json'), found);
        }
        const { file: _f, conversations: _c, held: _h, ...attachment } = found;
        out.push(Attachment.parse(attachment));
      }
      return out;
    });
  }

  /**
   * Hand an upload that belongs to nobody yet to a conversation, and give it
   * back. Used by the one press that uploads something outside a message: a
   * card's picture, on its way to a chat app (ADR 0105).
   *
   * An attachment that already belongs to another conversation is refused
   * rather than shared, so this can never become a way for one chat to reach
   * into another chat's files — the thing `inConversation` exists to prevent.
   * One that already belongs to this conversation is simply returned.
   */
  claimFresh(id: string, conversationId: string): Promise<Attachment | undefined> {
    return this.#mutex.run(async () => {
      const found = await this.#read(id);
      if (!found) return undefined;
      const mine = found.conversations.includes(conversationId);
      if (!mine && found.conversations.length) return undefined;
      if (!mine || found.held) {
        found.conversations = [...new Set([...found.conversations, conversationId])];
        delete found.held;
        await writeJson(join(this.folder(id), 'meta.json'), found);
      }
      const { file: _f, conversations: _c, held: _h, ...attachment } = found;
      return Attachment.parse(attachment);
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
   * half-written by a crash (no readable `meta.json`). An upload a draft
   * still holds stays (ADR 0124). Returns how many went.
   */
  async sweep(now = Date.now()): Promise<number> {
    // Asked before the sweep starts. Drafts that can't be read sweep nothing: a
    // file someone is about to send is worth more than a day's tidiness.
    let drafted: ReadonlySet<string>;
    try {
      drafted = (await this.options.drafted?.(now)) ?? new Set<string>();
    } catch {
      return 0;
    }
    return this.#mutex.run(async () => {
      let removed = 0;
      const entries = await readdir(this.dir).catch(() => [] as string[]);
      for (const name of entries) {
        if (!Id.safeParse(name).success || drafted.has(name)) continue;
        const found = await this.#read(name);
        const age = found
          ? now - found.createdAt
          : now - ((await stat(this.folder(name)).catch(() => undefined))?.mtimeMs ?? now);
        if (
          (found?.conversations.length ?? 0) > 0 ||
          age < (found?.held ? HELD_MAX_AGE_MS : UNSENT_MAX_AGE_MS)
        )
          continue;
        await rm(this.folder(name), { recursive: true, force: true });
        removed++;
      }
      return removed;
    });
  }
}
