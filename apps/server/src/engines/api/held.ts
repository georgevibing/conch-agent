/**
 * More tools than a turn can carry (ADR 0072): the rest are held back, never
 * dropped.
 *
 * A model reads its whole tool list every request, so past a point Conch sends
 * fewer. Cutting the rest in silence is what made a connected app look broken:
 * the prompt said GitHub was there, the turn had none of its tools, and the
 * model told the person to reconnect it. So what doesn't fit waits behind
 * `find_tools`, and the system prompt says which apps it's holding:
 *
 *  - **What's sent first:** Conch's own tools, then the tools of the apps the
 *    person's message names, then the other apps', each app keeping at least a
 *    share of the room.
 *  - **Loading (`stable: false`):** an engine that sends its tools each request
 *    (the API engine) loads what `find_tools` finds into the same map, so the
 *    model calls it by name from the next request.
 *  - **Calling through (`stable: true`):** an engine whose tools are fixed when
 *    its thread starts (Codex can't be given new ones, ADR 0036) gets
 *    `use_tool` beside `find_tools`, which runs a held-back tool by name. What
 *    it sends depends only on the tools, never on the message, so the thread
 *    carries on.
 *
 * Pure apart from the tools it wraps: the engine decides when, this file what.
 */
import type { Callable } from './engine';
import { FIND_LIMIT, FIND_TOOLS, findToolsSpec, searchTools } from './lean';
import type { ToolSpec } from './types';

/** More tools than this and the model spends its context reading the list. */
export const MAX_TOOLS = 128;
/** The tool that runs a held-back tool, for an engine that can't be given new ones. */
export const USE_TOOL = 'use_tool';
/** Of the room, apps keep at least this share when Conch's own tools would fill it. */
const APP_SHARE = 1 / 3;
/** The apps the person named may take up to this share, so what they asked for is there. */
const NAMED_SHARE = 2 / 3;

export interface HeldTools {
  /** What the turn sends: the tools that fit, and `find_tools` (and `use_tool`) when some don't. */
  tools: Map<string, Callable>;
  /** What waits to be found, by wire name. Empty when everything fits. */
  held: ReadonlyMap<string, Callable>;
  /** For the system prompt: what's held back and how to reach it. Empty when nothing is. */
  note: string;
  /**
   * The tool a call really runs, and its arguments: a `use_tool` call is the tool it
   * names, so what's shown, recorded and guarded (the guard after reading) is that tool.
   */
  resolve(name: string, args: Record<string, unknown>): Resolved | undefined;
}

export interface Resolved {
  tool: Callable;
  args: Record<string, unknown>;
}

/** The app server a tool's shown name belongs to (`mcp__github__get_file` → `github`). */
export function appOf(display: string): string | undefined {
  const match = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(display);
  return match && match[1] !== 'conch' ? match[1] : undefined;
}

/** Whether the person's words name this app (`github`, `github-2` for "GitHub"). */
function named(server: string, said: string): boolean {
  const base = server.replace(/-\d+$/, '').toLowerCase();
  if (base.length < 3) return false;
  const words = said.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return ` ${words} `.includes(` ${base.replace(/[^a-z0-9]+/g, ' ')} `);
}

/**
 * The tools a turn sends, at most `max`, and the rest held back behind
 * `find_tools`. Nothing is held when everything fits.
 */
export function holdBack(
  all: ReadonlyMap<string, Callable>,
  {
    max = MAX_TOOLS,
    said = '',
    stable = false,
  }: { max?: number; said?: string; stable?: boolean } = {},
): HeldTools {
  if (all.size <= max) {
    const tools = new Map(all);
    return { tools, held: new Map(), note: '', resolve: direct(tools) };
  }
  const room = Math.max(1, max - (stable ? 2 : 1));
  const own: string[] = [];
  const asked: string[] = [];
  const apps: string[] = [];
  for (const [wire, tool] of all) {
    const server = tool.app ? appOf(tool.display) : undefined;
    if (!server) own.push(wire);
    else if (!stable && named(server, said)) asked.push(wire);
    else apps.push(wire);
  }
  // Apps keep a share of the room, more for the ones the person named, which come first.
  const appRoom = Math.min(
    asked.length + apps.length,
    Math.max(
      Math.floor(room * APP_SHARE),
      Math.min(asked.length, Math.floor(room * NAMED_SHARE)),
      room - own.length,
    ),
  );
  const keep = [...own.slice(0, room - appRoom), ...[...asked, ...apps].slice(0, appRoom)];
  const kept = new Set(keep);
  const tools = new Map<string, Callable>();
  for (const [wire, tool] of all) if (kept.has(wire)) tools.set(wire, tool);
  const held = new Map([...all].filter(([wire]) => !kept.has(wire)));

  const taken = new Set(all.keys());
  const find = free(FIND_TOOLS, taken);
  const use = stable ? free(USE_TOOL, taken) : undefined;
  tools.set(find, {
    spec: { ...findToolsSpec(find), description: findDescription(use) },
    display: `mcp__conch__${FIND_TOOLS}`,
    run: async (args) => {
      const query = typeof args.query === 'string' ? args.query.slice(0, 300) : '';
      const found = searchTools(query, entries(held), FIND_LIMIT * 2);
      const specs: ToolSpec[] = [];
      for (const wire of found) {
        const tool = held.get(wire);
        if (!tool) continue;
        if (!use) tools.set(wire, tool);
        specs.push(tool.spec);
      }
      return { text: foundText(specs, query, use), isError: false };
    },
  });
  // Never run itself: `resolve` turns a call to it into the tool it names.
  if (use)
    tools.set(use, {
      spec: useToolSpec(use),
      display: `mcp__conch__${USE_TOOL}`,
      run: async (args) => ({ text: notFound(args.name, find), isError: true }),
    });
  const self = direct(tools);
  const resolve = (name: string, args: Record<string, unknown>): Resolved | undefined => {
    if (name !== use) {
      const tool = tools.get(name) ?? held.get(name);
      return tool ? { tool, args } : undefined;
    }
    const wanted = typeof args.name === 'string' ? args.name : '';
    const tool = wanted === use ? undefined : (held.get(wanted) ?? tools.get(wanted));
    // A name it doesn't know: the tool itself says how to find the right one.
    if (!tool) return self(name, args);
    const inner = args.arguments;
    return {
      tool,
      args:
        inner && typeof inner === 'object' && !Array.isArray(inner)
          ? (inner as Record<string, unknown>)
          : {},
    };
  };
  return { tools, held, note: heldNote(held, all, find, use), resolve };
}

function direct(tools: ReadonlyMap<string, Callable>) {
  return (name: string, args: Record<string, unknown>): Resolved | undefined => {
    const tool = tools.get(name);
    return tool ? { tool, args } : undefined;
  };
}

function notFound(name: unknown, find: string): string {
  const said = typeof name === 'string' ? name.slice(0, 100) : '';
  return `No tool is called “${said}”. Call ${find} with what you want to do to see the names.`;
}

function free(name: string, taken: ReadonlySet<string>): string {
  let wire = name;
  for (let n = 2; taken.has(wire); n++) wire = `${name}_${n}`;
  return wire;
}

function entries(tools: ReadonlyMap<string, Callable>) {
  return [...tools.entries()].map(([wire, tool]) => ({
    name: wire,
    display: tool.display,
    description: tool.spec.description,
  }));
}

function findDescription(use: string | undefined): string {
  return use
    ? `Find tools that aren't in your list yet: there are more than fit at once, including some of the apps' tools. Say what you want to do, or name the app ("github read a file", "cloudflare worker logs"). The matching tools are described with their names and arguments; run one with ${use}.`
    : `Load tools that aren't in your list yet: there are more than fit at once, including some of the apps' tools. Say what you want to do, or name the app ("github read a file", "cloudflare worker logs"). The matching tools are loaded and described, and you can call them straight away.`;
}

function useToolSpec(name: string): ToolSpec {
  return {
    name,
    description:
      'Run a tool that find_tools described but that isn’t in your list. Give its exact name and its arguments.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The tool’s exact name, as find_tools gave it.' },
        arguments: { type: 'object', description: 'The tool’s arguments, as its schema says.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  };
}

function foundText(found: readonly ToolSpec[], query: string, use: string | undefined): string {
  if (!found.length)
    return `No held-back tool matches “${query.slice(0, 100)}”. Try other words, or the app’s name; the tools in your list are there already.`;
  return [
    use
      ? `Found ${found.length}; run ${found.length === 1 ? 'it' : 'one'} with ${use} (its name, and its arguments):`
      : `Loaded ${found.length}; call ${found.length === 1 ? 'it' : 'any of them'} now:`,
    ...found.map(
      (tool) =>
        `- ${tool.name}: ${tool.description.slice(0, 400)}\n  Arguments: ${JSON.stringify(tool.schema).slice(0, 1_200)}`,
    ),
  ].join('\n');
}

/** The system prompt's line about what's held back, by app, so the model looks before it gives up. */
function heldNote(
  held: ReadonlyMap<string, Callable>,
  all: ReadonlyMap<string, Callable>,
  find: string,
  use: string | undefined,
): string {
  if (!held.size) return '';
  const count = (tools: ReadonlyMap<string, Callable>) => {
    const by = new Map<string, number>();
    for (const tool of tools.values()) {
      const server = tool.app ? appOf(tool.display) : undefined;
      if (server) by.set(server, (by.get(server) ?? 0) + 1);
    }
    return by;
  };
  const totals = count(all);
  const apps = [...count(held)].map(
    ([server, n]) => `\`${server}\` (${n} of ${totals.get(server)})`,
  );
  return [
    '## Tools held back',
    `You have more tools than fit in one list, so ${held.size} wait to be found${apps.length ? `, among them tools of these apps: ${apps.join(', ')}` : ''}.`,
    `Call ${find} with what you want to do or the app's name${use ? `, then run what it finds with ${use}` : ', and call what it loads'}. Never tell the person an app or a tool isn't available before you've looked.`,
  ].join('\n');
}
