import { PushAnswerBody, RenewPushBody, SubscribePushBody, UpdatePushBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { describeDevice } from '../auth/device';
import type { ConversationManager } from '../conversations/manager';
import type { Access } from '../security';
import type { PushService } from './service';
import { allowedEndpoint } from './webpush';

/**
 * Who a notification belongs to: a signed-in device (ADR 0024), its session
 * when it has no device yet, or this computer when sign-in is off. Scripts
 * with an access key have no screen to notify.
 */
export function pushOwner(access: Access | undefined): string | undefined {
  if (access?.kind === 'session')
    return access.session.deviceId
      ? `device:${access.session.deviceId}`
      : `session:${access.session.id}`;
  if (access?.kind === 'local') return 'local';
  return undefined;
}

function parse<T extends z.ZodType>(schema: T, value: unknown, reply: FastifyReply) {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.infer<T>;
  void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
  return undefined;
}

/**
 * Notifications (ADR 0027). Under `/api`, behind the gateway's host, origin
 * and sign-in checks: a device turns its own notifications on, and any
 * signed-in device can see and change them all (Settings → Notifications).
 * Deny from a notification answers with that device's own sign-in; allowing
 * always opens Conch, so nothing is approved from a lock screen.
 */
export function registerPushRoutes(
  app: FastifyInstance,
  deps: { push: PushService; conversations: ConversationManager },
): void {
  const { push, conversations } = deps;
  const ownerOf = (request: FastifyRequest, reply: FastifyReply) => {
    const owner = pushOwner(request.access);
    if (!owner)
      void reply.code(403).send({
        error: 'forbidden',
        message: 'Notifications are for devices with a screen, not access keys.',
      });
    return owner;
  };

  app.get('/api/push', (request) => push.status(pushOwner(request.access)));

  app.post('/api/push/subscriptions', async (request, reply) => {
    const owner = ownerOf(request, reply);
    if (!owner) return;
    const body = parse(SubscribePushBody, request.body, reply);
    if (!body) return;
    if (!allowedEndpoint(body.subscription.endpoint))
      return reply.code(400).send({
        error: 'bad-request',
        message:
          'That browser’s notifications go somewhere Conch doesn’t know, so it won’t send there.',
      });
    const name = describeDevice(request.headers['user-agent']).device;
    await push.subscribe(owner, name, body.subscription, body.prefs);
    return push.status(owner);
  });

  app.post('/api/push/subscriptions/renew', async (request, reply) => {
    const owner = ownerOf(request, reply);
    if (!owner) return;
    const body = parse(RenewPushBody, request.body, reply);
    if (!body) return;
    if (!allowedEndpoint(body.subscription.endpoint))
      return reply.code(400).send({ error: 'bad-request', message: 'Not a push service.' });
    return { renewed: await push.renew(owner, body.old, body.subscription) };
  });

  app.patch<{ Params: { id: string } }>('/api/push/subscriptions/:id', async (request, reply) => {
    const body = parse(UpdatePushBody, request.body, reply);
    if (!body) return;
    if (!(await push.update(request.params.id, body.prefs)))
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'That device isn’t getting notifications.' });
    return push.status(pushOwner(request.access));
  });

  app.delete<{ Params: { id: string } }>('/api/push/subscriptions/:id', async (request) => {
    await push.remove(request.params.id);
    return push.status(pushOwner(request.access));
  });

  app.post('/api/push/test', async (request, reply) => {
    const owner = ownerOf(request, reply);
    if (!owner) return;
    return { sent: await push.test(owner) };
  });

  // The Deny button on a notification: only ever a no, and only to what's still asked.
  app.post('/api/push/answer', async (request, reply) => {
    const body = parse(PushAnswerBody, request.body, reply);
    if (!body) return;
    await conversations
      .respond(body.conversationId, body.permissionId, 'deny')
      .catch(() => undefined);
    return { ok: true };
  });
}
