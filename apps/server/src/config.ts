import { z } from 'zod';

const Env = z.object({
  CONCH_HOST: z.string().default('127.0.0.1'),
  CONCH_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  CONCH_ALLOW_REMOTE: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  CONCH_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof Env>;

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Parse and validate configuration from the environment. Throws on invalid input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = Env.parse(env);
  if (!LOOPBACK.has(config.CONCH_HOST) && !config.CONCH_ALLOW_REMOTE) {
    throw new Error(
      `Refusing to bind to ${config.CONCH_HOST}: the gateway can run commands as you. ` +
        'Set CONCH_ALLOW_REMOTE=1 to opt in (prefer an SSH tunnel or Tailscale).',
    );
  }
  return config;
}
