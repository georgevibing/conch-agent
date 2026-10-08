/**
 * Reading another agent's files, carefully (ADR 0035): only regular files
 * (a link is never followed, so a folder can't make Conch read your keys as
 * its own), at most a megabyte each, and never written to. A file that
 * won't read or parse is a sentence in the plan, never a stop.
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_FILE = 1024 * 1024;

/** A file's text, or undefined when it's missing, a link, too big, or unreadable. */
export async function readText(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_FILE) return undefined;
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** When the newest of these regular files last changed (ms), or undefined when none is there. */
export async function changedAt(...paths: string[]): Promise<number | undefined> {
  let newest: number | undefined;
  for (const path of paths) {
    const info = await lstat(path).catch(() => undefined);
    if (info?.isFile()) newest = Math.max(newest ?? 0, info.mtimeMs);
  }
  return newest;
}

/**
 * A file's bytes, but only from inside `root`: a relative path with no `..`,
 * every folder on the way a real one (never a link), the file a regular one
 * of at most `max` bytes. Anything else is undefined, never an error.
 */
export async function readInside(
  root: string,
  relative: string,
  max: number,
): Promise<Buffer | undefined> {
  if (!relative || relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) return undefined;
  const parts = relative.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (!parts.length || parts.some((p) => p === '..' || p.includes('\0'))) return undefined;
  try {
    if (!(await lstat(root)).isDirectory()) return undefined;
    let at = root;
    for (const [i, part] of parts.entries()) {
      at = join(at, part);
      const info = await lstat(at);
      const last = i === parts.length - 1;
      if (last ? !info.isFile() || info.size > max : !info.isDirectory()) return undefined;
    }
    const bytes = await readFile(at);
    return bytes.length > max ? undefined : bytes;
  } catch {
    return undefined;
  }
}

/** A folder's own entries (no links), or none. */
export async function entries(dir: string): Promise<{ name: string; dir: boolean }[]> {
  try {
    const list = await readdir(dir, { withFileTypes: true });
    return list
      .filter((e) => !e.isSymbolicLink() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, dir: e.isDirectory() }));
  } catch {
    return [];
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * JSON5 as OpenClaw writes its config: comments, trailing commas, unquoted
 * keys and single quotes. Enough of it to read a config, never to run one.
 */
export function parseJson5(text: string): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i] ?? '';
    const next = text[i + 1];
    if (c === '"' || c === "'") {
      // A string: copied as a JSON string, whatever quote it used.
      const quote = c;
      let value = '';
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < n) {
          value += text[i] + (text[i + 1] ?? '');
          i += 2;
          continue;
        }
        value += text[i] === '"' ? '\\"' : text[i];
        i++;
      }
      i++;
      out += `"${quote === "'" ? value.replace(/\\'/g, "'") : value}"`;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i = text.indexOf('*/', i + 2);
      i = i < 0 ? n : i + 2;
      continue;
    }
    out += c;
    i++;
  }
  const json = out
    // Unquoted keys: `{ key:` or `, key:`.
    .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
    // Trailing commas.
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(json);
}

/**
 * YAML as Hermes writes its `config.yaml`: nested `key: value` maps, lists,
 * comments, quotes and block text. Enough of it to read a setting, never to
 * run one: no anchors, tags or types, and every value is a string. A file
 * that isn't YAML at all (tabs for indentation, a quote left open, a line
 * that's neither a key nor a list item) throws, so the plan can say so.
 */
export function parseYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  /** Open maps, innermost last, with the indentation of their keys. */
  const stack: { indent: number; map: Record<string, unknown> }[] = [{ indent: 0, map: root }];
  /** The key whose value is the block under it (`model:` then indented keys). */
  let pending: { indent: number; map: Record<string, unknown>; key: string } | undefined;
  /** The list being read, and how far its items are indented. */
  let list: { indent: number; items: string[] } | undefined;
  /** Inside block text (`|` or `>`) deeper than this. */
  let block: number | undefined;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const [n, raw] of lines.entries()) {
    const indent = /^ */.exec(raw)?.[0].length ?? 0;
    const line = raw.slice(indent);
    if (block !== undefined) {
      if (!line.trim() || indent > block) continue;
      block = undefined;
    }
    if (!line.trim() || line.startsWith('#')) continue;
    if (line.startsWith('\t')) throw new Error(`Line ${n + 1} is indented with a tab.`);
    if (indent === 0 && (line === '---' || line === '...')) continue;
    const item = line === '-' || line.startsWith('- ');
    if (pending) {
      if (item && indent >= pending.indent) {
        list = { indent, items: [] };
        pending.map[pending.key] = list.items;
      } else if (!item && indent > pending.indent) {
        const map: Record<string, unknown> = {};
        pending.map[pending.key] = map;
        stack.push({ indent, map });
      }
      pending = undefined;
    }
    if (item) {
      // Words are kept; a list of maps is passed over (nothing here needs one).
      const value = line.slice(1).trim();
      if (list && indent === list.indent && value && !/^[^\s'"][^:]*:(\s|$)/.test(value))
        list.items.push(scalar(value, n));
      continue;
    }
    if (list && indent <= list.indent) list = undefined;
    while (stack.length > 1 && (stack.at(-1)?.indent ?? 0) > indent) stack.pop();
    const top = stack.at(-1) ?? { indent: 0, map: root };
    // Deeper than any open map: inside a list's maps, or a value wrapped onto the next line.
    if (indent > top.indent) continue;
    const match = /^("[^"]*"|'[^']*'|[^\s:#'"][^:#]*?)\s*:(?:\s+(.*))?$/.exec(line);
    if (!match?.[1]) throw new Error(`Line ${n + 1} isn’t a setting.`);
    const key = match[1].replace(/^(['"])(.*)\1$/, '$2');
    const rest = match[2]?.trim() ?? '';
    if (!rest || rest.startsWith('#')) {
      top.map[key] = '';
      pending = { indent, map: top.map, key };
      continue;
    }
    if (/^[|>][+-]?\d*\s*(#.*)?$/.test(rest)) {
      top.map[key] = '';
      block = indent;
      continue;
    }
    top.map[key] = scalar(rest, n);
  }
  return root;
}

/** One YAML value as words: quotes taken off, a trailing comment dropped. */
function scalar(text: string, n: number): string {
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    if (end < 0) throw new Error(`Line ${n + 1} leaves a quote open.`);
    return text.slice(1, end);
  }
  if (/^[[{]/.test(text)) {
    const open = (text.match(/[[{]/g) ?? []).length;
    const shut = (text.match(/[\]}]/g) ?? []).length;
    if (open !== shut) throw new Error(`Line ${n + 1} leaves a bracket open.`);
  }
  return text.replace(/\s+#.*$/, '').trim();
}

/** A `.env` file: `KEY=value` lines, quotes and `export ` allowed. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    let value = (match[2] ?? '').trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (value) out[match[1]] = value;
  }
  return out;
}

/** A dotted path into parsed config: `get(config, 'channels.telegram.botToken')`. */
export function get(value: unknown, path: string): unknown {
  let at: unknown = value;
  for (const key of path.split('.')) {
    if (!at || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Markdown front matter's `key: value` lines, and the body after it. */
export function frontMatter(text: string): { keys: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { keys: {}, body: text };
  const keys: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m?.[1]) keys[m[1].toLowerCase()] = (m[2] ?? '').replace(/^['"]|['"]$/g, '').trim();
  }
  return { keys, body: text.slice(match[0].length) };
}

/**
 * The separate things a memory file says. Both agents keep memory as
 * Markdown: Hermes separates entries with `§`, OpenClaw writes bullets and
 * short paragraphs under headings. Headings, templates' placeholder lines
 * and empty bullets are not memories.
 */
export function memoryEntries(text: string): string[] {
  const body = frontMatter(text).body;
  const chunks = body.includes('§')
    ? body.split(/^\s*§\s*$|§/m)
    : body.split(/\n(?=\s*[-*+]\s)|\n\s*\n/);
  const out: string[] = [];
  for (const chunk of chunks) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^<!--.*-->$/.test(l) && !/^[-*_]{3,}$/.test(l));
    const text = lines
      .map((l) => l.replace(/^[-*+]\s+(\[[ x]\]\s+)?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 3 || /^\(?(?:empty|none|todo|tbd)\)?\.?$/i.test(text)) continue;
    if (/^_?\(?(?:add|write)\b.*\b(?:here|below)\)?_?\.?$/i.test(text)) continue;
    out.push(text.slice(0, 2000));
  }
  return [...new Set(out)].slice(0, 500);
}

/** A whole Markdown file as a few readable paragraphs (persona, about you), at most `max`. */
export function prose(text: string, max = 4000): string | undefined {
  const body = frontMatter(text)
    // The file's own title ("# Soul", "# User") isn't part of what it says.
    .body.replace(/^\s*#\s+[^\n]*\n/, '')
    .split('\n')
    .filter((l) => !/^<!--.*-->$/.test(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (body.length < 3) return undefined;
  return body.length > max ? `${body.slice(0, max - 1).trimEnd()}…` : body;
}

export { join };
