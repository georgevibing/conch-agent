import { constants } from 'node:fs';
import { open, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { decodeText } from '../attachments/sniff';
import { forbiddenPlaces, hostPath, type FileAccess } from '../engines/host';

export const FILE_LIMIT = 30 * 1024 * 1024;
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};

/** Validate the opened descriptor before consuming it, including hard links and devices. */
export async function fileBytes(
  access: FileAccess,
  raw: string,
  signal: AbortSignal,
  max = FILE_LIMIT,
) {
  signal.throwIfAborted();
  const path = await hostPath(access, raw);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1)
      throw new Error('Choose a regular file, not a link or device.');
    if (stat.size > max)
      throw new Error(
        `This file is larger than ${Math.round(max / 1024 / 1024)} MB. Split it into smaller files first.`,
      );
    // A growing file is bounded too; readFile would allocate until EOF.
    const bytes = Buffer.alloc(Math.min(stat.size + 1, max + 1));
    let length = 0;
    while (length < bytes.length) {
      signal.throwIfAborted();
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new Error(
        'The file changed while it was being read. Read it again once its writer finishes.',
      );
    if (length > max)
      throw new Error('The file grew past the reading limit. Wait for its writer to finish.');
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/** Something an attachment store can answer for one chat. */
export interface ChatFiles {
  inConversation(id: string, conversationId: string): Promise<{ path: string } | undefined>;
}

/**
 * The bytes of a file the model named: one of this chat's attachments by id
 * (`att_…`, so a provider that never sees paths can still read what it was
 * sent), or a path in the work folder.
 */
export async function namedBytes(
  access: () => Promise<FileAccess>,
  raw: string,
  signal: AbortSignal,
  chat?: { files: ChatFiles; conversationId: string },
  max = FILE_LIMIT,
) {
  const ref = raw.trim();
  if (chat && /^att_[A-Za-z0-9_-]+$/.test(ref)) {
    const found = await chat.files.inConversation(ref, chat.conversationId);
    if (!found)
      throw new Error(
        `There’s no attachment “${ref.slice(0, 60)}” in this chat. Use list_attachments to find this chat’s files.`,
      );
    // Its real path: the access check compares real paths (macOS's /var is /private/var).
    return fileBytes(await access(), await realpath(found.path), signal, max);
  }
  return fileBytes(await access(), raw, signal, max);
}

export function textPage(text: string, offset = 0, limit = 200) {
  const selected: string[] = [];
  let chars = 0;
  let next = offset;
  let totalLines = 0;
  let start = 0;
  let full = false;
  // Count all lines, but allocate strings only for this page. A newline-heavy
  // 30 MB file must not create millions of strings just to read its first lines.
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    if (!full && totalLines >= offset && selected.length < limit) {
      const contentEnd = end > start && text[end - 1] === '\r' && newline !== -1 ? end - 1 : end;
      const length = contentEnd - start;
      const value =
        length > 4000
          ? `${text.slice(start, start + 4000)} … [line shortened]`
          : text.slice(start, contentEnd);
      if (chars + value.length > 40_000 && selected.length) full = true;
      else {
        selected.push(`${totalLines + 1}: ${value}`);
        chars += value.length;
        next = totalLines + 1;
      }
    }
    totalLines++;
    if (newline === -1) break;
    start = newline + 1;
  }
  return {
    text: selected.join('\n'),
    totalLines,
    nextOffset: next < totalLines ? next : null,
  };
}

export async function readTextPage(
  access: FileAccess | (() => Promise<FileAccess>),
  path: string,
  signal: AbortSignal,
  offset = 0,
  limit = 200,
  chat?: { files: ChatFiles; conversationId: string },
) {
  const getAccess = typeof access === 'function' ? access : () => Promise.resolve(access);
  const decoded = decodeText(await namedBytes(getAccess, path, signal, chat));
  if (decoded === undefined)
    throw new Error('This is a binary file. Use read_document for a PDF or Office document.');
  return textPage(decoded, offset, limit);
}

const SKIP = new Set(['.git', 'node_modules', '.pnpm', 'dist', 'build', '.cache', '.venv', 'venv']);

/** Bounded, deterministic traversal without shell utilities, symlinks or secret directories. */
export async function searchFiles(
  access: FileAccess,
  options: {
    path: string;
    name?: string;
    text?: string;
    caseSensitive: boolean;
    offset: number;
    limit: number;
  },
  signal: AbortSignal,
) {
  const root = await realpath(access.cwd);
  const start = resolve(root, options.path);
  const forbidden = await forbiddenPlaces(access);
  const allowed = (path: string) => inside(root, path) && !forbidden.some((p) => inside(p, path));
  if (!allowed(start) || (await realpath(start)) !== start)
    throw new Error('Search a directory inside the work folder, without links.');
  const matches: { path: string; line?: number; text?: string }[] = [];
  let visited = 0;
  let found = 0;
  let skipped = 0;
  let limited = false;
  const deadline = Date.now() + 10_000;
  const fold = (v: string) => (options.caseSensitive ? v : v.toLocaleLowerCase('en'));
  const visit = async (dir: string): Promise<void> => {
    signal.throwIfAborted();
    if (limited) return;
    if (++visited > 20_000 || Date.now() > deadline) {
      limited = true;
      return;
    }
    if (!allowed(dir) || (await realpath(dir)) !== dir) {
      skipped++;
      return;
    }
    const entries = [];
    const handle = await opendir(dir);
    for await (const entry of handle) {
      if (entries.length >= 20_000) {
        limited = true;
        break;
      }
      entries.push(entry);
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      signal.throwIfAborted();
      if (limited) break;
      if (++visited > 20_000 || Date.now() > deadline) {
        limited = true;
        break;
      }
      const path = join(dir, entry.name);
      if (!allowed(path) || entry.isSymbolicLink()) {
        skipped++;
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const name = relative(root, path).split(sep).join('/');
      if (options.name && !fold(name).includes(fold(options.name))) continue;
      const add = (match: { path: string; line?: number; text?: string }) => {
        if (found++ >= options.offset) matches.push(match);
        if (matches.length > options.limit) limited = true;
      };
      try {
        // Even filename-only search validates the file's real path and hard-link count.
        await hostPath(access, path);
        if (!options.text) {
          add({ path: name });
          continue;
        }
        const decoded = decodeText(await fileBytes(access, path, signal, 2 * 1024 * 1024));
        if (decoded === undefined) {
          skipped++;
          continue;
        }
        for (const [index, line] of decoded.split(/\r?\n/).entries()) {
          if (fold(line).includes(fold(options.text)))
            add({ path: name, line: index + 1, text: line.slice(0, 500) });
          if (limited) break;
        }
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof Error)) throw error;
        skipped++;
      }
    }
  };
  await visit(start);
  const more = matches.length > options.limit;
  return {
    matches: matches.slice(0, options.limit),
    nextOffset: more ? options.offset + options.limit : null,
    incomplete: limited && !more,
    skipped,
    note: 'Search skips dependency, build and .git directories, links, protected files, and binary or text files over 2 MB. Offsets apply to unchanged files.',
  };
}
