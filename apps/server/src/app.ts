import { PROTOCOL_VERSION } from '@conch/protocol';
import Fastify from 'fastify';

import type { Config } from './config';

export const SERVER_VERSION = '0.1.0';

/** Build the HTTP app. Kept separate from `main.ts` so tests can use `inject()`. */
export function buildApp(config: Pick<Config, 'CONCH_LOG_LEVEL'>) {
  const app = Fastify({ logger: { level: config.CONCH_LOG_LEVEL } });

  app.get('/api/health', () => ({
    ok: true,
    serverVersion: SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  }));

  return app;
}
