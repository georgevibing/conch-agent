import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

import type { AuthMethod, EngineStatus, InstallHint } from '@conch/protocol';

import { childEnv } from './env';

const exec = promisify(execFile);

export const DOCS_URL = 'https://code.claude.com/docs/en/setup';

export function installHints(): InstallHint[] {
  const hints: InstallHint[] = [
    { label: 'Install script', command: 'curl -fsSL https://claude.ai/install.sh | bash' },
  ];
  if (platform() === 'darwin') {
    hints.push({ label: 'Homebrew', command: 'brew install --cask claude-code' });
  }
  hints.push({ label: 'npm', command: 'npm install -g @anthropic-ai/claude-code' });
  return hints;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Find `claude` on PATH, then in the places installers put it. */
export async function findClaude(explicit?: string): Promise<string | undefined> {
  if (explicit) return (await isExecutable(explicit)) ? explicit : undefined;
  const names = platform() === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const home = homedir();
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    join(home, '.claude', 'local'),
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** `claude auth status --json`, as documented by Claude Code. Unknown fields are ignored. */
export interface ClaudeAuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  subscriptionType?: string;
  organization?: string;
  orgName?: string;
}

/** Wrappers sometimes print banners before the JSON; take the outermost object. */
export function parseAuthStatus(stdout: string): ClaudeAuthStatus | undefined {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as ClaudeAuthStatus;
  } catch {
    return undefined;
  }
}

const providers: Record<string, { method: AuthMethod; description: string }> = {
  bedrock: { method: 'bedrock', description: 'Amazon Bedrock' },
  vertex: { method: 'vertex', description: 'Google Vertex AI' },
  foundry: { method: 'foundry', description: 'Microsoft Foundry' },
};

export function describeAuth(
  status: ClaudeAuthStatus,
  hasConchKey: boolean,
): NonNullable<EngineStatus['auth']> {
  const provider = status.apiProvider && providers[status.apiProvider];
  if (provider) return { ...provider };
  const method = status.authMethod?.toLowerCase() ?? '';
  const email = status.email;
  if (hasConchKey || method.includes('api_key') || method.includes('apikey')) {
    return { method: 'api-key', description: 'Anthropic API key', email };
  }
  if (method.includes('console')) {
    return { method: 'console', description: 'Anthropic Console', email };
  }
  if (method.includes('claude') || method.includes('oauth') || method.includes('subscription')) {
    const plan = status.subscriptionType
      ? `Claude ${status.subscriptionType[0]?.toUpperCase()}${status.subscriptionType.slice(1)}`
      : 'Claude account';
    return { method: 'subscription', description: email ? `${plan} · ${email}` : plan, email };
  }
  return { method: 'other', description: status.authMethod ?? 'Signed in', email };
}

export async function detectClaude(options: {
  explicitPath?: string;
  apiKey?: string;
}): Promise<EngineStatus> {
  const base = {
    engine: 'claude-code' as const,
    label: 'Claude Code',
    install: installHints(),
    docsUrl: DOCS_URL,
    canSignIn: true,
    checkedAt: Date.now(),
  };

  const executablePath = await findClaude(options.explicitPath);
  if (!executablePath) {
    return {
      ...base,
      state: 'not-installed',
      message: options.explicitPath
        ? `No executable found at ${options.explicitPath}.`
        : "Claude Code isn't installed on this computer yet.",
    };
  }

  const env = childEnv({ ANTHROPIC_API_KEY: options.apiKey });
  let version: string | undefined;
  try {
    const { stdout } = await exec(executablePath, ['--version'], { env, timeout: 15_000 });
    version = /\d+\.\d+\.\d+/.exec(stdout)?.[0];
  } catch (error) {
    return {
      ...base,
      state: 'error',
      executablePath,
      message: `Claude Code is installed but didn't start: ${(error as Error).message.split('\n')[0]}`,
    };
  }

  let auth: ClaudeAuthStatus | undefined;
  try {
    const { stdout } = await exec(executablePath, ['auth', 'status', '--json'], {
      env,
      timeout: 15_000,
    });
    auth = parseAuthStatus(stdout);
  } catch (error) {
    // `auth status` exits non-zero when signed out on some versions; its stdout still has JSON.
    auth = parseAuthStatus((error as { stdout?: string }).stdout ?? '');
  }

  if (!auth) {
    // Older Claude Code without `auth status`: we can't tell, so let the first turn decide.
    return {
      ...base,
      state: 'ready',
      version,
      executablePath,
      auth: { method: 'other', description: 'Sign-in not verified' },
      message: 'Update Claude Code to let Conch check your sign-in.',
    };
  }

  if (!auth.loggedIn && !options.apiKey) {
    return { ...base, state: 'signed-out', version, executablePath };
  }
  return {
    ...base,
    state: 'ready',
    version,
    executablePath,
    auth: describeAuth(auth, Boolean(options.apiKey)),
  };
}
