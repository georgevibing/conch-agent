/**
 * Tool schemas the way real MCP servers write them, for the sanitiser's tests
 * (ADR 0069). Each is shaped after a server people connect: Python servers
 * built on Pydantic (FastMCP, the reference `fetch` and `git` servers), Go
 * servers built on mcp-go (GitHub's), TypeScript servers built on Zod
 * (Notion's, Playwright's), and the awkward cases they produce between them.
 */
import type { JsonSchema } from './types';

export const MCP_SCHEMAS: Record<string, JsonSchema> = {
  /** The reference `fetch` server (Pydantic): titles, formats, exclusive bounds, defaults. */
  fetch: {
    type: 'object',
    title: 'Fetch',
    description: 'Parameters for fetching a URL.',
    properties: {
      url: {
        type: 'string',
        format: 'uri',
        minLength: 1,
        title: 'Url',
        description: 'URL to fetch',
      },
      max_length: {
        type: 'integer',
        exclusiveMaximum: 1000000,
        exclusiveMinimum: 0,
        default: 5000,
        title: 'Max Length',
        description: 'Maximum number of characters to return.',
      },
      start_index: { type: 'integer', minimum: 0, default: 0, title: 'Start Index' },
      raw: { type: 'boolean', default: false, title: 'Raw' },
    },
    required: ['url'],
  },
  /** A FastMCP tool: `$defs`, `$ref` with a default beside it, Optional as `anyOf` with null. */
  pydanticTask: {
    $defs: {
      Priority: { enum: ['low', 'medium', 'high'], title: 'Priority', type: 'string' },
      Label: {
        properties: {
          name: { title: 'Name', type: 'string' },
          color: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Color' },
        },
        required: ['name'],
        title: 'Label',
        type: 'object',
      },
    },
    properties: {
      title: { title: 'Title', type: 'string' },
      priority: { $ref: '#/$defs/Priority', default: 'medium' },
      labels: {
        anyOf: [{ items: { $ref: '#/$defs/Label' }, type: 'array' }, { type: 'null' }],
        default: null,
        title: 'Labels',
      },
      due: {
        anyOf: [{ format: 'date-time', type: 'string' }, { type: 'null' }],
        default: null,
        title: 'Due',
      },
      estimate: { anyOf: [{ type: 'integer' }, { type: 'number' }], title: 'Estimate' },
    },
    required: ['title'],
    title: 'create_taskArguments',
    type: 'object',
  },
  /** GitHub's server (mcp-go): plain, with lists and an enum. */
  githubListIssues: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      state: {
        type: 'string',
        description: 'Filter by state',
        enum: ['open', 'closed', 'all'],
      },
      labels: { type: 'array', description: 'Filter by labels', items: { type: 'string' } },
      perPage: {
        type: 'number',
        description: 'Results per page (min 1, max 100)',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['owner', 'repo'],
  },
  /** A tool with no arguments, as mcp-go and many others write it. */
  githubGetMe: { type: 'object', properties: {} },
  /** A Zod server (Notion-like): `$schema`, closed objects, a union of objects, a map, examples, a field named `properties`. */
  notionCreatePages: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      parent: {
        anyOf: [
          {
            type: 'object',
            properties: { page_id: { type: 'string', format: 'uuid' } },
            required: ['page_id'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { database_id: { type: 'string', format: 'uuid' } },
            required: ['database_id'],
            additionalProperties: false,
          },
        ],
      },
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            properties: { type: 'object', additionalProperties: { type: 'string' } },
            content: { type: 'string', examples: ['# Heading'] },
          },
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: 100,
      },
    },
    required: ['pages'],
    additionalProperties: false,
  },
  /** A recursive filter, through `definitions`, with a many-typed value. */
  recursiveFilter: {
    type: 'object',
    properties: { filter: { $ref: '#/definitions/Filter' } },
    definitions: {
      Filter: {
        type: 'object',
        properties: {
          and: { type: 'array', items: { $ref: '#/definitions/Filter' } },
          property: { type: 'string' },
          equals: { type: ['string', 'number', 'boolean', 'null'] },
          pattern: { type: 'string', pattern: '^[a-z]+$' },
        },
      },
    },
  },
  /** Playwright's server: closed, with a list. */
  playwrightSelect: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      element: { type: 'string', description: 'Human-readable element description' },
      ref: { type: 'string', description: 'Exact target element reference from the page snapshot' },
      values: { type: 'array', items: { type: 'string' } },
    },
    required: ['element', 'ref', 'values'],
    additionalProperties: false,
  },
  /** Either one field or another, said at the root. */
  rootUnion: {
    type: 'object',
    anyOf: [
      { properties: { id: { type: 'string' } }, required: ['id'] },
      { properties: { email: { type: 'string', format: 'email' } }, required: ['email'] },
    ],
  },
  /** Odd but seen: integer options, a constant, an array without items, a typeless field. */
  oddities: {
    type: 'object',
    properties: {
      priority: { type: 'integer', enum: [0, 1, 2, 3] },
      kind: { const: 'issue' },
      tags: { type: 'array' },
      anything: { description: 'Any value' },
      tuple: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
      broken: { $ref: '#/$defs/Missing' },
      external: { $ref: 'https://example.com/schema.json' },
    },
    required: ['priority', 'not-a-property'],
  },
};
