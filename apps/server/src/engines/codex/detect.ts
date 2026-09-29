/**
 * Is Codex here, does it run, and who is it signed in as?
 *
 * Three cheap questions, asked with the program itself (`--version`,
 * `login status`) and its credentials file. Nothing here starts a turn or
 * spends a token, and every step degrades to a plain sentence the user can act
 * on instead of an error nobody can read.
 */
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { AuthMethod, EngineStatus, InstallHint } from '@conch/protocol';
import { z } from 'zod';

import { agentEnv, findExecutable, run } from '../../lib/proc';

export const DOCS_URL = 'https://developers.openai.com/codex/cli';

/**
 * Codex changed the shape of `codex exec --json` in 0.44.0. Conch reads the new
 * events, so an older install would look silent rather than broken — better to
 * say so and give the one command that fixes it.
 */
export const MIN_VERSION = '0.44.0';
export const UPDATE_COMMAND = 'npm install -g @openai/codex@latest';

const PROBE_TIMEOUT_MS = 15_000;

export function installHints(): InstallHint[] {
  const hints: InstallHint[] = [{ label: 'npm', command: 'npm install -g @openai/codex' }];
  if (platform() === 'darwin') hints.push({ label: 'Homebrew', command: 'brew install codex' });
  return hints;
}

/** Find `codex` on PATH, then in the places its installers put it. */
export function findCodex(explicit?: string): Promise<string | undefined> {
  return findExecutable('codex', { explicit, extraDirs: [join(homedir(), '.codex', 'bin')] });
}

/** Codex's own folder: `CODEX_HOME`, or `~/.codex`. */
export function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
}

/**
 * `codex --version` prints `codex 0.52.0`. A build from source prints a git
 * revision instead, which is a real install with an unknowable version — we
 * take no version rather than guess one.
 */
export function parseVersion(stdout: string): string | undefined {
  return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(stdout)?.[0];
}

/** Dotted-number comparison. Missing or non-numeric parts count as zero. */
export function isAtLeast(version: string, minimum: string): boolean {
  const left = version.split('.');
  const right = minimum.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = Number.parseInt(left[i] ?? '0', 10) || 0;
    const b = Number.parseInt(right[i] ?? '0', 10) || 0;
    if (a !== b) return a > b;
  }
  return true;
}

const AuthFile = z.object({ auth_mode: z.string().optional() });

/**
 * How Codex says it is signed in, from `$CODEX_HOME/auth.json`. The file is
 * absent when credentials live in the OS keyring, and that's not an error —
 * it just means we fall back to the exit code of `codex login status`.
 */
export async function readAuthMode(home = codexHome()): Promise<string | undefined> {
  try {
    const parsed = AuthFile.safeParse(JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')));
    return parsed.success ? parsed.data.auth_mode : undefined;
  } catch {
    return undefined;
  }
}

const AUTH_MODES: Record<string, { method: AuthMethod; description: string }> = {
  chatgpt: { method: 'subscription', description: 'ChatGPT' },
  chatgptauthtokens: { method: 'subscription', description: 'ChatGPT' },
  apikey: { method: 'api-key', description: 'OpenAI API key' },
  bedrockapikey: { method: 'bedrock', description: 'Amazon Bedrock' },
  bedrockaccesskeys: { method: 'bedrock', description: 'Amazon Bedrock' },
};

/**
 * Codex's `auth_mode` in Conch's vocabulary. Anything we don't recognise (an
 * enterprise header, an agent identity, a token we've never seen) is reported
 * as "signed in" without inventing a name for it.
 */
export function codexAuth(
  authMode: string | undefined,
  hasConchKey: boolean,
): NonNullable<EngineStatus['auth']> {
  const known = authMode ? AUTH_MODES[authMode.toLowerCase()] : undefined;
  if (known) return { ...known };
  if (authMode) return { method: 'other', description: 'Signed in' };
  if (hasConchKey) return { method: 'api-key', description: 'OpenAI API key' };
  return { method: 'other', description: 'Signed in' };
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? '';
}

export async function detectCodex(options: {
  explicitPath?: string;
  apiKey?: string;
}): Promise<EngineStatus> {
  const base = {
    engine: 'codex-cli' as const,
    label: 'Codex',
    install: installHints(),
    docsUrl: DOCS_URL,
    canSignIn: true,
    checkedAt: Date.now(),
  };

  const executablePath = await findCodex(options.explicitPath);
  if (!executablePath) {
    return {
      ...base,
      state: 'not-installed',
      message: options.explicitPath
        ? `No executable found at ${options.explicitPath}.`
        : 'Codex isn’t installed on this computer yet.',
    };
  }

  const env = agentEnv({ CODEX_API_KEY: options.apiKey });
  const versionRun = await run(executablePath, ['--version'], { env, timeout: PROBE_TIMEOUT_MS });
  if (versionRun.code !== 0) {
    const detail = firstLine(versionRun.stderr) || `it exited with code ${versionRun.code ?? '?'}`;
    return {
      ...base,
      state: 'error',
      executablePath,
      message: `Codex is installed but didn’t start: ${detail}`,
    };
  }

  const version = parseVersion(versionRun.stdout);
  if (version && !isAtLeast(version, MIN_VERSION)) {
    return {
      ...base,
      state: 'error',
      version,
      executablePath,
      message: `Conch needs Codex ${MIN_VERSION} or newer to read its replies, and this is ${version}. Update it with: ${UPDATE_COMMAND}`,
    };
  }

  // `codex login status` writes prose to stderr and says yes or no with its
  // exit code. The exit code is the part that doesn't change between releases.
  const loginRun = await run(executablePath, ['login', 'status'], {
    env,
    timeout: PROBE_TIMEOUT_MS,
  });
  const signedIn = loginRun.code === 0;
  if (!signedIn && !options.apiKey) {
    return { ...base, state: 'signed-out', version, executablePath };
  }

  return {
    ...base,
    state: 'ready',
    version,
    executablePath,
    auth: codexAuth(await readAuthMode(), Boolean(options.apiKey)),
    message: version
      ? undefined
      : 'This looks like a development build of Codex, so Conch can’t check its version.',
  };
}
