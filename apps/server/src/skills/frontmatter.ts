/**
 * Just enough YAML front matter for `SKILL.md` (ADR 0013).
 *
 * Conch reads a few top-level keys and rewrites the ones it owns, line by
 * line, leaving everything else — other products' `metadata`, comments, key
 * order — exactly as it was. That round-trips a skill written by OpenClaw or
 * Hermes better than parsing the whole document and dumping it again would,
 * and needs no YAML library.
 */

export interface SkillFile {
  /** The YAML between the `---` lines, without them; undefined when there's none. */
  front: string | undefined;
  body: string;
}

const FENCE = /^---[ \t]*$/;
const END = /^(?:---|\.\.\.)[ \t]*$/;

/** Split a `SKILL.md` into its front matter and body. Line endings become `\n`. */
export function splitSkill(text: string): SkillFile {
  // Some editors start a UTF-8 file with a byte-order mark.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.replace(/\r\n?/g, '\n').split('\n');
  if (!FENCE.test(lines[0] ?? '')) return { front: undefined, body: lines.join('\n') };
  const end = lines.findIndex((line, i) => i > 0 && END.test(line));
  if (end === -1) return { front: undefined, body: lines.join('\n') };
  return {
    front: lines.slice(1, end).join('\n'),
    body: lines
      .slice(end + 1)
      .join('\n')
      .replace(/^\n+/, ''),
  };
}

export function joinSkill(file: { front: string; body: string }): string {
  const front = file.front.replace(/\n+$/, '');
  const body = file.body.replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${front}\n---\n\n${body}\n`;
}

const isKeyLine = (line: string) => /^[^\s#][^:]*:(?:\s|$)/.test(line);
const keyOf = (line: string) =>
  line
    .slice(0, line.indexOf(':'))
    .trim()
    .replace(/^["']|["']$/g, '');

/** The lines a top-level key spans: its own, plus indented (or blank) continuation lines. */
function blockOf(
  lines: string[],
  key: string,
  from = 0,
): { start: number; end: number } | undefined {
  const start = lines.findIndex((line, i) => i >= from && isKeyLine(line) && keyOf(line) === key);
  if (start === -1) return undefined;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] as string;
    if (line.trim() === '' || /^\s/.test(line)) end++;
    else break;
  }
  // Blank lines after the block belong to what follows.
  while (end > start + 1 && (lines[end - 1] as string).trim() === '') end--;
  return { start, end };
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut));
}

/** Folded text: single line breaks become spaces, blank lines become line breaks. */
function fold(lines: string[]): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      out.push(paragraph.join(' '));
      paragraph = [];
    } else paragraph.push(line.trim());
  }
  out.push(paragraph.join(' '));
  return out.join('\n').trim();
}

const ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\u0085',
  _: ' ',
};

function unescapeDouble(text: string): string {
  return text.replace(
    /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g,
    (_, code: string) => {
      if (code.length > 1) return String.fromCodePoint(parseInt(code.slice(1), 16));
      return ESCAPES[code] ?? code;
    },
  );
}

/** A quoted scalar that may continue over several lines; undefined if it never closes. */
function quoted(first: string, rest: string[], quote: '"' | "'"): string | undefined {
  const text = [first, ...rest].join('\n');
  let i = 1;
  let raw = '';
  while (i < text.length) {
    const ch = text[i] as string;
    if (quote === "'" && ch === "'") {
      if (text[i + 1] === "'") {
        raw += "'";
        i += 2;
        continue;
      }
      break;
    }
    if (quote === '"' && ch === '\\') {
      raw += ch + (text[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (quote === '"' && ch === '"') break;
    raw += ch;
    i++;
  }
  if (i >= text.length) return undefined;
  const folded = fold(raw.split('\n'));
  return quote === '"' ? unescapeDouble(folded) : folded;
}

/**
 * A top-level key's value as text — plain, quoted, or a `|`/`>` block — or
 * undefined when it's missing or isn't a scalar (a nested map or a list).
 */
export function readKey(front: string | undefined, key: string): string | undefined {
  if (front === undefined) return undefined;
  const lines = front.split('\n');
  const block = blockOf(lines, key);
  if (!block) return undefined;
  const line = lines[block.start] as string;
  const value = line.slice(line.indexOf(':') + 1).trim();
  const rest = lines.slice(block.start + 1, block.end);

  const header = /^([|>])([+-]?)(\d?)([+-]?)\s*(?:#.*)?$/.exec(value);
  if (header) {
    const body = dedent(rest);
    const text = header[1] === '|' ? body.join('\n') : fold(body);
    return text.replace(/\s+$/, '');
  }
  if (value.startsWith('"') || value.startsWith("'")) {
    return quoted(value, rest, value[0] as '"' | "'");
  }
  // A nested map or list isn't a scalar.
  if (!value && rest.some((l) => l.trim())) return undefined;
  if (value.startsWith('[') || value.startsWith('{')) return undefined;
  const plain = [value.replace(/\s+#.*$/, ''), ...rest.map((l) => l.trim())];
  return fold(plain) || undefined;
}

/** A line without its ` # comment`, leaving a `#` inside quotes alone. */
function uncomment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) return line.slice(0, i);
  }
  return line;
}

/** Items split at commas, never one inside quotes or brackets ("Bash(git add, git commit)"). */
function splitItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if ((ch === '"' || ch === "'") && !current.trim()) quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map(unquote).filter(Boolean);
}

const unquote = (item: string) =>
  item
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();

/** One key's lines as a list. */
function listIn(lines: string[], block: { start: number; end: number }): string[] {
  const line = lines[block.start] as string;
  const value = uncomment(line.slice(line.indexOf(':') + 1)).trim();
  const rest = lines.slice(block.start + 1, block.end);
  if (value.startsWith('[')) {
    // A flow list may go on over the lines under it.
    const flow = [value, ...rest.map((l) => uncomment(l).trim())].join(' ');
    const close = flow.lastIndexOf(']');
    return splitItems(flow.slice(1, close < 0 ? undefined : close));
  }
  if (value) return splitItems(value);
  return rest
    .map((l) => /^\s*-\s+(.*)$/.exec(l)?.[1])
    .filter((item): item is string => item !== undefined)
    .map((item) => unquote(uncomment(item)))
    .filter(Boolean);
}

/**
 * A top-level key as a list of strings, however it's written: `a, b`,
 * `[a, "b"]`, or a block of `- a` lines (the Agent Skills `allowed-tools`
 * comes in all three). Undefined when the key is missing. A key written twice
 * is a file YAML refuses; its list is everything both say, so nothing a skill
 * asks for is left out of what Conch shows.
 */
export function readList(front: string | undefined, key: string): string[] | undefined {
  if (front === undefined) return undefined;
  const lines = front.split('\n');
  const out: string[] = [];
  let found = false;
  for (let from = 0; ;) {
    const block = blockOf(lines, key, from);
    if (!block) break;
    found = true;
    for (const item of listIn(lines, block)) if (!out.includes(item)) out.push(item);
    from = block.end;
  }
  return found ? out : undefined;
}

/** A boolean key, YAML 1.2 style (`true`/`false`). */
export function readFlag(front: string | undefined, key: string): boolean | undefined {
  const value = readKey(front, key)?.toLowerCase();
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

/** What YAML would read as something else: a key, a comment, a flag, a number (`0x1F`, `.inf`). */
const PLAIN_UNSAFE =
  /^[\s\-?:,[\]{}#&*!|>'"%@`]|: | #|:$|[\n\r\t]|\s$|^(?:true|false|null|yes|no|on|off|~|[-+]?\d[\d._]*(?:e[-+]?\d+)?|[-+]?\.\d[\d_]*(?:e[-+]?\d+)?|0x[\da-f_]+|0o[0-7_]+|[-+]?\.(?:inf|nan))$/i;

/** A value written the way a person would, quoted only when it has to be. */
export function formatValue(value: string | boolean): string {
  if (typeof value === 'boolean') return String(value);
  if (!value) return '""';
  // JSON's escaping is a subset of YAML's double-quoted style.
  return PLAIN_UNSAFE.test(value) ? JSON.stringify(value) : value;
}

/**
 * Set or remove top-level keys. A key that exists is replaced where it
 * stands; a new one goes after the keys named in `order` (else at the end).
 * Everything else is left exactly as it was.
 */
export function setKeys(
  front: string | undefined,
  entries: [key: string, value: string | boolean | undefined][],
  order: string[] = ['name', 'description'],
): string {
  const lines = front ? front.split('\n') : [];
  for (const [key, value] of entries) {
    const block = blockOf(lines, key);
    const next = value === undefined ? [] : [`${key}: ${formatValue(value)}`];
    if (block) {
      lines.splice(block.start, block.end - block.start, ...next);
      continue;
    }
    if (!next.length) continue;
    // After the last of the keys that come before this one, else at the end.
    const before = order.slice(0, Math.max(0, order.indexOf(key)));
    let at = -1;
    for (const k of before) {
      const b = blockOf(lines, k);
      if (b) at = Math.max(at, b.end);
    }
    if (at === -1 && order.includes(key)) at = 0;
    if (at === -1) {
      while (lines.length && (lines.at(-1) as string).trim() === '') lines.pop();
      at = lines.length;
    }
    lines.splice(at, 0, ...next);
  }
  return lines.join('\n');
}

/** The body's first `# Heading`, and the body without it. */
export function splitTitle(body: string): { title?: string; instructions: string } {
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/.exec(body);
  if (!match) return { instructions: body.trim() };
  return { title: match[1]?.trim(), instructions: body.slice(match[0].length).trim() };
}

export function withTitle(title: string, instructions: string): string {
  return `# ${title.trim()}\n\n${instructions.trim()}`;
}
