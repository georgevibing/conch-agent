import { basename } from 'node:path';

import { commandParts, wordsOf } from './risk';

/** One-line, human description of what a tool wants to do, for permission prompts. */
export function summarizeToolUse(toolName: string, input: Record<string, unknown>): string {
  const str = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string) : undefined;
  const file = str('file_path') ?? str('path') ?? str('notebook_path');
  const conch = toolName.replace(/^mcp__conch__/, '');
  /** "AAPL and MSFT": the tickers a finance tool was asked about, however they came. */
  const symbols = (fields: Record<string, unknown>, key: string): string => {
    const given = fields[key];
    const list = (typeof given === 'string' ? [given] : Array.isArray(given) ? given : [])
      .flatMap((s) => (typeof s === 'string' && s.trim() ? [s.trim().slice(0, 24)] : []))
      .slice(0, 4);
    if (!list.length) return '';
    return list.length === 1
      ? (list[0] ?? '')
      : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  };
  const labels: Record<string, string> = {
    read_file: `Read ${file ?? 'a text file'}`,
    read_document: `Read ${file ?? 'a document'}`,
    search_files: `Find files${str('text') ? ` containing “${str('text')}”` : str('name') ? ` named “${str('name')}”` : ''}`,
    web_search: `Search the web for “${str('query') ?? ''}”`,
    web_fetch: `Read ${str('url') ?? 'a web page'}`,
    video_search: `Find videos of “${str('query') ?? ''}”`,
    video_details: 'Look up videos',
    knowledge_card: `Look up “${str('query') ?? ''}” on Wikipedia`,
    link_preview: `Preview ${Array.isArray(input.urls) && input.urls.length === 1 ? String(input.urls[0]) : 'links'}`,
    book_search: `Search Open Library for “${str('query') ?? ''}”`,
    quote: `Look up prices${symbols(input, 'symbols') ? ` for ${symbols(input, 'symbols')}` : ''}`,
    price_history: `Look up ${str('symbol') ?? 'a'} price history`,
    crypto_market: 'Look up how crypto is doing',
    fundamentals: `Look up filings${symbols(input, 'companies') ? ` for ${symbols(input, 'companies')}` : ''}`,
    show_search: `Search ${input.kind === 'movie' ? 'films' : 'TV shows'} for “${str('query') ?? ''}”`,
    process_start: `Start “${(str('command') ?? '').slice(0, 160)}”`,
    process_read: 'Read command progress',
    process_write: 'Send input to a command',
    process_stop: 'Stop a command',
    task_status: 'Read task progress',
    task_control: `${str('action') ?? 'Update'} a task`,
    publish_file: `Offer ${str('name') ?? file ?? 'a finished file'} to download`,
    image_models: 'Find image models',
    file_make: `Make ${str('name') ?? 'a file'}${str('format') ? ` (${String(str('format')).toUpperCase()})` : ''}`,
    file_convert: `Convert ${str('source')?.startsWith('att_') ? 'a file' : (str('source') ?? 'a file')} to ${String(str('to') ?? 'another format').toUpperCase()}`,
    file_combine: `Combine files into ${str('name') ?? `one ${String(str('to') ?? 'file').toUpperCase()}`}`,
    file_unzip: `Unpack ${str('source')?.startsWith('att_') ? 'an archive' : (str('source') ?? 'an archive')}`,
    image_generate: str('source') ? 'Edit a picture' : 'Create a picture',
    run_script: `Run a script: ${(str('title') ?? 'calls your tools').slice(0, 120)}`,
  };
  if (labels[conch]) return labels[conch];
  switch (toolName) {
    case 'Bash':
      return `Run \`${(str('command') ?? '').slice(0, 200)}\``;
    case 'Write':
      return `Create ${file ?? 'a file'}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Edit ${file ?? 'a file'}`;
    case 'Read':
      return `Read ${file ?? 'a file'}`;
    case 'WebFetch':
      return `Open ${str('url') ?? 'a web page'}`;
    case 'WebSearch':
      return `Search the web for “${str('query') ?? ''}”`;
    // Plan mode's question (ADR 0060): the card shows the plan, with Start and Keep planning.
    case 'ExitPlanMode':
      return 'Start on the plan';
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
      if (mcp) return `Use ${mcp[2]} from ${mcp[1]}`;
      return `Use ${toolName}`;
    }
  }
}

/** Steps of a command line that only set the scene: where it runs, what it says. */
const SCENERY = new Set([
  'cd',
  'pushd',
  'popd',
  'export',
  'set',
  'unset',
  'source',
  '.',
  'true',
  'false',
  ':',
  'exit',
  'echo',
  'printf',
  'sleep',
  'wait',
  'test',
  '[',
  'Set-Location',
]);

/** Programs said as people say them. */
const SPOKEN: Record<string, string> = {
  python: 'Python',
  python3: 'Python',
  node: 'Node',
  deno: 'Deno',
  ruby: 'Ruby',
  perl: 'Perl',
  php: 'PHP',
  docker: 'Docker',
  bash: 'a script',
  sh: 'a script',
  zsh: 'a script',
};

const RUNNERS = /^(?:npm|pnpm|yarn|bun|npx|pnpx|bunx)$/;
const TESTS = /^(?:npm|pnpm|yarn|bun|cargo|go|deno|dotnet|mvn|gradle|make)$/;
const INSTALLS = /^(?:npm|pnpm|yarn|bun|pip3?|uv|cargo|brew|gem|go)$/;
const BUILDS = /^(?:npm|pnpm|yarn|bun|cargo|go|docker|make|dotnet)$/;

/** What one step does, in a few words: "Run the tests", "Run git". */
function stepWords(words: string[]): string | undefined {
  const name = basename(words[0] ?? '');
  if (!name || SCENERY.has(name) || !/^[A-Za-z0-9][\w.+-]{0,23}$/.test(name)) return undefined;
  const verb = (words.slice(1).find((w) => !w.startsWith('-')) ?? '').toLowerCase();
  const sub = RUNNERS.test(name) && verb === 'run' ? (words[2] ?? '').toLowerCase() : verb;
  if (/^(?:vitest|jest|pytest|mocha)$/.test(name) || (sub === 'test' && TESTS.test(name)))
    return 'Run the tests';
  if (/^(?:install|i|ci|add)$/.test(sub) && INSTALLS.test(name)) return 'Install packages';
  if (sub === 'build' && BUILDS.test(name)) return 'Build the project';
  return `Run ${SPOKEN[name] ?? name}`;
}

/** A heredoc's lines are what a program reads, not steps of their own. */
function withoutHeredocs(command: string): string {
  const kept: string[] = [];
  let until: string | undefined;
  for (const line of command.split('\n')) {
    if (until !== undefined) {
      if (line.trim() === until) until = undefined;
      continue;
    }
    kept.push(line);
    until = /<<-?\s*(['"]?)([\w.-]+)\1/.exec(line)?.[2];
  }
  return kept.join('\n');
}

const listed = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const WHERE_TO = new Set(['cd', 'pushd', 'Set-Location']);

/**
 * What a command does, in a few plain words, never the command itself (ADR 0028,
 * ADR 0108): "Run git and Python in conch-agent", "Install packages and run the
 * tests". The card's heading; the exact command is shown under it. `folder` is
 * where it runs when the command doesn't say (the chat's work folder).
 */
export function commandTitle(command: string, folder?: string): string {
  const parts = commandParts(withoutHeredocs(command)).map(wordsOf);
  const into = parts.find((words) => WHERE_TO.has(words[0] ?? ''))?.[1];
  const place = basename(into && !/^[~.-]+$/.test(into) ? into : (folder ?? ''));
  const steps = [...new Set(parts.map(stepWords).filter((s): s is string => Boolean(s)))];
  const runs = steps.filter((s) => s.startsWith('Run ') && s !== 'Run the tests');
  const said =
    steps.length === 0
      ? 'Run a command'
      : steps.length > 3
        ? `Run ${steps.length} commands`
        : runs.length === steps.length
          ? `Run ${listed(runs.map((s) => s.slice(4)))}`
          : listed(steps.map((s, i) => (i ? s.charAt(0).toLowerCase() + s.slice(1) : s)));
  const where = place && place.length <= 40 && !/[\s`$]/.test(place) ? ` in ${place}` : '';
  return `${said}${where}`;
}

/** The card's short title for a step whose summary would carry its code: a command line. */
export function titleOfToolUse(
  toolName: string,
  input: Record<string, unknown>,
  folder?: string,
): string | undefined {
  const bare = toolName.replace(/^mcp__conch__/, '');
  if (!(bare === 'Bash' || bare === 'PowerShell' || bare === 'process_start')) return undefined;
  return typeof input.command === 'string' ? commandTitle(input.command, folder) : undefined;
}

/** A short title from the first message: first line, at a word boundary. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= 48) return line;
  const cut = line.slice(0, 48);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 24 ? cut.lastIndexOf(' ') : 48)}…`;
}
