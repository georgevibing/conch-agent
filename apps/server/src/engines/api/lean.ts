/**
 * Lean mode: Conch for a model that reads little at once (ADR 0086).
 *
 * Conch's instructions and its full tool list are tens of thousands of tokens.
 * A model on this computer often reads 8K to 32K in all, so with everything
 * sent there'd be no room left for the chat itself. When the window is small
 * — or what Conch always sends would take more than a third of it — the turn
 * goes lean, by itself:
 *
 *  - **A short system prompt:** who the assistant is, who the person is, what
 *    it remembers, and what it can do. The guidance for each feature arrives
 *    with the feature's tools instead.
 *  - **Tools on demand:** one `find_tools` tool. The model says what it wants
 *    to do, and the best few tools are loaded (their schemas come back in the
 *    answer, and they're sent from then on), like Claude Code's deferred tools.
 *    Tools a chat has loaded stay loaded, up to a handful. A model that calls a
 *    tool by name without loading it first simply gets it.
 *
 * Pure: the engine decides when, this file says what.
 */
import { withResilience } from '../../conversations/resilience';
import { estimateTokens } from './context';
import type { ToolSpec } from './types';

/** At or under this window a model always goes lean. */
export const LEAN_WINDOW = 16_384;
/** Or when Conch's fixed prompt and tools would take more than this share of the window. */
export const LEAN_SHARE = 0.3;
/** How many tools one search loads. */
export const FIND_LIMIT = 5;
/** How many loaded tools a lean chat keeps, newest first. */
export const LOADED_MAX = 10;
/** The name of the one tool a lean turn always has. */
export const FIND_TOOLS = 'find_tools';

/** Whether a turn should go lean, from the window and what it would otherwise carry. */
export function isLean(input: { window: number; system: number; tools: number }): boolean {
  if (input.window <= LEAN_WINDOW) return true;
  return input.system + input.tools > input.window * LEAN_SHARE;
}

/** Top-level sections a lean prompt keeps, and the most each may take. */
const KEEP: readonly { heading: RegExp; max: number }[] = [
  { heading: /^# Who you are\b/, max: 1_600 },
  { heading: /^# About the user\b/, max: 800 },
  { heading: /^# Memory\b/, max: 1_800 },
  // How it works on a problem (ADR 0102), in its compact form by then.
  { heading: /^# How you work on a problem\b/, max: 700 },
  // The agent answering (ADR 0101): its persona, and what it was asked always to do.
  { heading: /^# Your persona\b/, max: 1_000 },
  { heading: /^# Your instructions\b/, max: 1_500 },
  { heading: /^# What you can do in this conversation\b/, max: 1_200 },
];

/** Words before the first heading. */
const PREAMBLE_MAX = 1_200;

/**
 * The system prompt, lean: only the sections every turn needs, each within a
 * size, and a word on how to load tools. Everything else is left to the tools'
 * own descriptions, which arrive when they're loaded.
 */
export function leanSystem(system: string, options: { tools: boolean }): string {
  const blocks: string[] = [];
  let current: string[] = [];
  const fitted = withResilience(system, options.tools ? 'compact' : 'words');
  for (const line of fitted.split('\n')) {
    if (/^#{1,2} /.test(line) && current.length) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  const kept = blocks.flatMap((block, i) => {
    // Words before any heading are the caller's own preamble: kept, within a size.
    const rule =
      i === 0 && !/^#{1,2} /.test(block)
        ? { max: PREAMBLE_MAX }
        : KEEP.find((k) => k.heading.test(block));
    if (!rule) return [];
    const text = block.trim();
    if (!text) return [];
    if (text.length <= rule.max) return [text];
    const cut = text.lastIndexOf('\n', rule.max);
    return [`${text.slice(0, cut > rule.max / 2 ? cut : rule.max)}\n…`];
  });
  if (options.tools)
    kept.push(
      [
        '# Your tools',
        `To leave room for the conversation, your tools load when you need them. Call ${FIND_TOOLS} with a few words about what you want to do (for example “open a web page”, “remember something”, “read my calendar”), then call the tool it gives you. Tools you’ve loaded stay loaded. Never say you did something unless a tool result shows it.`,
      ].join('\n'),
    );
  return kept.join('\n\n');
}

/** The one tool a lean turn always has. */
export function findToolsSpec(name = FIND_TOOLS): ToolSpec {
  return {
    name,
    description:
      'Load the tools you need. Say what you want to do in a few words (e.g. "browse the web", "save a memory", "search my email", "run a command"). The best matching tools are loaded and described, and you can call them straight away.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to do, in a few words.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  };
}

const STOP = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'and',
  'or',
  'for',
  'in',
  'on',
  'my',
  'me',
  'i',
  'with',
  'some',
  'something',
  'do',
  'use',
  'tool',
  'tools',
  'mcp',
  'conch',
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Stems good enough for a tool list: "browsing" finds "browser", "emails" finds "email". */
function stem(word: string): string {
  return word
    .replace(/(ing|ers|er|es|s|ed)$/, '')
    .replace(/e$/, '')
    .slice(0, 6);
}

/** What else people call things a tool does. */
const ALSO: Record<string, string> = {
  web: 'browser page site open website internet search',
  page: 'browser web site',
  website: 'browser web page',
  internet: 'browser web',
  mail: 'email gmail message inbox',
  email: 'mail gmail message inbox',
  remember: 'memory save note recall',
  memory: 'remember recall forget',
  calendar: 'event meeting schedule',
  file: 'read write folder document',
  command: 'shell terminal run bash',
  shell: 'command terminal run',
  schedule: 'routine every remind',
  remind: 'routine schedule',
};

/** The tools that best match what the model asked for, best first. */
export function searchTools(
  query: string,
  tools: readonly { name: string; display: string; description: string }[],
  limit = FIND_LIMIT,
  /** 3 is a word of the tool's own name: for guessing from what the person said. */
  least = 1,
): string[] {
  const asked = words(query);
  // An address ("bbc.co.uk", "https://…") is the web, whatever words come with it.
  const web = /https?:\/\/|\b[\w-]+\.(?:com|org|net|io|co|uk|de|fr|app|dev|gov|edu)\b/i.test(query)
    ? ['web', 'browser']
    : [];
  const expanded = new Set(
    [...asked, ...web].flatMap((w) => [w, ...(ALSO[w]?.split(' ') ?? [])]).map(stem),
  );
  if (!expanded.size) return [];
  const scored = tools.map((tool, order) => {
    const name = new Set(words(`${tool.name} ${tool.display}`).map(stem));
    const about = new Set(words(tool.description).map(stem));
    let score = 0;
    for (const w of expanded) {
      if (name.has(w)) score += 3;
      else if (about.has(w)) score += 1;
    }
    // A tool asked for by its exact name wins outright ("Read" alone, or "browser_open"
    // anywhere): a common word that happens to be a name ("read the page") doesn't.
    const lower = tool.name.toLowerCase();
    if (
      query.trim().toLowerCase() === lower ||
      (lower.includes('_') && query.toLowerCase().includes(lower))
    )
      score += 100;
    return { name: tool.name, score, order };
  });
  return scored
    .filter((s) => s.score >= least)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.name);
}

/** How many tools a lean turn loads by itself from what the person said. */
export const GUESS_LIMIT = 3;

/** What `find_tools` answers: each tool loaded, with what it does and what it takes. */
export function foundText(found: readonly ToolSpec[], query: string): string {
  if (!found.length)
    return `No tool matches “${query.slice(0, 100)}”. Try other words (what you want to do, not how), or answer without a tool.`;
  return [
    `Loaded ${found.length} tool${found.length === 1 ? '' : 's'}; call ${found.length === 1 ? 'it' : 'any of them'} now:`,
    ...found.map(
      (tool) =>
        `- ${tool.name}: ${tool.description.slice(0, 400)}\n  Arguments: ${JSON.stringify(tool.schema).slice(0, 1_200)}`,
    ),
  ].join('\n');
}

/** The loaded tools after loading these: newest last, at most `LOADED_MAX`. */
export function remember(loaded: readonly string[], found: readonly string[]): string[] {
  const next = [...loaded.filter((name) => !found.includes(name)), ...found];
  return next.slice(-LOADED_MAX);
}

/** How many tokens a tool list costs, for deciding whether to go lean. */
export function toolTokens(specs: readonly ToolSpec[]): number {
  return estimateTokens(specs);
}
