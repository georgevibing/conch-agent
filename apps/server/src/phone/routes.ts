import type { FastifyInstance } from 'fastify';

import type { Tailscale } from '../network/tailscale';
import type { Gatekeeper } from '../security';

/**
 * Conch in your pocket (ADR 0027). Looking at the secure address needs only
 * the page's own sign-in; turning it on makes Conch reachable from every
 * device on your tailnet (each still has to sign in), so it needs a recent
 * password or key (sudo mode), like any change that grants reach.
 */
export function registerPhoneRoutes(
  app: FastifyInstance,
  deps: { tailscale: Tailscale; gate: Gatekeeper },
): void {
  const { tailscale, gate } = deps;
  app.get('/api/phone/address', () => tailscale.status());
  app.post('/api/phone/address', (request, reply) => {
    if (!gate.verified(request.access))
      return reply.code(403).send({
        error: 'verify-required',
        message: 'Confirm it’s you to give Conch a secure address for your phone.',
      });
    return tailscale.serve();
  });
}
