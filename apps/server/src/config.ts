import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { EngineId } from '@conch/protocol';
import { z } from 'zod';

const Env = z.object({
  CONCH_HOST: z.string().default('127.0.0.1'),
  CONCH_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  CONCH_ALLOW_REMOTE: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  /** Extra hostnames allowed in the Host header (comma separated), e.g. a Tailscale name. */
  CONCH_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
  /**
   * Legacy: a shared access key from the environment. Prefer creating access
   * keys in Settings → Security (they're hashed at rest and revocable).
   */
  CONCH_TOKEN: z.string().min(16, 'CONCH_TOKEN must be at least 16 characters.').optional(),
  CONCH_HOME: z.string().default(join(homedir(), '.conch')),
  /** Force an engine regardless of preferences (e.g. `mock` for UI work and tests). */
  CONCH_ENGINE: EngineId.optional(),
  /** Explicit path to the Claude Code executable. */
  CONCH_CLAUDE_PATH: z.string().optional(),
  CONCH_CODEX_PATH: z.string().optional(),
  /**
   * `auto` lists skills from other agents' folders too (`~/.agents/skills`,
   * `~/.claude/skills`, OpenClaw, Hermes); `off` only Conch's own. Unset: `auto`,
   * except with the mock engine, whose test runs shouldn't see your skills.
   */
  CONCH_SKILL_SOURCES: z.enum(['auto', 'off']).optional(),
  /**
   * Conch's own git checkout, which updates move forward. For development and
   * tests only: Conch finds the folder it runs from by itself.
   */
  CONCH_CHECKOUT: z.string().optional(),
  /**
   * `auto` looks for updates once a day; `off` only when asked ("Check now").
   * Unset: `auto`, except with the mock engine.
   */
  CONCH_UPDATE_CHECKS: z.enum(['auto', 'off']).optional(),
  /**
   * Where the key that opens your passwords is kept: `auto` uses this
   * computer's keychain (macOS Keychain, Windows DPAPI, the Linux Secret
   * Service) when it has one; `file` a 0600 file beside the vault. Unset:
   * `auto`, except with the mock engine, whose test runs mustn't touch your
   * keychain.
   */
  CONCH_VAULT_KEYSTORE: z.enum(['auto', 'file']).optional(),
  /** Built web app to serve at `/`. */
  CONCH_WEB_DIST: z.string().optional(),
  CONCH_OPEN: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  CONCH_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Config = z.infer<typeof Env>;

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
