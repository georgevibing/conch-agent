/**
 * What every app's reader shares (ADR 0111): finding files without following
 * links, reading a file a line at a time, and telling a person's words apart
 * from what a program put in the chat.
 */
import { createReadStream } from 'node:fs';
import { createZstdDecompress } from 'node:zlib';
import { lstat, open, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

import type { ChatSourceId } from '@conch/protocol';

/** A file that holds one past chat (or, for a database, one chat inside it). */
export interface SessionFile {
  source: ChatSourceId;
  /** The app's own id for the chat. */
  key: string;
  /** The file to read, and how it looked: bringing them in again reads only what changed. */
  path: string;
  size: number;
  mtimeMs: number;
  /** The project, when it can be told without reading the chat (its folder). */
  project?: string;
}

/** A past chat as an app kept it, read into words. */
export interface PastSession {
  /** Its own title, when the app gave it one. */
  title?: string;
  /** The folder it worked in. */
  cwd?: string;
  model?: string;
  messages: { role: 'user' | 'assistant'; text: string; at: number }[];
}

/** One app's past chats: where they are, and how to read one. */
export interface ChatFinder {
  id: ChatSourceId;
  /** Every chat on this computer; cheap (names and sizes, a peek at most). */
  find(home: string, env: NodeJS.ProcessEnv): Promise<SessionFile[]>;
  /** One chat's words; undefined when the file isn't one of its chats after all. */
  read(file: SessionFile): Promise<PastSession | undefined>;
}

/** A message longer than this is cut (a pasted log): the chat stays readable and the index small. */
export const MESSAGE_CHARS = 24_000;
/** A chat with more messages than this keeps its last ones. */
export const MOST_MESSAGES = 4_000;
/** A line longer than this is a tool's output (a whole file read back): never a person's words. */
export const LONGEST_LINE = 4 * 1024 * 1024;

export const clipText = (text: string) =>
  text.length <= MESSAGE_CHARS ? text : `${text.slice(0, MESSAGE_CHARS - 1)}…`;

/** Entries of a folder, never following a link out of it. Nothing when it isn't there. */
export async function entries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** A real file's size and time, or undefined (a link, a folder, gone). */
export async function fileStat(path: string) {
  try {
    const s = await lstat(path);
    return s.isFile() ? { size: s.size, mtimeMs: Math.floor(s.mtimeMs) } : undefined;
  } catch {
    return undefined;
  }
}

/** Every file under `dir` whose name `wanted` accepts, `depth` folders down at most. */
export async function walk(
  dir: string,
  wanted: (name: string) => boolean,
  depth = 4,
): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await entries(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) out.push(...(await walk(path, wanted, depth - 1)));
    else if (entry.isFile() && wanted(entry.name)) out.push(path);
  }
  return out;
}

/** The first bytes of a file, as text: enough to find where a chat was. */
export async function head(path: string, bytes = 16_384): Promise<string> {
  const file = await open(path, 'r').catch(() => undefined);
  if (!file) return '';
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

/**
 * Each line of a JSONL file, parsed, a line at a time: a file of hundreds of
 * megabytes never sits in memory. A line that won't parse is skipped (a crash
 * mid-write), and so is a giant one, which is a tool's output.
 */
export async function* jsonLines(path: string): AsyncGenerator<Record<string, unknown>> {
  const file = createReadStream(path);
  // Codex squeezes older sessions with zstd (`.jsonl.zst`): read through it.
  const stream = path.endsWith('.zst') ? file.pipe(createZstdDecompress()) : file;
  stream.setEncoding('utf8');
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line || line.length > LONGEST_LINE) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value))
        yield value as Record<string, unknown>;
    }
  } catch {
    // Damaged part way (a cut-off zstd frame): what was read so far stands.
  } finally {
    lines.close();
    stream.destroy();
    file.destroy();
  }
}

/** A JSON string's contents as text (`"C:\\work"` → `C:\work`), or undefined when it won't read. */
export function unquote(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return undefined;
  }
}

/** A whole JSON file, when it's small enough to be one chat. */
export async function jsonFile(path: string, most = 64 * 1024 * 1024): Promise<unknown> {
  const s = await fileStat(path);
  if (!s || s.size > most) return undefined;
  const file = await open(path, 'r');
  try {
    return JSON.parse((await file.readFile()).toString('utf8')) as unknown;
  } catch {
    return undefined;
  } finally {
    await file.close();
  }
}

// ── Reading loosely ────────────────────────────────────────────────────────

export const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
export const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length ? v : undefined;
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A time in any of the shapes apps write: ISO text, seconds or milliseconds. */
export function time(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v) {
    const at = Date.parse(v);
    if (Number.isFinite(at)) return at;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  }
  return undefined;
}

/**
 * The words in a message's content, in whichever shape it came: a string, or
 * a list of parts where only the text parts count (`text`, `input_text`,
 * `output_text`). Tool calls, their results, pictures and thinking are left
 * out: they're steps, not what was said.
 */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const part of arr(content)) {
    if (typeof part === 'string') parts.push(part);
    const p = obj(part);
    if (!p) continue;
    const kind = str(p.type);
    if (kind && !['text', 'input_text', 'output_text'].includes(kind)) continue;
    const text = str(p.text);
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

/**
 * Words a program put in the chat, not the person: the notes coding agents
 * add to a turn (`<system-reminder>`, `<command-name>`, environment context,
 * a pasted command's output), stripped out; what's left is theirs.
 */
export function personWords(text: string): string {
  return text
    .replace(
      /<(system-reminder|command-(?:name|message|args)|local-command-(?:stdout|stderr|caveat)|environment_context|user_instructions|ide_selection|ide_opened_file|turn_aborted)>[\s\S]*?<\/\1>/g,
      '',
    )
    .replace(
      /^Caveat: The messages below were generated by the user while running local commands[^\n]*\n?/m,
      '',
    )
    .trim();
}

/** The project a folder is: its last name (`~/work/shop` → `shop`). */
export function projectOf(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const name = basename(cwd.replace(/[\\/]+$/, ''));
  return name ? name.slice(0, 120) : undefined;
}

/** Keep only what's worth reading: words, cut to size, the last ones when there are too many. */
export function tidy(messages: PastSession['messages']): PastSession['messages'] {
  const kept = messages
    .map((m) => ({ ...m, text: clipText(m.text.trim()) }))
    .filter((m) => m.text.length > 0);
  // The same reply streamed twice (a resumed session copies its history): once.
  const out: PastSession['messages'] = [];
  for (const m of kept) {
    const last = out.at(-1);
    if (last && last.role === m.role && last.text === m.text) continue;
    out.push(m);
  }
  return out.length > MOST_MESSAGES ? out.slice(-MOST_MESSAGES) : out;
}
