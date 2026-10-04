/**
 * The agent programs Conch drives over ACP, each described once (ADR 0053).
 *
 * The engine (`engine.ts`) knows the protocol; these say what differs: which
 * program, how it starts as an agent, how a person signs in to it, and what to
 * keep out of its environment. Every one is the vendor's own program run on
 * this computer with the person's own sign-in — Conch never sees or reuses the
 * program's credentials.
 */
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { InstallHint } from '@conch/protocol';

import { findExecutable } from '../../lib/proc';

export type AcpAgentId = 'copilot' | 'gemini-cli' | 'grok';

/** How a person signs in. */
export type AcpLogin =
  /**
   * The program's own sign-in command, run by Conch with no terminal. It prints
   * a page and a code (a device sign-in), which Conch shows; Conch waits for it
   * to finish and then starts the agent afresh.
   */
  | { kind: 'command'; args: string[]; hosts: readonly RegExp[] }
  /**
   * ACP's `authenticate` with this method: the program opens the sign-in page
   * in a browser on the computer it runs on, and finishes by itself.
   */
  | { kind: 'authenticate'; methodId: string };

export interface AcpAgent {
  id: AcpAgentId;
  /** "GitHub Copilot" */
  label: string;
  /** The program's name on `PATH`. */
  program: string;
  /** Its need in `setup/known.ts`, so Conch can install or update it. */
  need: string;
  docsUrl: string;
  /** Where its installers put it, besides `PATH`. */
  extraDirs(): string[];
  install(): InstallHint[];
  /** The oldest version that speaks ACP the way Conch does. */
  minVersion: string;
  /** Arguments that start it as an ACP agent on stdin and stdout. */
  args(options: { model?: string }): string[];
  /**
   * The model is chosen when the program starts, not per session (Copilot's
   * ACP doesn't reliably list or switch models).
   */
  modelAtStart: boolean;
  /** Variables taken out of its environment: a token there would silently win over its own sign-in. */
  dropEnv: readonly string[];
  /** Variables added to it. */
  env: Readonly<Record<string, string>>;
  /**
   * How Conch's instructions reach the model, the way the program takes them
   * (ADR 0053 § Conch's instructions): `rules` in the session's `_meta`, added
   * to its system prompt (Grok); the door's own MCP server instructions, read
   * into the system prompt every session (`server`: Copilot) or into the
   * chat's first message (`first-message`: Gemini CLI). Without a door, or for
   * a carried-on chat that can't take new ones, they lead the message instead.
   */
  instructions: 'rules' | 'server' | 'first-message';
  /** Which of the methods the agent advertises to call `authenticate` with before a session, if any. */
  authenticate?(methods: readonly string[]): string | undefined;
  login: AcpLogin;
  /** What to say while it isn't signed in. */
  signedOut: string;
  /** Whose plan answers, on the card once it's connected. */
  account: string;
  /** Said about the sign-in button. */
  signInHelp: string;
}

function npmInstall(pkg: string): InstallHint {
  return { label: 'npm', command: `npm install -g ${pkg}` };
}

export const ACP_AGENTS: Readonly<Record<AcpAgentId, AcpAgent>> = {
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    program: 'copilot',
    need: 'copilot',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli',
    extraDirs: () => [join(homedir(), '.local', 'bin')],
    install: () => [
      ...(platform() === 'win32'
        ? [{ label: 'winget', command: 'winget install --exact --id GitHub.Copilot' }]
        : [{ label: 'Homebrew', command: 'brew install --cask copilot-cli' }]),
      npmInstall('@github/copilot'),
    ],
    // ACP sessions with MCP servers from the client (1.0.25), sign-in checked before ACP authenticate (1.0.69).
    minVersion: '1.0.69',
    args: ({ model }) => [
      '--acp',
      '--stdio',
      '--no-auto-update',
      // Conch's instructions come as its tool server's own (1.0.66): without this,
      // Copilot keeps only a few known servers' instructions.
      '--allow-all-mcp-server-instructions',
      ...(model && model !== 'default' ? [`--model=${model}`] : []),
    ],
    modelAtStart: true,
    instructions: 'server',
    // `GH_TOKEN` and `GITHUB_TOKEN` are often a classic token for `gh`, which Copilot refuses outright.
    dropEnv: ['GH_TOKEN', 'GITHUB_TOKEN'],
    env: { COPILOT_AUTO_UPDATE: 'false' },
    login: {
      kind: 'command',
      args: ['login', '--device-code'],
      hosts: [/^github\.com$/, /\.ghe\.com$/],
    },
    signedOut: 'Sign in with GitHub to use your Copilot plan. No key is needed.',
    account: 'Your GitHub Copilot plan',
    signInHelp:
      'GitHub shows a short code to confirm it’s you. Every Copilot plan works, including Copilot Free; your plan’s models and limits apply.',
  },
  'gemini-cli': {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    program: 'gemini',
    need: 'gemini-cli',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    extraDirs: () => [],
    install: () => [npmInstall('@google/gemini-cli')],
    // `--acp` (the older flag still works but is going away).
    minVersion: '0.50.0',
    args: () => ['--acp'],
    modelAtStart: false,
    instructions: 'first-message',
    dropEnv: [],
    env: {},
    // A saved sign-in is used as it is; the method is only chosen when someone signs in.
    authenticate: () => undefined,
    login: { kind: 'authenticate', methodId: 'oauth-personal' },
    signedOut: 'Sign in with your Google account. The free tier needs no key and no card.',
    account: 'Your Google account',
    signInHelp:
      'Google’s sign-in page opens in a browser on the computer Conch runs on. Finish there and this updates by itself.',
  },
  grok: {
    id: 'grok',
    label: 'Grok',
    program: 'grok',
    need: 'grok',
    docsUrl: 'https://docs.x.ai/build/overview',
    extraDirs: () => [join(homedir(), '.grok', 'bin'), join(homedir(), '.local', 'bin')],
    install: () => [npmInstall('@xai-official/grok')],
    minVersion: '1.0.0',
    args: () => ['agent', 'stdio'],
    modelAtStart: false,
    instructions: 'rules',
    dropEnv: [],
    env: {},
    // The sign-in `grok login` saved; an `XAI_API_KEY` in the environment otherwise.
    authenticate: (methods) =>
      methods.includes('cached_token')
        ? 'cached_token'
        : methods.includes('xai.api_key') && process.env.XAI_API_KEY
          ? 'xai.api_key'
          : undefined,
    login: {
      kind: 'command',
      args: ['login', '--device-auth'],
      hosts: [/(^|\.)x\.ai$/, /(^|\.)grok\.com$/],
    },
    signedOut: 'Sign in with your X or Grok account to use your SuperGrok or X Premium+ plan.',
    account: 'Your xAI account',
    signInHelp:
      'xAI shows a short code to confirm it’s you. Your plan’s shared weekly usage applies.',
  },
};

/** Find an agent's program where it really lives. */
export function findAgent(agent: AcpAgent, explicit?: string): Promise<string | undefined> {
  return findExecutable(agent.program, { explicit, extraDirs: agent.extraDirs() });
}

/**
 * Whether the person has signed in to the program before — by a file that's
 * there, never by what's in it. Only a hint: the agent itself has the last word.
 */
export function signedInBefore(agent: AcpAgent): boolean | undefined {
  const home = homedir();
  if (agent.id === 'gemini-cli') return existsSync(join(home, '.gemini', 'oauth_creds.json'));
  if (agent.id === 'grok') return existsSync(join(home, '.grok', 'auth.json'));
  return undefined;
}
