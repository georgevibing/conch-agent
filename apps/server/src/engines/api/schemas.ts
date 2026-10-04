/**
 * Tool schemas each provider family will take (ADR 0072).
 *
 * An integration's schema comes straight from its MCP server: `$ref`s into
 * `$defs`, `anyOf` with `null` for an optional field (every Python server made
 * with Pydantic), `additionalProperties`, `default`, `examples`, `pattern`,
 * formats nobody else knows. Most providers take all of it. Some refuse the
 * whole request over one keyword, and a refused request is a chat with no
 * tools. So each family gets the schema in the dialect it reads:
 *
 *  - `permissive` (OpenAI and most OpenAI-style servers, Ollama): as sent,
 *    with the document's `$schema` taken off and the root made an object.
 *  - `gemini` (Gemini's OpenAI endpoint, Google models through OpenRouter):
 *    the OpenAPI subset Gemini reads. References are inlined; a `null` branch
 *    becomes `nullable`; options become text; a node without a type gets one;
 *    keywords it rejects go, the useful ones (a default, a format) moved into
 *    the description so the model still reads them.
 *  - `anthropic`: JSON Schema, but the root must be one object, so `anyOf`,
 *    `oneOf` and `allOf` at the root are merged into it.
 *  - `strict`: the last try before Conch stops sending tools natively, used
 *    after a provider refused a schema once. The Gemini subset, with every
 *    union reduced to its first choice and only the keywords no provider
 *    refuses: type, description, enum, items, properties, required.
 *
 * Every transform is a pure function of an untrusted document, so each is
 * bounded: references are followed a few levels deep, and a schema bigger
 * than any tool needs stops being expanded rather than growing without end.
 */
import type { JsonSchema, ToolSpec } from './types';

export type SchemaFamily = 'permissive' | 'gemini' | 'anthropic' | 'strict';

/** References followed into one another before a node becomes "any object". */
const MAX_REF_DEPTH = 6;
/** Nodes written in one schema before the rest are left out. */
const MAX_NODES = 4_000;
/** Nesting walked before a node becomes "any object". */
const MAX_DEPTH = 24;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Gemini's own formats, by type. */
const GEMINI_FORMATS: Record<string, readonly string[]> = {
  string: ['enum', 'date-time'],
  number: ['float', 'double'],
  integer: ['int32', 'int64'],
};

/** The keywords each reduced dialect keeps. */
const GEMINI_KEYS = new Set([
  'type',
  'description',
  'nullable',
  'enum',
  'format',
  'items',
  'properties',
  'required',
  'anyOf',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
]);
const STRICT_KEYS = new Set(['type', 'description', 'enum', 'items', 'properties', 'required']);

interface Walk {
  root: JsonSchema;
  family: 'gemini' | 'strict';
  nodes: number;
}

/** A local reference (`#/$defs/Name`, `#/definitions/Name`, `#`), resolved in the root. */
function resolve(root: JsonSchema, ref: string): JsonSchema | undefined {
  if (!ref.startsWith('#')) return undefined;
  const parts = ref
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p.replace(/~1/g, '/').replace(/~0/g, '~')));
  let at: unknown = root;
  for (const part of parts) {
    if (!isRecord(at) || !Object.hasOwn(at, part)) return undefined;
    at = at[part];
  }
  return isRecord(at) ? at : undefined;
}

/** The type a typeless node most likely has, from what else it says. */
function guessType(node: JsonSchema): string {
  if (isRecord(node['properties'])) return 'object';
  if ('items' in node) return 'array';
  if (Array.isArray(node['enum'])) return 'string';
  return 'string';
}

/** What a reduced dialect drops but a model would still want to read. */
function hints(node: JsonSchema, type: string, family: Walk['family']): string[] {
  const out: string[] = [];
  const format = node['format'];
  if (
    typeof format === 'string' &&
    (family === 'strict' || !GEMINI_FORMATS[type]?.includes(format))
  )
    out.push(`Format: ${format}.`);
  if ('default' in node && node['default'] !== undefined && node['default'] !== null) {
    const shown = JSON.stringify(node['default']);
    if (shown && shown.length <= 60) out.push(`Default: ${shown}.`);
  }
  return out;
}

/** One node of a schema in the Gemini subset (or the strict one). */
function reduce(input: unknown, walk: Walk, refs: number, depth: number): JsonSchema {
  if (++walk.nodes > MAX_NODES || depth > MAX_DEPTH || !isRecord(input))
    return { type: 'object', description: 'Any value.' };
  let node: JsonSchema = input;
  // A reference, followed: what it points at, with this node's own words over it.
  if (typeof node['$ref'] === 'string') {
    const target = refs < MAX_REF_DEPTH ? resolve(walk.root, node['$ref']) : undefined;
    const { $ref: _ref, ...own } = node;
    if (!target)
      return {
        type: 'object',
        ...(typeof own['description'] === 'string' && { description: own['description'] }),
      };
    return reduce({ ...target, ...own }, walk, refs + 1, depth);
  }
  // `allOf`: one shape, its parts merged.
  if (Array.isArray(node['allOf'])) {
    const { allOf, ...own } = node;
    const merged: JsonSchema = { ...own };
    const properties: Record<string, unknown> = isRecord(own['properties'])
      ? { ...own['properties'] }
      : {};
    const required = new Set<unknown>(Array.isArray(own['required']) ? own['required'] : []);
    for (const part of allOf as unknown[]) {
      const piece =
        isRecord(part) && typeof part['$ref'] === 'string'
          ? (resolve(walk.root, part['$ref']) ?? {})
          : part;
      if (!isRecord(piece)) continue;
      if (isRecord(piece['properties'])) Object.assign(properties, piece['properties']);
      if (Array.isArray(piece['required'])) for (const r of piece['required']) required.add(r);
      for (const key of ['type', 'description'] as const)
        if (!(key in merged) && key in piece) merged[key] = piece[key];
    }
    if (Object.keys(properties).length) merged['properties'] = properties;
    if (required.size) merged['required'] = [...required];
    node = merged;
  }

  // Unions: a `null` branch is `nullable`; one branch left is the node itself.
  const unionKey = Array.isArray(node['anyOf'])
    ? 'anyOf'
    : Array.isArray(node['oneOf'])
      ? 'oneOf'
      : undefined;
  let nullable = node['nullable'] === true;
  if (unionKey) {
    const { [unionKey]: union, ...own } = node;
    const branches = (union as unknown[]).filter(isRecord);
    const real = branches.filter((b) => b['type'] !== 'null');
    if (real.length !== branches.length) nullable = true;
    if (real.length === 0)
      return {
        type: 'string',
        nullable: true,
        ...(typeof own['description'] === 'string' && { description: own['description'] }),
      };
    if (real.length === 1 || walk.family === 'strict') {
      const reduced = reduce({ ...real[0], ...own }, walk, refs, depth + 1);
      return nullable && walk.family === 'gemini' ? { ...reduced, nullable: true } : reduced;
    }
    const out: JsonSchema = {
      anyOf: real.map((b) => reduce(b, walk, refs, depth + 1)),
      ...(typeof own['description'] === 'string' && { description: own['description'] }),
      ...(nullable && { nullable: true }),
    };
    return out;
  }

  // `type: ["string", "null"]`: one type, nullable.
  let type = node['type'];
  if (Array.isArray(type)) {
    const real = type.filter((t): t is string => typeof t === 'string' && t !== 'null');
    if (real.length !== type.length) nullable = true;
    if (real.length > 1 && walk.family === 'gemini') {
      const { type: _type, ...own } = node;
      return reduce(
        { ...own, anyOf: real.map((t) => ({ type: t })), ...(nullable && { nullable: true }) },
        walk,
        refs,
        depth,
      );
    }
    type = real[0];
  }
  if ('const' in node && !Array.isArray(node['enum'])) node = { ...node, enum: [node['const']] };
  if (typeof type !== 'string') type = guessType(node);

  const keep = walk.family === 'strict' ? STRICT_KEYS : GEMINI_KEYS;
  const out: JsonSchema = { type };
  const extra = hints(node, String(type), walk.family);
  const said = typeof node['description'] === 'string' ? node['description'] : '';
  const description = [said, ...extra].filter(Boolean).join(' ');
  if (description) out['description'] = description;
  if (nullable && keep.has('nullable')) out['nullable'] = true;

  if (Array.isArray(node['enum'])) {
    // Options are text in this dialect; the arguments check reads them back.
    const options = [
      ...new Set(
        node['enum']
          .filter((v) => v !== null)
          .map((v) => (typeof v === 'string' ? v : JSON.stringify(v))),
      ),
    ];
    if (options.length) {
      out['type'] = 'string';
      out['enum'] = options;
    }
  }
  const format = node['format'];
  if (
    keep.has('format') &&
    typeof format === 'string' &&
    GEMINI_FORMATS[out['type'] as string]?.includes(format) &&
    !out['enum']
  )
    out['format'] = format;
  for (const key of ['minItems', 'maxItems', 'minimum', 'maximum'] as const)
    if (
      keep.has(key) &&
      typeof node[key] === 'number' &&
      Number.isFinite(node[key]) &&
      Math.abs(node[key]) < 2 ** 31
    )
      out[key] = node[key];

  if (out['type'] === 'array') {
    const items = Array.isArray(node['items']) ? node['items'][0] : node['items'];
    out['items'] = isRecord(items) ? reduce(items, walk, refs, depth + 1) : { type: 'string' };
  }
  if (out['type'] === 'object' && isRecord(node['properties'])) {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(node['properties']))
      properties[key] = reduce(value, walk, refs, depth + 1);
    if (Object.keys(properties).length) {
      out['properties'] = properties;
      const required = Array.isArray(node['required'])
        ? [
            ...new Set(
              node['required'].filter(
                (r): r is string => typeof r === 'string' && Object.hasOwn(properties, r),
              ),
            ),
          ]
        : [];
      if (required.length) out['required'] = required;
    }
  }
  return out;
}

/** An object root, the way every provider needs it. */
function asRoot(schema: JsonSchema): JsonSchema {
  const { $schema: _schema, ...rest } = schema;
  if (rest['type'] !== 'object') return { type: 'object', properties: {} };
  return { ...rest, properties: isRecord(rest['properties']) ? rest['properties'] : {} };
}

/** Anthropic: no `anyOf`, `oneOf` or `allOf` at the root; their object branches are merged into it. */
function anthropic(schema: JsonSchema): JsonSchema {
  const root = asRoot(schema);
  const combined = (['anyOf', 'oneOf', 'allOf'] as const).filter((k) => Array.isArray(schema[k]));
  if (!combined.length) return root;
  const out: JsonSchema = Object.fromEntries(
    Object.entries(root).filter(([key]) => !(combined as readonly string[]).includes(key)),
  );
  const properties: Record<string, unknown> = {
    ...(root['properties'] as Record<string, unknown>),
  };
  const required = new Set<string>(
    Array.isArray(root['required'])
      ? root['required'].filter((r): r is string => typeof r === 'string')
      : [],
  );
  for (const key of combined) {
    for (const branch of schema[key] as unknown[]) {
      const part =
        isRecord(branch) && typeof branch['$ref'] === 'string'
          ? resolve(schema, branch['$ref'])
          : branch;
      if (!isRecord(part) || !isRecord(part['properties'])) continue;
      Object.assign(properties, part['properties']);
      // Only `allOf` makes a branch's required fields required.
      if (key === 'allOf' && Array.isArray(part['required']))
        for (const r of part['required']) if (typeof r === 'string') required.add(r);
    }
  }
  return { ...out, properties, ...(required.size ? { required: [...required] } : {}) };
}

/** A tool's schema in the dialect `family` reads. */
export function sanitise(schema: JsonSchema, family: SchemaFamily): JsonSchema {
  if (family === 'permissive') return asRoot(schema);
  if (family === 'anthropic') return anthropic(schema);
  const root = asRoot(schema);
  const reduced = reduce(root, { root: schema, family, nodes: 0 }, 0, 0);
  // The root is always an object; one with no fields says so by leaving them out.
  return { ...reduced, type: 'object' };
}

/** Every spec, sanitised for one family. */
export function sanitiseSpecs(specs: readonly ToolSpec[], family: SchemaFamily): ToolSpec[] {
  return specs.map((spec) => ({ ...spec, schema: sanitise(spec.schema, family) }));
}
