/**
 * The person at the keyboard during an eval (ADR 0071), as code. It denies by
 * default and approves only requests it can classify field by field:
 *
 * - the browser, when the page's parsed origin is the fixture site;
 * - the run's own integration servers (the pretend Ledger) and Conch's own
 *   tools that only touch the run's state (memory, questions, plans);
 * - a file tool, through its one path field, when the real path (or, for a new
 *   file, its nearest existing parent's) is inside the run's throwaway home;
 * - a fetch, through its one `url` field, when the origin is the fixture's.
 *
 * Shell and exec tools are refused outright: the suite has no sealed box with
 * the network off to run them in, and a command can do anything. So is any
 * tool, or any field of a known tool, it can't classify. Every "no" is
 * recorded and fails the task: an agent reaching outside the task is a
 * finding, never something to wave through.
 *
 * It also guards where a run may live: never a real person's Conch.
 */
import { existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export interface ApprovalRequest {
  toolName: string;
  input: unknown;
  /** The browser's own detail, when the browser asks. */
  browser?: { site: string; url: string; kind: string };
}

export interface Approval {
  decision: 'allow' | 'deny';
  why: string;
}

export interface World {
  /** Origins of the fixture site, e.g. `http://127.0.0.1:51234`. */
  origins: readonly string[];
  /** The run's own folder (its CONCH_HOME); file tools may work inside it. */
  home: string;
  /** Where relative paths start (the run's workspace, inside `home`). */
  cwd: string;
  /** Integration servers the run added itself (their tools are `mcp__<server>__…`). */
  servers: readonly string[];
}

/** Conch's own tools that only touch the run's own state. */
const OWN_TOOLS = new Set([
  'remember',
  'recall',
  'forget',
  'ask',
  'update_plan',
  'suggest_replies',
]);

/** Anything that runs a command. Never approved. */
const SHELL =
  /^(?:bash|shell|sh|exec|exec_command|run_command|run_terminal_cmd|local_shell|terminal|powershell|cmd|execute|command|killshell|bashoutput)$/i;

/**
 * File tools by name: the one field that holds the path, whether it may be
 * absent (then it's `cwd`), and every other field they may carry, which holds
 * content or options, never a place.
 */
const FILE_TOOLS: Record<string, { path: string; optional?: true; other: readonly string[] }> = {
  read: { path: 'file_path', other: ['offset', 'limit', 'pages'] },
  write: { path: 'file_path', other: ['content'] },
  edit: { path: 'file_path', other: ['old_string', 'new_string', 'replace_all'] },
  multiedit: { path: 'file_path', other: ['edits'] },
  notebookedit: {
    path: 'notebook_path',
    other: ['new_source', 'cell_id', 'cell_type', 'edit_mode', 'cell_number'],
  },
  ls: { path: 'path', other: ['ignore'] },
  glob: { path: 'path', optional: true, other: ['pattern'] },
  grep: {
    path: 'path',
    optional: true,
    other: [
      'pattern',
      'glob',
      'type',
      'output_mode',
      '-A',
      '-B',
      '-C',
      '-n',
      '-i',
      '-o',
      'context',
      'head_limit',
      'offset',
      'multiline',
    ],
  },
};

/** Fetch tools by name: the `url` field, and the options they may carry. */
const FETCH_TOOLS: Record<string, readonly string[]> = { webfetch: ['prompt'] };

const deny = (why: string): Approval => ({ decision: 'deny', why });
const allow = (why: string): Approval => ({ decision: 'allow', why });

/** `name` without the `mcp__conch__` prefix Conch's own tools carry on some engines. */
const bareName = (name: string) => name.replace(/^mcp__conch__/, '');

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const realOr = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** The fixture origin a URL names exactly, or undefined. No credentials, http(s) only. */
export function fixtureOrigin(raw: unknown, origins: readonly string[]): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  return origins.includes(url.origin) ? url.origin : undefined;
}

/**
 * Where a path really is: the real path of the path itself, or of its nearest
 * existing parent with the rest appended. A `..` anywhere is refused outright,
 * so a symlink can't be stepped back out of.
 */
export function realPathOf(raw: unknown, cwd: string): string | undefined {
  if (typeof raw !== 'string' || !raw || raw.includes('\0')) return undefined;
  if (raw.split(/[\\/]+/).includes('..')) return undefined;
  if (/^~/.test(raw)) return undefined;
  const absolute = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
  let existing = absolute;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return undefined;
    rest.unshift(existing.slice(parent.length).replace(/^[\\/]+/, ''));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

const fieldsOf = (input: unknown): Record<string, unknown> | undefined =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;

/** Approve what is classified and stays inside the world; refuse the rest, saying why. */
export function approve(request: ApprovalRequest, world: World): Approval {
  if (request.browser) {
    return fixtureOrigin(request.browser.url, world.origins)
      ? allow(`the fixture site (${request.browser.kind})`)
      : deny(`the browser asked to act on ${request.browser.url}`);
  }
  const name = request.toolName;
  const mcp = /^mcp__(.+?)__[^_]/.exec(name)?.[1];
  if (mcp && mcp !== 'conch')
    return world.servers.includes(mcp)
      ? allow(`the ${mcp} fixture`)
      : deny(`${name} belongs to an app the run didn’t add`);
  const bare = bareName(name);
  if (OWN_TOOLS.has(bare)) return allow('Conch’s own tool');
  if (SHELL.test(bare)) return deny(`${name} runs a command, which evals never allow`);

  const fields = fieldsOf(request.input);
  if (!fields) return deny(`${name} with input that isn’t a set of fields`);
  const key = bare.toLowerCase();

  const file = FILE_TOOLS[key];
  if (file) {
    const unknown = Object.keys(fields).find((f) => f !== file.path && !file.other.includes(f));
    if (unknown) return deny(`${name} has a field it can’t classify (${unknown})`);
    const raw = fields[file.path];
    if (raw === undefined && file.optional) return allow(`${name} in the run’s workspace`);
    const home = realOr(world.home);
    const path = realPathOf(raw, realOr(world.cwd));
    if (!path) return deny(`${name} names a path that can’t be checked (${String(raw)})`);
    return inside(home, path)
      ? allow(`${name} inside the run’s folder`)
      : deny(`${name} touches ${path}, outside the run’s folder`);
  }

  const fetch = FETCH_TOOLS[key];
  if (fetch) {
    const unknown = Object.keys(fields).find((f) => f !== 'url' && !fetch.includes(f));
    if (unknown) return deny(`${name} has a field it can’t classify (${unknown})`);
    return fixtureOrigin(fields.url, world.origins)
      ? allow(`${name} of the fixture site`)
      : deny(`${name} reaches ${String(fields.url)}`);
  }

  return deny(`${name} isn’t a tool evals know how to check`);
}

/** Why a run may not use this folder as its home, or undefined when it may. */
export function unsafeHome(
  home: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const target = realOr(home);
  const people = [join(homedir(), '.conch'), env.CONCH_HOME].filter((p): p is string => !!p);
  if (people.map(realOr).some((p) => p === target || inside(target, p) || inside(p, target)))
    return `${home} is a real Conch's home; evals only run in a throwaway folder.`;
  const temp = realOr(tmpdir());
  if (!inside(temp, target) || temp === target)
    return `${home} isn't a folder inside the system's temporary folder; evals only run in a throwaway one.`;
  return undefined;
}

/** Bypassing approvals is opt-in, and only ever in a throwaway home. */
export function bypassAllowed(home: string, env: Record<string, string | undefined>): boolean {
  return env.CONCH_EVAL_ALLOW_BYPASS === '1' && unsafeHome(home, env) === undefined;
}
