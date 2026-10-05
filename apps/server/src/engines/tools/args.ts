/**
 * A tool call's arguments, read forgivingly and checked strictly (ADR 0072).
 *
 * Every engine that runs Conch's tools for a model (the model APIs, Codex's
 * dynamic tools, the door ACP programs reach, Claude Code's in-process server)
 * reads arguments here, in three steps:
 *
 *  1. **Read.** Text is parsed as JSON, mended when it's almost JSON
 *     (`repair.ts`), and unwrapped when it arrived as a JSON string or inside an
 *     `{"arguments": …}` envelope.
 *  2. **Normalise.** Guided only by the tool's own schema: a field the tool
 *     doesn't take is dropped (and the model told), `"3"` becomes 3 where a
 *     number is wanted, `"true"` becomes true where a boolean is, a list or an
 *     object sent as JSON text is read, one value where a list is wanted
 *     becomes a list of one, and an option written in the wrong case is the
 *     option. Nothing else changes: no text is rewritten, no value is invented,
 *     and a value of the right type is never touched.
 *  3. **Check.** The tool's schema, strictly, as before. When it fails, the
 *     model hears exactly which field, what was wanted, what it sent, and the
 *     valid values, in a few lines it can act on.
 *
 * None of this widens what a call may do. A normalised call still passes the
 * same strict check, every permission and guard runs after it on the same
 * values, and nothing here can turn a value of one meaning into another: a
 * number stays the number written, `"false"` is false, never true, and a
 * field the tool doesn't know never reaches it.
 */
import { z } from 'zod';

import { toJsonSchema } from '../api/jsonschema';
import type { JsonSchema } from '../api/types';
import type { HostTool } from '../types';
import { repairJson } from './repair';

/** The envelopes weak models wrap arguments in. Only unwrapped when the tool takes no such field. */
const ENVELOPES = ['arguments', 'parameters', 'args', 'input', 'params'];
/** Deeper than this, the arguments are left as they came. */
const MAX_DEPTH = 24;
/** How much of a wrong value is quoted back. */
const QUOTE = 40;
/** The longest "it takes …" line. */
const SIGNATURE_MAX = 600;

export type Checked =
  { ok: true; args: Record<string, unknown>; notes: string[] } | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── Reading ─────────────────────────────────────────────────────────────────

/** Where a strict parser stopped, to point the model at it. */
function whereItBroke(text: string): string {
  try {
    JSON.parse(text);
    return '';
  } catch (error) {
    const at = /position (\d+)/.exec(String((error as Error).message))?.[1];
    if (at === undefined) return '';
    const n = Number(at);
    const near = text.slice(Math.max(0, n - 20), n + 20).replace(/\s+/g, ' ');
    return ` It stopped making sense near \`${near}\`.`;
  }
}

/**
 * Arguments from text: JSON, mended JSON, or JSON inside a string. A problem
 * is a sentence for the model, never a throw.
 */
export function readArgs(
  text: string,
): { args: Record<string, unknown>; notes: string[] } | { problem: string } {
  const trimmed = text.trim();
  if (!trimmed) return { args: {}, notes: [] };
  const read = repairJson(trimmed);
  if (!read)
    return {
      problem: `Those arguments weren’t JSON.${whereItBroke(trimmed)} Call the tool again with one JSON object, like {"name": "value"}.`,
    };
  const notes: string[] = [];
  let value = read.value;
  // Arguments sent as a JSON string: `"{\"query\": \"x\"}"`.
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    const inner = repairJson(value);
    if (!inner || typeof inner.value === 'string') break;
    value = inner.value;
  }
  // `[{…}]`: one object in a list.
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) value = value[0];
  if (!isRecord(value))
    return {
      problem: `The arguments must be one JSON object, like {"name": "value"}, not ${describe(value)}.`,
    };
  let args = value;
  const others = read.rest.filter(isRecord);
  if (others.length) {
    const differing = others.filter((other) => !sameJson(other, args));
    const overlapping = differing.some((other) => Object.keys(other).some((k) => k in args));
    if (differing.length && !overlapping) {
      // Pieces of one call: `{"path": "a"}{"content": "b"}`.
      args = Object.fromEntries([args, ...differing].flatMap((part) => Object.entries(part)));
    } else if (differing.length) {
      notes.push(
        `You sent ${others.length + 1} argument objects in one call; only the first was used. Call the tool once for each.`,
      );
    }
  }
  return { args, notes };
}

// ── Normalising ─────────────────────────────────────────────────────────────

function typesOf(schema: JsonSchema): string[] {
  const type = schema['type'];
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string');
  // A union of plain branches says its types through them.
  const branches = [schema['anyOf'], schema['oneOf']].find(Array.isArray) as unknown[] | undefined;
  if (branches) return branches.filter(isRecord).flatMap((b) => typesOf(b));
  if (Array.isArray(schema['enum'])) {
    const kinds = new Set(schema['enum'].map((v) => (v === null ? 'null' : typeof v)));
    return [...kinds];
  }
  if (isRecord(schema['properties'])) return ['object'];
  return [];
}

function fits(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    default:
      return true;
  }
}

/** The options a field takes, when it's a list of them (`enum`, or `const`, or a union of either). */
function optionsOf(schema: JsonSchema): unknown[] | undefined {
  if (Array.isArray(schema['enum'])) return schema['enum'];
  if ('const' in schema) return [schema['const']];
  const branches = [schema['anyOf'], schema['oneOf']].find(Array.isArray) as unknown[] | undefined;
  if (!branches?.length) return undefined;
  const all: unknown[] = [];
  for (const branch of branches) {
    if (!isRecord(branch)) return undefined;
    if (branch['type'] === 'null') {
      all.push(null);
      continue;
    }
    const some = optionsOf(branch);
    if (!some) return undefined;
    all.push(...some);
  }
  return all;
}

/** The branch of a union that describes objects or lists, to read inside. */
function shapeFor(schema: JsonSchema, type: 'object' | 'array'): JsonSchema | undefined {
  if (typesOf(schema).includes(type) && !schema['anyOf'] && !schema['oneOf']) return schema;
  const branches = [schema['anyOf'], schema['oneOf']].find(Array.isArray) as unknown[] | undefined;
  const matching = branches?.filter(isRecord).filter((b) => typesOf(b).includes(type)) ?? [];
  return matching.length === 1 ? matching[0] : undefined;
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** One value, brought to the type its schema wants where that's unambiguous. */
function coerce(
  value: unknown,
  schema: JsonSchema,
  path: string,
  dropped: string[],
  dropUnknown: boolean,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return value;
  const types = typesOf(schema);
  if (
    types.length &&
    types.some((t) => fits(value, t)) &&
    !isRecord(value) &&
    !Array.isArray(value)
  )
    return fixOption(value, schema);

  if (typeof value === 'string') {
    const text = value.trim();
    if ((types.includes('number') || types.includes('integer')) && NUMBER.test(text)) {
      const n = Number(text);
      if (Number.isFinite(n) && (types.includes('number') || Number.isInteger(n))) return n;
    }
    if (types.includes('boolean') && /^(true|false)$/i.test(text))
      return text.toLowerCase() === 'true';
    if (
      (types.includes('array') && text.startsWith('[')) ||
      (types.includes('object') && text.startsWith('{'))
    ) {
      const read = repairJson(text);
      if (read && (Array.isArray(read.value) || isRecord(read.value)))
        return coerce(read.value, schema, path, dropped, dropUnknown, depth + 1);
    }
    if (types.includes('null') && text === 'null' && !types.includes('string')) return null;
  }
  if (typeof value === 'number' && types.includes('string') && !types.includes('number'))
    return fixOption(String(value), schema);

  if (Array.isArray(value)) {
    const list = shapeFor(schema, 'array');
    if (list) {
      const items = isRecord(list['items']) ? list['items'] : undefined;
      return items
        ? value.map((item, i) =>
            coerce(item, items, `${path}[${i}]`, dropped, dropUnknown, depth + 1),
          )
        : value;
    }
    return value;
  }
  if (isRecord(value)) {
    const object = shapeFor(schema, 'object');
    if (object) return normaliseObject(value, object, path, dropped, dropUnknown, depth + 1);
    return value;
  }
  // One value where a list of them is wanted: a list of one.
  if (types.includes('array') && value !== null && value !== undefined) {
    const list = shapeFor(schema, 'array');
    const items = list && isRecord(list['items']) ? list['items'] : undefined;
    const itemTypes = items ? typesOf(items) : [];
    if (items && itemTypes.length) {
      const one = coerce(value, items, `${path}[0]`, dropped, dropUnknown, depth + 1);
      if (itemTypes.some((t) => fits(one, t))) return [one];
    }
  }
  return value;
}

/** An option written in another case (`"High"` for `"high"`), when exactly one option matches. */
function fixOption(value: unknown, schema: JsonSchema): unknown {
  if (typeof value !== 'string') return value;
  const options = optionsOf(schema);
  if (!options || options.includes(value)) return value;
  const lower = value.trim().toLowerCase();
  const matches = options.filter((o) => typeof o === 'string' && o.toLowerCase() === lower);
  return matches.length === 1 ? matches[0] : value;
}

function normaliseObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  dropped: string[],
  dropUnknown: boolean,
  depth: number,
): Record<string, unknown> {
  const properties = isRecord(schema['properties']) ? schema['properties'] : undefined;
  if (!properties) return value;
  // Explicit catch-all schemas belong to the tool (for example app_try's input).
  // Keep their fields; the tool's Zod schema still validates them afterwards.
  const extra = schema['additionalProperties'];
  const closed = extra === false || (dropUnknown && extra !== true && !isRecord(extra));
  const entries: [string, unknown][] = [];
  for (const [key, field] of Object.entries(value)) {
    const spec = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (!isRecord(spec)) {
      if (closed) dropped.push(path ? `${path}.${key}` : key);
      else entries.push([key, field]);
      continue;
    }
    entries.push([
      key,
      coerce(field, spec, path ? `${path}.${key}` : key, dropped, dropUnknown, depth),
    ]);
  }
  return Object.fromEntries(entries);
}

/**
 * Arguments brought to the schema where a model's slip is unambiguous.
 * `dropUnknown` drops fields the schema doesn't name, at every level (Conch's
 * own tools, which are strict), except explicit catch-all object schemas;
 * otherwise only where the schema says
 * `additionalProperties: false` (an integration's, which may take more).
 */
export function normaliseArgs(
  schema: JsonSchema,
  raw: Record<string, unknown>,
  { dropUnknown }: { dropUnknown: boolean },
): { args: Record<string, unknown>; dropped: string[] } {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  let args = raw;
  // `{"arguments": {…}}` around arguments the tool would take by themselves.
  const keys = Object.keys(raw);
  const only = keys.length === 1 ? keys[0] : undefined;
  if (only && ENVELOPES.includes(only) && !Object.hasOwn(properties, only)) {
    const inner = raw[only];
    const parsed = typeof inner === 'string' ? repairJson(inner)?.value : inner;
    if (isRecord(parsed)) args = parsed;
  }
  const dropped: string[] = [];
  return { args: normaliseObject(args, schema, '', dropped, dropUnknown, 0), dropped };
}

// ── Explaining ──────────────────────────────────────────────────────────────

/** A value as the model would recognise it, briefly. */
export function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const clipped = value.length > QUOTE ? `${value.slice(0, QUOTE)}…` : value;
    return `the text ${JSON.stringify(clipped)}`;
  }
  if (typeof value === 'number') return `the number ${value}`;
  if (typeof value === 'boolean') return `${value}`;
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (isRecord(value)) return 'an object';
  return typeof value;
}

const TYPE_WORDS: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  integer: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  object: 'an object',
  null: 'null',
};

function pathOf(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out || '(the arguments)';
}

function optionList(values: readonly unknown[]): string {
  const shown = values.slice(0, 12).map((v) => JSON.stringify(v));
  return `${shown.join(', ')}${values.length > 12 ? ', …' : ''}`;
}

/** Zod's issue, in one line a model can act on. */
function issueLine(issue: z.core.$ZodIssue): string {
  const where = pathOf(issue.path);
  const input = 'input' in issue ? issue.input : undefined;
  switch (issue.code) {
    case 'invalid_type': {
      const wanted = TYPE_WORDS[issue.expected] ?? issue.expected;
      return input === undefined
        ? `- ${where}: required (${wanted}), but it was missing.`
        : `- ${where}: expected ${wanted}, got ${describe(input)}.`;
    }
    case 'invalid_value':
      return issue.values.length === 1
        ? `- ${where}: must be ${JSON.stringify(issue.values[0])}, got ${describe(input)}.`
        : `- ${where}: must be one of ${optionList(issue.values)}; got ${describe(input)}.`;
    case 'too_small':
    case 'too_big': {
      const bound = issue.code === 'too_small' ? issue.minimum : issue.maximum;
      const most = issue.code === 'too_small' ? 'at least' : 'at most';
      const unit =
        issue.origin === 'string'
          ? ' characters'
          : issue.origin === 'array' || issue.origin === 'set'
            ? ' items'
            : '';
      return `- ${where}: must be ${most} ${String(bound)}${unit}; got ${describe(input)}.`;
    }
    case 'invalid_format': {
      // A tool's own message (`Use a ref from the page text, like e12.`) says it best.
      const own = issue.message && !/^Invalid/.test(issue.message) ? ` ${issue.message}` : '';
      const rule = issue.format === 'regex' && issue.pattern ? ` (pattern ${issue.pattern})` : '';
      return `- ${where}: not a valid ${issue.format}${rule}; got ${describe(input)}.${own}`;
    }
    case 'unrecognized_keys':
      return `- ${where}: this tool doesn’t take ${optionList(issue.keys)}.`;
    case 'invalid_union':
      return `- ${where}: matches none of the shapes it allows; got ${describe(input)}.`;
    default:
      return `- ${where}: ${issue.message}`;
  }
}

/** A JSON Schema type, as a short signature: `{query: string, limit?: integer}`. */
function typeText(schema: unknown, depth: number): string {
  if (!isRecord(schema)) return 'any';
  const options = optionsOf(schema);
  if (options?.length && options.length <= 12)
    return options.map((o) => JSON.stringify(o)).join('|');
  const types = typesOf(schema).filter((t) => t !== 'null');
  const type = types.length === 1 ? types[0] : undefined;
  if (type === 'array') return `${typeText(schema['items'], depth)}[]`;
  if (type === 'object' && isRecord(schema['properties'])) {
    if (depth >= 2) return 'object';
    return objectText(schema, depth + 1);
  }
  return types.length ? types.join('|') : 'any';
}

function objectText(schema: JsonSchema, depth: number): string {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : []);
  const parts = Object.entries(properties).map(
    ([key, field]) => `${key}${required.has(key) ? '' : '?'}: ${typeText(field, depth)}`,
  );
  return `{${parts.join(', ')}}`;
}

/** What a tool takes, in one short line. */
export function signature(schema: JsonSchema): string {
  const text = objectText(schema, 0);
  return text.length > SIGNATURE_MAX ? `${text.slice(0, SIGNATURE_MAX - 1)}…}` : text;
}

/** The sentence a model reads when its arguments don't fit. */
function mismatch(name: string, lines: string[], schema: JsonSchema, notes: string[]): string {
  return [
    `The arguments for ${name} don’t fit. Fix ${lines.length === 1 ? 'this' : 'these'} and call it again:`,
    ...lines.slice(0, 12),
    ...(lines.length > 12 ? [`- …and ${lines.length - 12} more.`] : []),
    ...notes.map((note) => `- ${note}`),
    `It takes: ${signature(schema)}`,
  ].join('\n');
}

function droppedNote(dropped: string[]): string[] {
  return dropped.length
    ? [
        `Ignored ${dropped.length === 1 ? 'a field' : 'fields'} this tool doesn’t take: ${dropped.join(', ')}.`,
      ]
    : [];
}

// ── Checking ────────────────────────────────────────────────────────────────

const schemas = new WeakMap<z.ZodRawShape, JsonSchema>();

/** A host tool's JSON Schema, worked out once per shape. */
function schemaOf(shape: z.ZodRawShape): JsonSchema {
  let schema = schemas.get(shape);
  if (!schema) {
    schema = toJsonSchema(shape);
    schemas.set(shape, schema);
  }
  return schema;
}

function start(
  raw: unknown,
): { args: Record<string, unknown>; notes: string[] } | { problem: string } {
  if (typeof raw === 'string') return readArgs(raw);
  if (raw === undefined || raw === null) return { args: {}, notes: [] };
  if (!isRecord(raw))
    return {
      problem: `The arguments must be one JSON object, like {"name": "value"}, not ${describe(raw)}.`,
    };
  return { args: raw, notes: [] };
}

/**
 * One of Conch's own tools: arguments read, normalised and checked against
 * its strict schema. The result is either arguments the tool can run with, or
 * the sentence the model needs.
 */
export function checkHostArgs(
  tool: Pick<HostTool, 'name' | 'input'>,
  raw: unknown,
  name = tool.name,
): Checked {
  const read = start(raw);
  if ('problem' in read) return { ok: false, message: read.problem };
  const schema = schemaOf(tool.input);
  const { args, dropped } = normaliseArgs(schema, read.args, { dropUnknown: true });
  const notes = [...read.notes, ...droppedNote(dropped)];
  const parsed = z.object(tool.input).strict().safeParse(args, { reportInput: true });
  if (parsed.success) return { ok: true, args: parsed.data, notes };
  return { ok: false, message: mismatch(name, parsed.error.issues.map(issueLine), schema, notes) };
}

/** A JSON Schema node that says more than this check reads: left to the tool's own server. */
function opaque(schema: JsonSchema): boolean {
  return ['anyOf', 'oneOf', 'allOf', '$ref', 'not', 'if'].some((k) => k in schema);
}

/**
 * The plain mistakes in arguments for an integration's tool: a required field
 * missing, a value of the wrong type, an option that isn't one. Anything the
 * schema says in a way this doesn't read is left for the tool's own server to
 * judge, so a valid call is never refused here.
 */
function plainMistakes(schema: JsonSchema, value: unknown, path: string, depth: number): string[] {
  if (depth > MAX_DEPTH || opaque(schema)) return [];
  const where = path || '(the arguments)';
  if (schema['nullable'] === true && value === null) return [];
  const types = typesOf(schema);
  if (types.length && !types.some((t) => fits(value, t)))
    return [
      `- ${where}: expected ${types.map((t) => TYPE_WORDS[t] ?? t).join(' or ')}, got ${describe(value)}.`,
    ];
  if (Array.isArray(schema['enum']) && !schema['enum'].some((o) => sameJson(o, value)))
    return [`- ${where}: must be one of ${optionList(schema['enum'])}; got ${describe(value)}.`];
  if (isRecord(value) && isRecord(schema['properties'])) {
    const lines: string[] = [];
    const required = Array.isArray(schema['required']) ? schema['required'] : [];
    for (const key of required)
      // A required field the schema never describes is the schema's own slip
      // (real servers ship them): the server decides whether it's needed.
      if (
        typeof key === 'string' &&
        Object.hasOwn(schema['properties'], key) &&
        !Object.hasOwn(value, key)
      ) {
        const spec = schema['properties'][key];
        const wanted = isRecord(spec) ? typesOf(spec).map((t) => TYPE_WORDS[t] ?? t) : [];
        lines.push(
          `- ${path ? `${path}.${key}` : key}: required${wanted.length ? ` (${wanted.join(' or ')})` : ''}, but it was missing.`,
        );
      }
    for (const [key, field] of Object.entries(value)) {
      const spec = Object.hasOwn(schema['properties'], key) ? schema['properties'][key] : undefined;
      if (isRecord(spec))
        lines.push(...plainMistakes(spec, field, path ? `${path}.${key}` : key, depth + 1));
    }
    return lines;
  }
  if (Array.isArray(value) && isRecord(schema['items'])) {
    const items = schema['items'];
    return value.flatMap((item, i) => plainMistakes(items, item, `${path}[${i}]`, depth + 1));
  }
  return [];
}

/** An integration's tool: arguments read, normalised and checked for the plain mistakes. */
export function checkBridgedArgs(name: string, schema: JsonSchema, raw: unknown): Checked {
  const read = start(raw);
  if ('problem' in read) return { ok: false, message: read.problem };
  const { args, dropped } = normaliseArgs(schema, read.args, { dropUnknown: false });
  const notes = [...read.notes, ...droppedNote(dropped)];
  const lines = plainMistakes(schema, args, '', 0);
  if (lines.length) return { ok: false, message: mismatch(name, lines, schema, notes) };
  return { ok: true, args, notes };
}

/** What Conch quietly changed, after the tool's answer, so the model calls it right next time. */
export function withNotes(text: string, notes: readonly string[]): string {
  return notes.length ? `${text}\n\n[${notes.join(' ')}]` : text;
}

// ── Claude Code ─────────────────────────────────────────────────────────────

const lenient = new WeakMap<z.ZodRawShape, z.ZodRawShape>();

/**
 * The same shape, advertised the same, but accepting any value per field, so
 * an engine that validates before Conch sees the call (Claude Code's
 * in-process MCP server) hands the arguments to `checkHostArgs` instead of
 * refusing them with a message no small model can act on. Each field keeps
 * its exact JSON Schema through Zod's metadata; a field that schema can't be
 * read from keeps its own validation.
 */
export function lenientShape(shape: z.ZodRawShape): z.ZodRawShape {
  const known = lenient.get(shape);
  if (known) return known;
  const out: Record<string, z.core.$ZodType> = {};
  for (const [key, field] of Object.entries(shape)) {
    let json: JsonSchema;
    try {
      json = z.toJSONSchema(field, {
        target: 'draft-7',
        io: 'input',
        unrepresentable: 'any',
      }) as JsonSchema;
    } catch {
      out[key] = field;
      continue;
    }
    delete json['$schema'];
    // A schema that refers to itself, or carries an id, isn't safe to copy into metadata.
    if ('id' in json || /"(?:\$ref|\$defs|definitions)":/.test(JSON.stringify(json))) {
      out[key] = field;
      continue;
    }
    const any = z.unknown().meta(json);
    // Identity on the way in keeps a required field required in the schema, yet lets it be missing.
    out[key] = z.safeParse(field, undefined).success
      ? any.optional()
      : z.preprocess((value) => value, any);
  }
  lenient.set(shape, out);
  return out;
}
