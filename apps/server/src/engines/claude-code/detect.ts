import { execFile } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { AuthMethod, EngineStatus, InstallHint } from '@conch/protocol';

import { findExecutable, launch } from '../../lib/proc';
import { bundledClaude } from './bundled';
import { childEnv } from './env';

const exec = promisify(execFile);

export const DOCS_URL = 'https://code.claude.com/docs/en/setup';

export function installHints(): InstallHint[] {
  const hints: InstallHint[] = [
    platform() === 'win32'
      ? { label: 'Install script', command: 'irm https://claude.ai/install.ps1 | iex' }
      : { label: 'Install script', command: 'curl -fsSL https://claude.ai/install.sh | bash' },
  ];
  if (platform() === 'darwin') {
    hints.push({ label: 'Homebrew', command: 'brew install --cask claude-code' });
  }
  hints.push({ label: 'npm', command: 'npm install -g @anthropic-ai/claude-code' });
  return hints;
}

/** Find an installed `claude`: on PATH (fresh on Windows), then where its installers put it. */
export function findClaude(explicit?: string): Promise<string | undefined> {
  return findExecutable('claude', { explicit, extraDirs: [join(homedir(), '.claude', 'local')] });
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

type Probe = { ok: true; version?: string; auth?: ClaudeAuthStatus } | { ok: false; error: string };

/** Ask one copy of Claude Code its version and who it's signed in as. Spends nothing. */
async function probeClaude(executablePath: string, apiKey?: string): Promise<Probe> {
  const env = childEnv({ ANTHROPIC_API_KEY: apiKey });
  let version: string | undefined;
  try {
    const { command, prefix } = launch(executablePath);
    const { stdout } = await exec(command, [...prefix, '--version'], { env, timeout: 15_000 });
    version = /\d+\.\d+\.\d+/.exec(stdout)?.[0];
  } catch (error) {
    return { ok: false, error: (error as Error).message.split('\n')[0] ?? 'it didn’t start' };
  }
  let auth: ClaudeAuthStatus | undefined;
  try {
    const { command, prefix } = launch(executablePath);
    const { stdout } = await exec(command, [...prefix, 'auth', 'status', '--json'], {
      env,
      timeout: 15_000,
    });
    auth = parseAuthStatus(stdout);
  } catch (error) {
    // `auth status` exits non-zero when signed out on some versions; its stdout still has JSON.
    auth = parseAuthStatus((error as { stdout?: string }).stdout ?? '');
  }
  return { ok: true, version, auth };
}

export async function detectClaude(options: {
  explicitPath?: string;
  apiKey?: string;
  /** Leave a “fixed on its own” note (Conch fell back to its own copy). */
  onHeal?: (message: string) => void;
  /** Where the copy that comes with Conch is; overridable for tests. */
  bundled?: () => string | undefined;
  /** How to find an installed copy; overridable for tests (the real one looks everywhere). */
  find?: () => Promise<string | undefined>;
}): Promise<EngineStatus> {
  const base = {
    engine: 'claude-code' as const,
    label: 'Claude Code',
    install: installHints(),
    docsUrl: DOCS_URL,
    canSignIn: true,
    checkedAt: Date.now(),
  };

  const installed = options.find ? await options.find() : await findClaude(options.explicitPath);
  // A path you set yourself is what you get: no quiet substitutes.
  const bundled = options.explicitPath ? undefined : (options.bundled ?? bundledClaude)();
  if (!installed && !bundled) {
    return {
      ...base,
      state: 'not-installed',
      message: options.explicitPath
        ? `No executable found at ${options.explicitPath}.`
        : "Claude Code isn't installed on this computer yet.",
      ...(!options.explicitPath && { fix: { need: 'claude-code', kind: 'install' as const } }),
    };
  }

  let executablePath = installed ?? bundled ?? '';
  let probe = await probeClaude(executablePath, options.apiKey);
  let usingBundled = !installed;
  // The copy on this computer won't start, or is too old to say who's signed in:
  // the one that comes with Conch is current, so use it and say so quietly.
  if (installed && bundled && (!probe.ok || !probe.auth)) {
    const fallback = await probeClaude(bundled, options.apiKey);
    if (fallback.ok && fallback.auth) {
      options.onHeal?.(
        probe.ok
          ? 'The Claude Code on this computer is too old for Conch, so it’s using the one that comes with Conch.'
          : 'The Claude Code on this computer wouldn’t start, so Conch is using the one that comes with it.',
      );
      executablePath = bundled;
      probe = fallback;
      usingBundled = true;
    }
  }
  const origin = { executablePath, bundled: usingBundled };

  if (!probe.ok) {
    return {
      ...base,
      ...origin,
      state: 'error',
      message: `Claude Code is installed but didn't start: ${probe.error}`,
      fix: { need: 'claude-code', kind: 'update' },
    };
  }
  const { version, auth } = probe;

  if (!auth) {
    // Older Claude Code without `auth status`: we can't tell, so let the first turn decide.
    return {
      ...base,
      ...origin,
      state: 'ready',
      version,
      auth: { method: 'other', description: 'Sign-in not verified' },
      message: 'Update Claude Code to let Conch check your sign-in.',
      fix: { need: 'claude-code', kind: 'update' },
    };
  }

  if (!auth.loggedIn && !options.apiKey) {
    return { ...base, ...origin, state: 'signed-out', version };
  }
  return {
    ...base,
    ...origin,
    state: 'ready',
    version,
    auth: describeAuth(auth, Boolean(options.apiKey)),
  };
}
