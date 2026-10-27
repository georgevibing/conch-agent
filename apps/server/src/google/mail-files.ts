import { basename } from 'node:path';

import { sniff } from '../attachments/sniff';
import { mimeOf } from '../browser/uploads';
import type { FileAccess } from '../engines/host';
import { fileBytes } from '../files/read';
import { MAIL_FILES_MAX_BYTES, type MailFile } from './accounts';

/** A chat's own file by id; anything else an email names is a path in the work folder. */
const CHAT_FILE = /^att_[A-Za-z0-9_-]+$/;

export interface MailFileSources {
  /** This chat's own files by id (`att_…`), read whole, in the order asked. */
  chat: (ids: readonly string[]) => Promise<MailFile[]>;
  /** The chat's work folder, for a file named by its path (2026-10-27). Absent: ids only. */
  folder?: () => Promise<FileAccess>;
  signal?: AbortSignal;
}

/**
 * The files an email carries, in the order named (ADR 0099, 2026-10-27): this chat's own by id,
 * or a file in its work folder by path ("report.pdf", "out/statement.pdf"). A path is read only
 * inside the work folder itself (not the chat's attachment folders, not Conch's own places), never
 * through a link, and never past what one email can carry; it's read here, so the send card shows
 * its name and size before anyone agrees.
 */
export async function mailFiles(
  refs: readonly string[],
  sources: MailFileSources,
): Promise<MailFile[]> {
  const unique = [...new Set(refs.map((ref) => ref.trim()))];
  const ids = unique.filter((ref) => CHAT_FILE.test(ref));
  const byId = new Map<string, MailFile>();
  const fromChat = ids.length ? await sources.chat(ids) : [];
  ids.forEach((id, i) => {
    const file = fromChat[i];
    if (file) byId.set(id, file);
  });
  const files: MailFile[] = [];
  for (const ref of unique) {
    const known = byId.get(ref);
    if (known) {
      files.push(known);
      continue;
    }
    if (CHAT_FILE.test(ref)) continue;
    if (!sources.folder)
      throw new Error(
        `“${ref.slice(0, 80)}” isn’t one of this chat’s files. Use the id (att_…) list_attachments gives.`,
      );
    const access = await sources.folder();
    // The work folder only: a chat's attachment folders are reached by their ids.
    const bytes = await fileBytes(
      { ...access, readableDirs: [] },
      ref,
      sources.signal ?? new AbortController().signal,
      MAIL_FILES_MAX_BYTES,
    ).catch((error: unknown) => {
      const why = error instanceof Error ? error.message : 'It couldn’t be read.';
      throw new Error(`“${ref.slice(0, 80)}” can’t go with the email: ${why}`);
    });
    const name = basename(ref);
    files.push({ name, mimeType: sniff(bytes, name, mimeOf(name)).mimeType, bytes });
  }
  return files;
}
