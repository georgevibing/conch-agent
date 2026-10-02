import {
  AnswerChannelRequestBody,
  CheckChannelBody,
  CreateChannelBody,
  Id,
  OpenImessageBody,
  ReplaceChannelTokenBody,
  SetChannelDoorBody,
  UpdateChannelBody,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import type { Gatekeeper } from '../security';
import { type ChannelDoorService, DoorError } from './door';
import type { ChannelService } from './service';
import { ChannelServiceError } from './service';
import { teamsAppPackage } from './teams-app';

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
  /** The public door (Teams, WeChat), ADR 0045. */
  door?: ChannelDoorService,
  /** Gmail the app's sign-in, if it has an app password (ADR 0052). */
  gmailLogin?: () => Promise<{ address: string; password: string } | undefined>,
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

  // ── The public door (ADR 0045) ──────────────────────────────────────────
  // Opening it lets the internet reach this computer's door: a trust decision,
  // like connecting a bot. Closing it never needs one.
  if (door) {
    app.get('/api/channels/door', () => door.status());
    app.post('/api/channels/door/tailscale', async (request, reply) => {
      if (!trusted(request, reply)) return reply;
      return door.useTailscale();
    });
    app.put('/api/channels/door', async (request, reply) => {
      const body = parse(SetChannelDoorBody, request.body, reply);
      if (!body || !trusted(request, reply)) return reply;
      try {
        return await door.useOwn(body.url);
      } catch (error) {
        if (error instanceof DoorError)
          return reply.code(400).send({ error: 'invalid', message: error.message });
        throw error;
      }
    });
    app.post('/api/channels/door/check', () => door.check());
    app.delete('/api/channels/door', () => door.turnOff());
  }

  if (mocks) app.get('/api/channels/mock', () => mocks());

  // iMessage on this Mac: what Messages has, and whether macOS lets Conch read it yet.
  app.get('/api/channels/imessage', () => channels.imessageSetup());

  app.post('/api/channels/imessage/open', async (request, reply) => {
    const body = parse(OpenImessageBody, request.body, reply);
    if (!body) return reply;
    // It opens a window on this Mac: only for someone sitting at it.
    if (!gate.isLocal(request))
      return reply
        .code(403)
        .send({ error: 'local-only', message: 'Do this on the Mac Conch runs on.' });
    try {
      await channels.openImessage(body.place);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  // ── Gmail, talking to you by email too (ADR 0052) ───────────────────────
  // The Gmail app's app password, offered in a tap: the browser only ever
  // learns the address. Using it opens a way in, so it needs a person who
  // confirmed it's them, like the other way round (ADR 0048).
  app.get('/api/channels/email/gmail', async () => ({
    address: (await gmailLogin?.().catch(() => undefined))?.address,
  }));
  app.post('/api/channels/email/gmail', async (request, reply) => {
    if (!gate.verified(request.access))
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    const login = await gmailLogin?.().catch(() => undefined);
    if (!login)
      return reply.code(409).send({
        error: 'unavailable',
        message: 'Gmail isn’t connected with an app password any more. Set up Email instead.',
      });
    try {
      return await channels.create({ kind: 'email', provider: 'gmail', ...login });
    } catch (error) {
      return fail(reply, error);
    }
  });

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

  // What to paste in WeChat's server settings: its Token and EncodingAESKey are keys.
  app.get<{ Params: { id: string } }>('/api/channels/:id/hook', async (request, reply) => {
    if (!trusted(request, reply)) return reply;
    try {
      const hook = await channels.hookSecrets(request.params.id);
      return reply.header('cache-control', 'no-store').send(hook);
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** The Teams app to upload, made for this bot. */
  app.get<{ Params: { id: string } }>('/api/channels/:id/teams-app', async (request, reply) => {
    try {
      const channel = await channels.get(request.params.id);
      if (channel.kind !== 'microsoftteams')
        return reply.code(404).send({ error: 'not-found', message: 'That isn’t a Teams channel.' });
      const profile = await channels.profile();
      const zip = teamsAppPackage({
        appId: channel.bot.id,
        name: profile.assistant,
        ...(profile.owner && { owner: profile.owner }),
        website: door?.status().url ?? 'https://teams.microsoft.com',
      });
      return reply
        .header('content-type', 'application/zip')
        .header(
          'content-disposition',
          `attachment; filename="${profile.assistant.replace(/[^\w.-]+/g, '-') || 'Conch'}-teams-app.zip"`,
        )
        .header('cache-control', 'no-store')
        .send(zip);
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
