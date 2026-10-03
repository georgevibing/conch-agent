/**
 * Someone else's words, made safe to hand a model (ADR 0061, ADR 0028): a
 * stranger's app names itself, describes its tools and tells the assistant
 * how to use it, and none of that may read as an instruction from the user
 * or from Conch.
 */
import type { ConchAppSource } from '@conch/protocol';

/**
 * Characters that show nothing but can carry words a model reads: format
 * characters (zero-width, bidi controls, the tag block U+E0000–E007F used to
 * smuggle hidden text), private use and unassigned code points.
 */
const INVISIBLE = /[\p{Cf}\p{Co}\p{Cn}]/gu;

/**
 * One short line of text: no control characters or line breaks (so never a
 * heading or a second line), nothing invisible, no backticks (never a
 * fence), quotes and angle brackets turned into ones that can't close a
 * quote or open a tag, and a cap. Ordinary spaces stay.
 */
export function plainLine(text: string, max = 160): string {
  const plain = [...text.replace(INVISIBLE, '')]
    .map((c) => {
      const code = c.charCodeAt(0);
      if (code < 32 || code === 127 || c === '`') return ' ';
      if (c === '"' || c === '“' || c === '”') return '″';
      if (c === '<') return '‹';
      if (c === '>') return '›';
      return c;
    })
    .join('');
  const line = plain.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const SCHEMA_TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array', 'null']);
const PROPERTY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SCHEMA_TEXT_MAX = 200;
const SCHEMA_DEPTH = 3;
const SCHEMA_PROPERTIES = 32;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value >= 0;

/**
 * A tool's input schema as a model may see it, rebuilt from an allowlist:
 * type, properties, required, enum, items, minimum and maximum, minLength
 * and maxLength, title and description. Every word goes through
 * `plainLine`; at most three levels deep and 32 properties in all. Anything
 * else an app's module declared is dropped, so its schema can't carry
 * instructions in places nobody reads.
 */
export function safeSchema(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  let left = SCHEMA_PROPERTIES;
  const clean = (raw: unknown, depth: number): Record<string, unknown> => {
    const node =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    const type = node['type'];
    if (typeof type === 'string' && SCHEMA_TYPES.has(type)) out['type'] = type;
    else if (Array.isArray(type)) {
      const types = type.filter((t): t is string => typeof t === 'string' && SCHEMA_TYPES.has(t));
      if (types.length) out['type'] = types;
    }
    for (const key of ['title', 'description'] as const)
      if (typeof node[key] === 'string') {
        const text = plainLine(node[key], SCHEMA_TEXT_MAX);
        if (text) out[key] = text;
      }
    if (Array.isArray(node['enum'])) {
      const values = node['enum']
        .filter((v) => typeof v === 'string' || finite(v) || typeof v === 'boolean' || v === null)
        .slice(0, 50)
        .map((v) => (typeof v === 'string' ? plainLine(v, SCHEMA_TEXT_MAX) : v));
      if (values.length) out['enum'] = values;
    }
    for (const key of ['minimum', 'maximum'] as const) if (finite(node[key])) out[key] = node[key];
    for (const key of ['minLength', 'maxLength'] as const)
      if (count(node[key])) out[key] = node[key];
    if (depth < SCHEMA_DEPTH && node['items'] && typeof node['items'] === 'object')
      out['items'] = clean(node['items'], depth + 1);
    const properties = node['properties'];
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const kept: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(properties as Record<string, unknown>)) {
        if (left <= 0) break;
        if (!PROPERTY.test(name)) continue;
        left--;
        kept[name] = depth < SCHEMA_DEPTH ? clean(value, depth + 1) : {};
      }
      out['properties'] = kept;
      if (Array.isArray(node['required'])) {
        const required = node['required'].filter(
          (r): r is string => typeof r === 'string' && Object.hasOwn(kept, r),
        );
        if (required.length) out['required'] = [...new Set(required)];
      }
    }
    return out;
  };
  return clean(input, 0);
}

/**
 * A record's own value for a key, never one it inherits: a setting called
 * `constructor` or an app called `tostring` is just a name.
 */
export const own = <T>(
  record: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined => (record && Object.hasOwn(record, key) ? record[key] : undefined);

/** Someone else's words, as one quoted line of data. */
export const quoted = (text: string, max = 160): string => `“${plainLine(text, max)}”`;

/** Where an app came from, in a few words: "github.com/bea/weather", "example.com", "weather.conchapp". */
export function sourceName(source: ConchAppSource): string {
  switch (source.kind) {
    case 'made':
      if (source.basedOn) return sourceName(source.basedOn.source);
      if (source.afterReading?.length)
        return `a chat that read ${plainLine(source.afterReading.slice(0, 2).join(' and '), 120)}`;
      return 'this Conch';
    case 'github':
      return plainLine(`github.com/${source.owner}/${source.repo}`, 120);
    case 'link': {
      const host = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#\s]+)/i.exec(source.url)?.[1];
      return host ? plainLine(host.toLowerCase(), 120) : 'a link';
    }
    case 'file':
      return plainLine(source.name, 120);
  }
}
