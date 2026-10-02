import {
  AnswerChannelRequestBody,
  CheckChannelBody,
  CreateChannelBody,
  Id,
  ReplaceChannelTokenBody,
  UpdateChannelBody,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import type { Gatekeeper } from '../security';
import type { ChannelService } from './service';
import { ChannelServiceError } from './service';

const STATUS: Record<ChannelServiceError['code'], number> = {
  'not-found': 404,
  invalid: 400,
  unavailable: 409,
};

/**
 * The Channels page's routes (ADR 0018). All under `/api`, so Host, Origin,
 * Fetch Metadata and sign-in apply as everywhere. Opening a new way in —
 * connecting a bot, letting someone talk to it, turning one back on — is a
 * trust decision: from another device it needs a password or key from the
 * last few minutes, like the terminal.
 */
export function registerChannelRoutes(
  app: FastifyInstance,
  channels: ChannelService,
  gate: Gatekeeper,
  /** With the mock engine only: where the pretend apps are, for tests and demos. */
  mocks?: () => Record<string, string | undefined>,
) {
  const parse = <T extends z.ZodType>(schema: T, value: unknown, reply: FastifyReply) => {
    const result = schema.safeParse(value);
    if (result.success) return result.data as z.infer<T>;
    void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
    return undefined;
  };

  /** Grants reach: fine here, and from elsewhere only right after confirming it's you. */
  const trusted = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.isLocal(request) || gate.verified(request.access)) return true;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    return false;
  };

  const fail = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof ChannelServiceError)) throw error;
    return reply.code(STATUS[error.code]).send({
      error: error.code,
      message: error.message,
      ...(error.field && { field: error.field }),
    });
  };

  const person = (value: string, reply: FastifyReply) => {
    if (Id.safeParse(value).success) return value;
    void reply.code(404).send({ error: 'not-found', message: 'Not found.' });
    return undefined;
  };

  app.get('/api/channels', () => channels.list());

  if (mocks) app.get('/api/channels/mock', () => mocks());

  app.post('/api/channels/check', async (request, reply) => {
    const body = parse(CheckChannelBody, request.body, reply);
    if (!body) return reply;
    return channels.check(body);
  });

  app.post('/api/channels', async (request, reply) => {
    const body = parse(CreateChannelBody, request.body, reply);
    if (!body || !trusted(request, reply)) return reply;
    try {
      return await channels.create(body);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/api/channels/:id', async (request, reply) => {
    try {
      return await channels.get(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/channels/:id', async (request, reply) => {
    const body = parse(UpdateChannelBody, request.body, reply);
    if (!body) return reply;
    if (body.enabled === true && !trusted(request, reply)) return reply;
    try {
      return await channels.update(request.params.id, body);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.put<{ Params: { id: string } }>('/api/channels/:id/token', async (request, reply) => {
    const body = parse(ReplaceChannelTokenBody, request.body, reply);
    if (!body || !trusted(request, reply)) return reply;
    try {
      return await channels.replaceToken(request.params.id, body);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/channels/:id', async (request, reply) => {
    try {
      await channels.remove(request.params.id);
      return reply.code(204).send();
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/channels/:id/pair', async (request, reply) => {
    if (!trusted(request, reply)) return reply;
    try {
      return await channels.pair(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string; personId: string } }>(
    '/api/channels/:id/requests/:personId',
    async (request, reply) => {
      const personId = person(request.params.personId, reply);
      const body = parse(AnswerChannelRequestBody, request.body, reply);
      if (!personId || !body) return reply;
      if (body.answer === 'allow' && !trusted(request, reply)) return reply;
      try {
        return await channels.answer(request.params.id, personId, body.answer);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.delete<{ Params: { id: string; personId: string } }>(
    '/api/channels/:id/people/:personId',
    async (request, reply) => {
      const personId = person(request.params.personId, reply);
      if (!personId) return reply;
      try {
        return await channels.removePerson(request.params.id, personId);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/channels/:id/repair', async (request, reply) => {
    try {
      return await channels.repair(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/channels/:id/test', async (request, reply) => {
    try {
      await channels.test(request.params.id);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });
}
