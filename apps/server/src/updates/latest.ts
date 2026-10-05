/**
 * The newest version of a program, asked of where it came from: the npm
 * registry, winget or Homebrew. Every answer is best effort — a lookup that
 * fails (offline, a slow source, a manager that isn't here) is `undefined`,
 * never an error, and the last answer stands.
 */
import { findExecutable, run as runProgram, type RunResult } from '../lib/proc';
import type { LatestLookup } from '../setup/needs';
import { latestRelease } from '../setup/release';
import { parseVersion } from './version';

export type Runner = (
  file: string,
  args: string[],
  options: { timeout?: number },
) => Promise<RunResult>;

export interface LookupDeps {
  fetch?: typeof fetch;
  run?: Runner;
  /** Finds winget or brew; tests point it at a fake. */
  manager?: (name: 'winget' | 'brew') => Promise<string | undefined>;
  /** Longest one lookup may take. */
  timeoutMs?: number;
}

/** An npm package name as Conch's needs declare them: `@scope/name` or `name`. */
const NPM_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
/** A winget id (`OpenAI.Codex`) or a Homebrew name (`1password-cli`). */
const PACKAGE_ID = /^[A-Za-z0-9][\w.+-]*$/;
/** A PyPI project name (`piper-tts`). */
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** `winget show` prints `Version: 0.160.0` under the `Found … [id]` line. */
export function parseWingetShow(stdout: string): string | undefined {
  const lines = stdout.split(/\r?\n/);
  const found = lines.findIndex((line) => /\[[^\]]+\]\s*$/.test(line));
  const labelled = /^\s*Version:\s*(\S+)\s*$/im.exec(stdout)?.[1];
  if (labelled) return parseVersion(labelled);
  // Another language: the first "Label: 1.2.3" line after `Found … [id]`.
  for (const line of lines.slice(found + 1)) {
    const value = /^\s*[^:]{1,24}:\s*v?(\d+(?:\.\d+)+\S*)\s*$/.exec(line)?.[1];
    if (value) return parseVersion(value);
  }
  return undefined;
}

/** `brew info --json=v2`: a formula's stable version, or a cask's (`2.0.1,abc` → `2.0.1`). */
export function parseBrewInfo(stdout: string, cask: boolean): string | undefined {
  try {
    const info = JSON.parse(stdout) as {
      formulae?: { versions?: { stable?: string } }[];
      casks?: { version?: string }[];
    };
    const raw = cask ? info.casks?.[0]?.version : info.formulae?.[0]?.versions?.stable;
    return raw ? parseVersion(raw.split(',')[0] ?? raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Where Conch asks for the newest versions. */
export function lookup(deps: LookupDeps = {}): LatestLookup {
  const timeout = deps.timeoutMs ?? 30_000;
  const run = deps.run ?? ((file, args, options) => runProgram(file, args, options));
  const manager = deps.manager ?? ((name) => findExecutable(name));
  return {
    async npm(pkg) {
      if (!NPM_NAME.test(pkg)) return undefined;
      try {
        const response = await (deps.fetch ?? fetch)(
          `https://registry.npmjs.org/${pkg.replaceAll('/', '%2F')}/latest`,
          { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) },
        );
        if (!response.ok) return undefined;
        const body = (await response.json()) as { version?: unknown };
        return typeof body.version === 'string' ? parseVersion(body.version) : undefined;
      } catch {
        return undefined;
      }
    },
    async winget(id) {
      const winget = PACKAGE_ID.test(id) ? await manager('winget') : undefined;
      if (!winget) return undefined;
      const result = await run(
        winget,
        [
          'show',
          '--id',
          id,
          '--exact',
          '--source',
          'winget',
          '--accept-source-agreements',
          '--disable-interactivity',
        ],
        { timeout },
      );
      return result.code === 0 ? parseWingetShow(result.stdout) : undefined;
    },
    async pypi(pkg) {
      if (!PYPI_NAME.test(pkg)) return undefined;
      try {
        const response = await (deps.fetch ?? fetch)(`https://pypi.org/pypi/${pkg}/json`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok) return undefined;
        const body = (await response.json()) as { info?: { version?: unknown } };
        return typeof body.info?.version === 'string' ? parseVersion(body.info.version) : undefined;
      } catch {
        return undefined;
      }
    },
    async github(repo, asset) {
      try {
        const release = await latestRelease(repo, asset, {
          ...(deps.fetch && { fetch: deps.fetch }),
          signal: AbortSignal.timeout(timeout),
        });
        return release?.version;
      } catch {
        return undefined;
      }
    },
    async brew(name, cask = false) {
      const brew = PACKAGE_ID.test(name) ? await manager('brew') : undefined;
      if (!brew) return undefined;
      const result = await run(
        brew,
        ['info', '--json=v2', ...(cask ? ['--cask'] : ['--formula']), name],
        { timeout },
      );
      return result.code === 0 ? parseBrewInfo(result.stdout, cask) : undefined;
    },
  };
}
