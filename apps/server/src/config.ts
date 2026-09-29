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
