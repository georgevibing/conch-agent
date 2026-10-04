import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Which files the browser may put on a page (`browser_upload`, ADR 0080).
 * Uploading is sending something of yours out, so the rule is narrow and the
 * person is asked every time:
 *
 * - a file the person attached in this chat;
 * - something Conch made in this chat (a page, a table, a chart);
 * - a file in the chat's work folder: not hidden, not key-shaped, not in
 *   Conch's own folder (unless the work folder lives there), and not in any
 *   place keys live (`protectedPaths`, `secretPlaces`, the browser's profile).
 *
 * Paths are resolved through links before they're checked, so a link in the
 * work folder can't reach out of it.
 */

/** Most one upload may carry in all (Playwright sends files as bytes). */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
/** Most files in one upload. */
export const UPLOAD_MAX_FILES = 10;

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
  /** Where it came from, for the question: "attached", "made here", the work folder's path. */
  from: string;
}

/** A file the chat has (attached or made), found by its id or name. */
export interface ChatFile {
  id: string;
  name: string;
  mimeType: string;
  read: () => Promise<Buffer>;
}

export interface UploadSources {
  /** Files the person attached in this chat. */
  attachments(conversationId: string): Promise<ChatFile[]>;
  /** What Conch made in this chat (artifacts), each as a file. */
  made(conversationId: string): Promise<ChatFile[]>;
  /** Conch's own folder (`CONCH_HOME`). */
  home: string;
  /** Places nothing is ever uploaded from: where keys and sign-ins live. */
  forbidden: readonly string[];
}

export class UploadRefused extends Error {}

const inside = (dir: string, path: string) => {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Names that are keys or sign-ins whatever folder they're in. */
const KEY_SHAPED =
  /^(id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|jks|keystore|kdbx|keychain|gpg|asc|ovpn)|credentials(\.json)?|secrets?(\..*)?|.*\.secrets\.json|token(s)?(\.json)?|\.env(\..*)?|\.?netrc|\.npmrc|\.pypirc)$/i;

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

export function mimeOf(name: string): string {
  return TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

const real = (path: string) => realpath(path).catch(() => resolve(path));

/** One file from the work folder, or a refusal that says why in words the agent can act on. */
export async function fromWorkspace(
  wanted: string,
  workspace: string,
  sources: Pick<UploadSources, 'home' | 'forbidden'>,
): Promise<UploadFile> {
  const room = await real(workspace);
  const asked = resolve(room, wanted);
  // Through any link first: what counts is where the bytes really are.
  const path = await realpath(asked).catch(() => undefined);
  if (!path) throw new UploadRefused(`There’s no file “${wanted}” in the work folder.`);
  if (!inside(room, path))
    throw new UploadRefused(
      `“${wanted}” isn’t in the work folder. Only files the user attached, things you made in this chat, or files in the work folder can be uploaded.`,
    );
  const home = await real(sources.home);
  if (inside(home, path) && !inside(home, room))
    throw new UploadRefused(
      `“${wanted}” is one of Conch’s own files, which never leave this computer.`,
    );
  for (const place of sources.forbidden) {
    if (inside(await real(place), path))
      throw new UploadRefused(
        `“${wanted}” is where keys or sign-ins are kept, so it can’t be uploaded.`,
      );
  }
  const parts = relative(room, path).split(sep);
  if (parts.some((p) => p.startsWith('.')))
    throw new UploadRefused(
      `“${wanted}” is a hidden file. Hidden files often hold settings or keys, so the user uploads those themselves.`,
    );
  if (KEY_SHAPED.test(basename(path)))
    throw new UploadRefused(
      `“${wanted}” looks like a key or a password file, so the user uploads that themselves if they mean to.`,
    );
  const info = await stat(path);
  if (!info.isFile()) throw new UploadRefused(`“${wanted}” is a folder, not a file.`);
  if (info.size > UPLOAD_MAX_BYTES)
    throw new UploadRefused(
      `“${wanted}” is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB, too big to upload from here.`,
    );
  return {
    name: basename(path),
    mimeType: mimeOf(path),
    buffer: await readFile(path),
    from: relative(room, path).split(sep).join('/'),
  };
}

/**
 * The files the agent named, each found among the chat's attachments, then
 * what Conch made, then the work folder. All or nothing.
 */
export async function resolveUploads(
  wanted: readonly string[],
  context: { conversationId: string; workspace: string; sources: UploadSources },
): Promise<UploadFile[]> {
  if (!wanted.length) throw new UploadRefused('Say which file to upload.');
  if (wanted.length > UPLOAD_MAX_FILES)
    throw new UploadRefused(
      `That’s more than ${UPLOAD_MAX_FILES} files; upload them a few at a time.`,
    );
  const { sources, conversationId } = context;
  const [attached, made] = await Promise.all([
    sources.attachments(conversationId).catch((): ChatFile[] => []),
    sources.made(conversationId).catch((): ChatFile[] => []),
  ]);
  const match = (list: ChatFile[], name: string) => {
    const key = name.trim().toLowerCase();
    return list.find((f) => f.id === name.trim() || f.name.toLowerCase() === key);
  };
  const files: UploadFile[] = [];
  let total = 0;
  for (const name of wanted) {
    const chat = match(attached, name) ?? match(made, name);
    const file = chat
      ? {
          name: chat.name,
          mimeType: chat.mimeType,
          buffer: await chat.read(),
          from: attached.includes(chat) ? 'attached in this chat' : 'made in this chat',
        }
      : await fromWorkspace(name, context.workspace, sources);
    total += file.buffer.length;
    if (total > UPLOAD_MAX_BYTES)
      throw new UploadRefused(
        `Together those are over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB; upload them a few at a time.`,
      );
    files.push(file);
  }
  return files;
}
