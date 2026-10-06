import { ComputerStatus } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { ComputerSampler } from './sampler';

/**
 * Settings → This computer. Under `/api`, so the gateway's host, origin and
 * sign-in checks cover it like everything else. Asking is what keeps the
 * sampler looking: the page asks every couple of seconds while it's open,
 * and the sampler stops by itself soon after the last ask. It only reads.
 */
export function registerComputerRoutes(app: FastifyInstance, sampler: ComputerSampler) {
  app.get('/api/computer', async () => ComputerStatus.parse(await sampler.status()));
}
