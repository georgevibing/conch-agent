import { OpenComputerUseAccessBody, UpdateComputerUseBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import type { DoctorCheck } from '../doctor/service';
import type { Gatekeeper } from '../security';
import type { ComputerUseService } from './service';

const SHOT = /^[a-z0-9]{6,40}$/;

/**
 * Settings → This computer's "Use your apps", the live card's picture and its
 * Stop (ADR 0110). Under `/api`, so the gateway's host, origin and sign-in
 * checks cover them like everything else. Turning it on is a trust decision:
 * from this computer, or right after confirming it's you elsewhere.
 */
export function registerComputerUseRoutes(
  app: FastifyInstance,
  service: ComputerUseService,
  gate: Gatekeeper,
) {
  const parse = <T extends z.ZodType>(schema: T, value: unknown, reply: FastifyReply) => {
    const result = schema.safeParse(value);
    if (result.success) return result.data as z.infer<T>;
    void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
    return undefined;
  };
  const here = (request: FastifyRequest) => gate.isLocal(request);

  app.get('/api/computer-use', (request) => service.status(here(request)));

  /** The chat's live card asks this while a turn runs: nothing is looked at to answer. */
  app.get('/api/computer-use/live', () => service.now());

  app.patch('/api/computer-use', async (request, reply) => {
    const body = parse(UpdateComputerUseBody, request.body, reply);
    if (!body) return reply;
    // Letting the assistant use your apps grants reach; turning it off never needs proof.
    if (body.enabled && !here(request) && !gate.verified(request.access))
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    await service.setEnabled(body.enabled);
    return service.status(here(request));
  });

  app.delete<{ Params: { id: string } }>('/api/computer-use/apps/:id', async (request) => {
    await service.forget(request.params.id.slice(0, 200));
    return service.status(here(request));
  });

  // It opens System Settings on the Mac: only for someone sitting at it.
  app.post('/api/computer-use/access', async (request, reply) => {
    const body = parse(OpenComputerUseAccessBody, request.body, reply);
    if (!body) return reply;
    if (!here(request))
      return reply
        .code(403)
        .send({ error: 'local-only', message: 'Do this on the computer Conch runs on.' });
    try {
      await service.openAccess(body.kind);
    } catch {
      return reply.code(409).send({
        error: 'unavailable',
        message: 'Couldn’t open System Settings. Open it from the Apple menu.',
      });
    }
    return service.status(true);
  });

  /** Stop, from the chat's live card: the same as the glowing edge's. */
  app.post('/api/computer-use/stop', async () => ({ stopped: await service.stop() }));

  /** The latest look at the screen, while its turn lasts. Never cached, never kept. */
  app.get<{ Params: { shot: string } }>('/api/computer-use/shot/:shot', async (request, reply) => {
    if (!SHOT.test(request.params.shot)) return reply.code(404).send();
    const jpeg = service.shot(request.params.shot);
    if (!jpeg) return reply.code(404).send();
    return reply
      .header('content-type', 'image/jpeg')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(jpeg);
  });
}

/** Repair everything: on, but macOS hasn't let it see or act (ADR 0110). */
export function computerUseCheck(service: ComputerUseService): DoctorCheck {
  const group = 'This computer';
  const title = 'Using your apps';
  return {
    id: 'computer-use',
    group,
    title,
    run: async () => {
      if (service.driver.platform === 'unsupported' || !(await service.store.enabled())) return [];
      const status = await service.status(false);
      const missing = [
        status.access.screen === 'missing' && 'Screen Recording',
        status.access.control === 'missing' && 'Accessibility',
      ].filter(Boolean);
      if (!missing.length)
        return [
          {
            id: 'computer-use',
            group,
            title,
            state: 'ok',
            message: 'The assistant can use the apps you let it, while you watch.',
          },
        ];
      return [
        {
          id: 'computer-use',
          group,
          title,
          state: 'needs-you',
          message: `macOS needs ${missing.join(' and ')} turned on for ${status.grantTo}.`,
          action: { kind: 'open', label: 'Open This computer', place: 'computer' },
        },
      ];
    },
  };
}
