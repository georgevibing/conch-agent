/**
 * Standing orders and the check-in (ADR 0107), under `/api`, behind the
 * gateway's host, origin and sign-in checks. Everything here is a person's
 * choice in the UI: adding, changing, keeping or removing an order, the
 * check-in's quiet hours and switch. No tool the assistant has reaches any of
 * it; its one tool only leaves a draft for a card.
 */
import {
  CheckInBody,
  CreateStandingOrderBody,
  StandingOrders,
  UpdateStandingOrderBody,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { StandingOrderStore } from './orders';
import type { CheckIns } from './service';

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export function registerCheckInRoutes(
  app: FastifyInstance,
  deps: { orders: StandingOrderStore; checkins: CheckIns },
): void {
  const { orders, checkins } = deps;
  const bad = (reply: FastifyReply, message: string | undefined) =>
    reply.code(400).send({ error: 'bad-request', message: message ?? 'That isn’t right.' });
  const gone = (reply: FastifyReply) =>
    reply
      .code(404)
      .send({ error: 'not-found', message: 'That standing order isn’t there any more.' });

  app.get('/api/standing-orders', async () =>
    StandingOrders.parse({ orders: await orders.list() }),
  );

  app.post('/api/standing-orders', async (request, reply) => {
    const body = CreateStandingOrderBody.safeParse(request.body);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    const added = await orders.add({ ...body.data, from: 'you' });
    if (!added.ok) return reply.code(409).send({ error: added.reason, message: added.message });
    return added.order;
  });

  app.patch<{ Params: { id: string } }>('/api/standing-orders/:id', async (request, reply) => {
    const id = Id.safeParse(request.params.id);
    const body = UpdateStandingOrderBody.safeParse(request.body);
    if (!id.success) return gone(reply);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    const order = await orders.update(id.data, body.data);
    if (!order) return gone(reply);
    if (order === 'same')
      return reply
        .code(409)
        .send({ error: 'same', message: 'There’s already a standing order that says that.' });
    return order;
  });

  app.delete<{ Params: { id: string } }>('/api/standing-orders/:id', async (request, reply) => {
    const id = Id.safeParse(request.params.id);
    if (!id.success || !(await orders.remove(id.data))) return gone(reply);
    return { ok: true };
  });

  app.get('/api/checkin', () => checkins.status());

  app.put('/api/checkin', async (request, reply) => {
    const body = CheckInBody.safeParse(request.body);
    if (!body.success) return bad(reply, body.error.issues[0]?.message);
    return checkins.configure(body.data);
  });

  /** Look now: a person asking, so quiet hours and the half hour don't hold it. */
  app.post('/api/checkin/look', async () => {
    await checkins.look({ now: true });
    return checkins.status();
  });

  app.post<{ Params: { id: string } }>('/api/checkin/told/:id/forget', async (request, reply) => {
    const id = Id.safeParse(request.params.id);
    if (!id.success) return bad(reply, 'That isn’t right.');
    return checkins.forget(id.data);
  });
}
