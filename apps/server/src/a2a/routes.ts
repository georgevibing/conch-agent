/**
 * Settings → Agents → Outside agents (ADR 0112), and stopping a round.
 *
 * Behind the gateway's sign-in like every `/api` route. Adding an outside
 * agent lets Conch send it your words when you mention it, never more: it
 * grants nothing in Conch, so a sign-in is enough. Letting another agent in
 * to yours is a pairing, and goes through Other apps' owner-and-confirmed
 * routes (`/api/mcp/clients`, ADR 0073).
 */
import { OutsidePasteBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { RoundService } from '../agents/rounds';
import { OutsideError, type OutsideAgents } from './outside';

export function registerOutsideRoutes(
  app: FastifyInstance,
  deps: { outside: OutsideAgents; rounds: RoundService },
): void {
  const { outside } = deps;

  const failed = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof OutsideError)) throw error;
    const status = error.code === 'not-found' ? 404 : error.code === 'full' ? 409 : 400;
    return reply.code(status).send({ error: error.code, message: error.message });
  };

  app.get('/api/agents/outside', async () => ({ agents: await outside.list() }));

  app.post('/api/agents/outside/look', async (request, reply) => {
    const body = OutsidePasteBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: 'Paste the agent’s address.' });
    try {
      return await outside.preview(body.data.paste);
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post('/api/agents/outside', async (request, reply) => {
    const body = OutsidePasteBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: 'Paste the agent’s address.' });
    try {
      return await outside.add(body.data.paste);
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/agents/outside/:id', async (request, reply) => {
    if (!(await outside.remove(request.params.id)))
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'That outside agent isn’t in Conch any more.' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/conversations/:id/round/stop', async (request) => ({
    stopped: await deps.rounds.stop(request.params.id),
  }));
}
