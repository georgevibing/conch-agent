/**
 * Settings → Access → Other apps (ADR 0073): pairing apps with Conch, what each may
 * use, and letting them in through your own address.
 *
 * Pairing, widening what an app may use, and letting apps in from elsewhere
 * grant reach, so they need the owner in a browser — this computer, or a
 * signed-in device that's let in — who just confirmed it's them. Never a
 * script's access key, and never the assistant. Taking reach away (removing
 * an app, turning the address off for apps) only needs a sign-in.
 */
import {
  McpRemoteBody,
  type McpScope,
  PairMcpClientBody,
  UpdateMcpClientBody,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Gatekeeper } from '../security';
import type { McpPairing } from './pairing';
import { McpError } from './store';

export function registerMcpRoutes(
  app: FastifyInstance,
  pairing: McpPairing,
  gate: Gatekeeper,
): void {
  /** The owner, in a browser, just now (as for changing your address, ADR 0064). */
  const owner = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const session = request.access?.kind === 'session' ? request.access.session : undefined;
    const allowed =
      gate.isLocal(request) ||
      (session !== undefined &&
        (!(await gate.store.approvalOn()) || (await gate.store.deviceApproved(session.deviceId))));
    if (!allowed) {
      void reply.code(403).send({
        error: 'approver-only',
        message: 'Pair other apps from Conch itself, on a device you’ve let in.',
      });
      return false;
    }
    if (!gate.verified(request.access)) {
      void reply.code(403).send({
        error: 'verify-required',
        message: 'Confirm it’s you to let another app use Conch.',
      });
      return false;
    }
    return true;
  };

  const failed = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof McpError)) throw error;
    return reply
      .code(error.code === 'not-found' ? 404 : 400)
      .send({ error: error.code, message: error.message });
  };

  app.get('/api/mcp', () => pairing.overview());

  app.post('/api/mcp/clients', async (request, reply) => {
    const body = PairMcpClientBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'bad-request', message: 'Choose what the app may use.' });
    if (!(await owner(request, reply))) return;
    try {
      return await pairing.pair(body.data);
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/mcp/clients/:id', async (request, reply) => {
    const body = UpdateMcpClientBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: 'Nothing to change.' });
    const current = await pairing
      .overview()
      .then((o) => o.clients.find((c) => c.id === request.params.id));
    if (!current)
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'That app isn’t paired with Conch any more.' });
    // Less reach is anyone's to choose; more needs the owner, just now.
    const before = new Set<McpScope>(current.scopes);
    const widens =
      (body.data.scopes ?? []).some((s) => !before.has(s)) ||
      (body.data.remote === true && !current.remote);
    if (widens && !(await owner(request, reply))) return;
    try {
      return await pairing.update(request.params.id, body.data);
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/mcp/clients/:id', async (request, reply) => {
    if (!(await pairing.remove(request.params.id)))
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'That app isn’t paired with Conch any more.' });
    return { ok: true };
  });

  app.put('/api/mcp/remote', async (request, reply) => {
    const body = McpRemoteBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad-request', message: 'On or off?' });
    if (body.data.on && !(await owner(request, reply))) return;
    await pairing.setRemote(body.data.on);
    return pairing.overview();
  });
}
