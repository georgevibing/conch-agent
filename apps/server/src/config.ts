import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { AppUpdates, EngineId } from '@conch/protocol';
import { z } from 'zod';

/** What each variable is for is in `ENV_ABOUT` below, where the documentation reads it too. */
export const Env = z.object({
  CONCH_HOST: z.string().default('127.0.0.1'),
  CONCH_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  CONCH_DOOR_PORT: z.coerce.number().int().min(1).max(65535).default(4319),
  CONCH_ALLOW_REMOTE: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  CONCH_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
  CONCH_TOKEN: z.string().min(16, 'CONCH_TOKEN must be at least 16 characters.').optional(),
  CONCH_HOME: z.string().default(join(homedir(), '.conch')),
  CONCH_ENGINE: EngineId.optional(),
  CONCH_CLAUDE_PATH: z.string().optional(),
  CONCH_CODEX_PATH: z.string().optional(),
  CONCH_SKILL_SOURCES: z.enum(['auto', 'off']).optional(),
  CONCH_CHECKOUT: z.string().optional(),
  CONCH_UPDATE_CHECKS: z.enum(['auto', 'off']).optional(),
  CONCH_VAULT_KEYSTORE: z.enum(['auto', 'file']).optional(),
  CONCH_IMPORT_HOME: z.string().optional(),
  CONCH_WEB_DIST: z.string().optional(),
  CONCH_OPEN: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  CONCH_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CONCH_APP: z.string().optional(),
  CONCH_APP_UPDATES: AppUpdates.optional(),
});

export type Config = z.infer<typeof Env>;

export interface EnvAbout {
  /** What it does, for the person setting it. */
  about: string;
  /** What happens when it's unset, where the schema has no default to show. */
  unset?: string;
  /** Only for development and tests: nobody running Conch needs it. */
  internal?: boolean;
}

/**
 * Every variable, in words. Typed by `Config`, so a new variable without its
 * words doesn't compile; the documentation's configuration page is generated
 * from this and the schema above (`apps/docs/reference`).
 */
export const ENV_ABOUT: Record<keyof Config, EnvAbout> = {
  CONCH_HOST: {
    about:
      'The address Conch listens on. Anything but this computer also needs CONCH_ALLOW_REMOTE=1, and other devices must sign in.',
  },
  CONCH_PORT: {
    about:
      'Pins the port. A pinned port that’s taken is reported, never swapped for the next free one.',
    unset: '4317, or the next free port when another program has it',
  },
  CONCH_DOOR_PORT: {
    about:
      'The port of the public door, the separate listener on this computer that Teams and WeChat deliver messages to (ADR 0045). It serves only those channels’ signed deliveries; the next free one of the ten after it is used when it’s taken.',
    unset: '4319',
  },
  CONCH_ALLOW_REMOTE: {
    about:
      'Lets Conch listen beyond this computer. Other devices are refused until sign-in is set up.',
  },
  CONCH_ALLOWED_HOSTS: {
    about:
      'Extra hostnames Conch answers to, comma separated: a reverse proxy’s name, say. Your Tailscale name is found by itself.',
  },
  CONCH_TOKEN: {
    about:
      'Legacy: one shared access key, at least 16 characters. Prefer access keys from Settings → Security, which are hashed and can be revoked.',
    unset: 'no shared key',
  },
  CONCH_HOME: {
    about:
      'Where Conch keeps everything it writes. Use the same value for Conch and for pnpm conch.',
    unset: '~/.conch',
  },
  CONCH_ENGINE: {
    about:
      'Pins one provider and makes it the only one, whatever Settings says: mock for UI work and tests.',
    unset: 'every connected provider',
  },
  CONCH_CLAUDE_PATH: {
    about: 'The Claude Code program to run, when Conch shouldn’t find it by itself.',
    unset: 'found by itself',
  },
  CONCH_CODEX_PATH: {
    about: 'The Codex program to run, when Conch shouldn’t find it by itself.',
    unset: 'found by itself',
  },
  CONCH_SKILL_SOURCES: {
    about:
      'auto also lists skills from other agents’ folders (~/.agents/skills, ~/.claude/skills, OpenClaw, Hermes); off lists only Conch’s own.',
    unset: 'auto (off with the mock engine)',
  },
  CONCH_CHECKOUT: {
    about: 'Conch’s own git checkout, which updates move forward.',
    unset: 'the folder Conch runs from',
    internal: true,
  },
  CONCH_UPDATE_CHECKS: {
    about: 'auto looks for updates once a day; off only when you press Check now.',
    unset: 'auto (off with the mock engine)',
  },
  CONCH_VAULT_KEYSTORE: {
    about:
      'Where the key that opens Passwords is kept: auto uses this computer’s keychain (macOS Keychain, Windows DPAPI, the Linux Secret Service) when it has one; file a private file beside the vault.',
    unset: 'auto (file with the mock engine)',
  },
  CONCH_IMPORT_HOME: {
    about: 'Whose home folder Come home looks in for OpenClaw and Hermes.',
    unset: 'your own',
    internal: true,
  },
  CONCH_WEB_DIST: {
    about: 'The built web app to serve.',
    unset: 'apps/web/dist',
  },
  CONCH_OPEN: {
    about: 'Opens Conch in your browser once it has started. pnpm start sets it.',
  },
  CONCH_LOG_LEVEL: {
    about: 'How much Conch logs. Logs never hold query strings, headers or bodies.',
  },
  CONCH_APP: {
    about:
      'The desktop app that started this gateway (ADR 0054): what Always on starts at login. The app sets it.',
    unset: 'not started by the desktop app',
    internal: true,
  },
  CONCH_APP_UPDATES: {
    about:
      'install when the desktop app can replace itself with a new version; download when the person installs it (an unsigned Mac app, a .deb). The app sets it.',
    unset: 'download',
    internal: true,
  },
};

/**
 * `CONCH_PORT` was chosen on purpose. Then a port another program holds is
 * reported, never swapped for the next free one (`port.ts`).
 */
export function portIsExplicit(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CONCH_PORT?.trim());
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Parse and validate configuration from the environment. Throws on unsafe input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = Env.parse(env);
  config.CONCH_HOME = resolve(config.CONCH_HOME);
  // Other devices are always refused until sign-in is set up (see security.ts),
  // so listening on the network is safe — but still an explicit opt-in.
  if (!LOOPBACK.has(config.CONCH_HOST) && !config.CONCH_ALLOW_REMOTE) {
    throw new Error(
      `Refusing to listen on ${config.CONCH_HOST}: Conch can run commands as you. ` +
        'Run `pnpm start:network` (or set CONCH_ALLOW_REMOTE=1) to opt in — or, better, use Tailscale: see docs/SECURITY.md.',
    );
  }
  return config;
}
