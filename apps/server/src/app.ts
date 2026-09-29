import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import {
  ApiKeyBody,
  AppState,
  ClientCommand,
  CreateMemoryBody,
  LoginCodeBody,
  PROTOCOL_VERSION,
  CreateRoutineBody,
  RenameConversationBody,
  SaveCommandBody,
  SchedulePreviewBody,
  UpdateRoutineBody,
  StartLoginBody,
  UpdateMemoryBody,
  UpdateSettingsBody,
  type ServerEvent,
} from '@conch/protocol';
import Fastify, { type FastifyReply } from 'fastify';
import type { z } from 'zod';

import { ConversationError } from './conversations/manager';
import { preview } from './routines/schedule';
import { RoutineError } from './routines/service';
import { registerSecurity } from './security';
import { SERVER_VERSION, type Services } from './services';

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  reply: FastifyReply,
): z.infer<T> | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
  return undefined;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof RoutineError) {
    const status = { 'not-found': 404, invalid: 400, busy: 409, 'engine-unavailable': 503 }[
      error.code
    ];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof ConversationError) {
    const status = error.code === 'not-found' ? 404 : error.code === 'busy' ? 409 : 503;
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  throw error;
}

export async function buildApp(services: Services) {
  const { config } = services;
  const app = Fastify({
    logger: config.CONCH_LOG_LEVEL === 'silent' ? false : { level: config.CONCH_LOG_LEVEL },
  });
  registerSecurity(app, config);
  await app.register(fastifyWebsocket);

  const appState = async () => {
    const settings = await services.settings.get();
    return AppState.parse({
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      onboarded: settings.onboarded,
      persona: settings.persona,
      profile: settings.profile,
      preferences: settings.preferences,
      engine: await services.engineStatus(),
      workspace: await services.settings.workspace(),
    });
  };

  // ── App & settings ─────────────────────────────────────────────────────
  app.get('/api/health', () => ({
    ok: true,
    serverVersion: SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  }));
  app.get('/api/state', appState);
  app.patch('/api/settings', async (request, reply) => {
    const body = parse(UpdateSettingsBody, request.body, reply);
    if (!body) return;
    await services.settings.update(body);
    return appState();
  });

  // ── Engine ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { refresh?: string } }>('/api/engine', (request) =>
    services.engineStatus(request.query.refresh === '1'),
  );
  app.post('/api/engine/login', async (request, reply) => {
    const body = parse(StartLoginBody, request.body ?? {}, reply);
    if (!body) return;
    if (body.method === 'api-key')
      return reply
        .code(400)
        .send({ error: 'bad-request', message: 'Use PUT /api/engine/api-key.' });
    services.startLogin(body.method);
    return { ok: true };
  });
  app.post('/api/engine/login/code', async (request, reply) => {
    const body = parse(LoginCodeBody, request.body, reply);
    if (!body) return;
    services.submitLoginCode(body.code);
    return { ok: true };
  });
  app.post('/api/engine/login/cancel', async () => {
    services.cancelLogin();
    return { ok: true };
  });
  app.put('/api/engine/api-key', async (request, reply) => {
    const body = parse(ApiKeyBody, request.body, reply);
    if (!body) return;
    return services.setApiKey(body.apiKey.trim());
  });
  app.delete('/api/engine/api-key', () => services.setApiKey(undefined));

  app.get<{ Querystring: { refresh?: string } }>('/api/capabilities', async (request, reply) => {
    try {
      return await services.capabilities(request.query.refresh === '1');
    } catch (error) {
      return reply
        .code(503)
        .send({ error: 'engine-unavailable', message: (error as Error).message });
    }
  });

  // ── Custom commands ────────────────────────────────────────────────────
  app.get('/api/commands', () => services.commands.list());
  app.put<{ Params: { name: string } }>('/api/commands/:name', async (request, reply) => {
    const body = parse(
      SaveCommandBody,
      { ...(request.body as object), name: request.params.name },
      reply,
    );
    if (!body) return;
    return services.commands.save(body);
  });
  app.delete<{ Params: { name: string } }>('/api/commands/:name', async (request, reply) => {
    const removed = await services.commands.remove(request.params.name);
    return removed
      ? { ok: true }
      : reply.code(404).send({ error: 'not-found', message: 'Command not found.' });
  });

  // ── Routines ───────────────────────────────────────────────────────────
  app.get('/api/routines', () => services.routines.list());
  app.post('/api/routines/preview', async (request, reply) => {
    const body = parse(SchedulePreviewBody, request.body, reply);
    if (!body) return;
    return preview(body.schedule, body.timezone);
  });
  app.post('/api/routines', async (request, reply) => {
    const body = parse(CreateRoutineBody, request.body, reply);
    if (!body) return;
    try {
      return await services.routines.create(body, { createdBy: 'user' });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.get<{ Params: { id: string } }>('/api/routines/:id', async (request, reply) => {
    try {
      return await services.routines.detail(request.params.id);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.patch<{ Params: { id: string } }>('/api/routines/:id', async (request, reply) => {
    const body = parse(UpdateRoutineBody, request.body, reply);
    if (!body) return;
    try {
      return await services.routines.update(request.params.id, body);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.delete<{ Params: { id: string } }>('/api/routines/:id', async (request, reply) => {
    try {
      await services.routines.remove(request.params.id);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post<{ Params: { id: string } }>('/api/routines/:id/run', async (request, reply) => {
    try {
      return await services.routines.runNow(request.params.id);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ── Memory ─────────────────────────────────────────────────────────────
  app.get('/api/memories', () => services.memory.list());
  app.post('/api/memories', async (request, reply) => {
    const body = parse(CreateMemoryBody, request.body, reply);
    if (!body) return;
    return services.memory.add({ ...body, source: 'user' });
  });
  app.patch<{ Params: { id: string } }>('/api/memories/:id', async (request, reply) => {
    const body = parse(UpdateMemoryBody, request.body, reply);
    if (!body) return;
    const memory = await services.memory.update(request.params.id, body);
    return memory ?? reply.code(404).send({ error: 'not-found', message: 'Memory not found.' });
  });
  app.delete<{ Params: { id: string } }>('/api/memories/:id', async (request, reply) => {
    const removed = await services.memory.remove(request.params.id);
    return removed
      ? { ok: true }
      : reply.code(404).send({ error: 'not-found', message: 'Memory not found.' });
  });

  // ── Conversations ──────────────────────────────────────────────────────
  app.get('/api/conversations', () => services.conversations.list());
  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (request, reply) => {
    try {
      return await services.conversations.detail(request.params.id);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.patch<{ Params: { id: string } }>('/api/conversations/:id', async (request, reply) => {
    const body = parse(RenameConversationBody, request.body, reply);
    if (!body) return;
    try {
      await services.conversations.rename(request.params.id, body.title);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (request) => {
    await services.conversations.remove(request.params.id);
    return { ok: true };
  });

  // ── Live stream ────────────────────────────────────────────────────────
  app.get('/ws', { websocket: true }, (socket) => {
    const subscribed = new Set<string>();
    const send = (event: ServerEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    };
    const off = services.broadcast.on((event) => {
      if (event.type === 'conversation.event' && !subscribed.has(event.event.conversationId))
        return;
      send(event);
    });
    socket.on('close', off);
    send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, serverVersion: SERVER_VERSION });

    socket.on('message', async (raw: Buffer) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        return send({ type: 'error', code: 'bad-request', message: 'Invalid JSON.' });
      }
      const parsed = ClientCommand.safeParse(json);
      if (!parsed.success) {
        return send({
          type: 'error',
          code: 'bad-request',
          message: parsed.error.issues[0]?.message ?? 'Invalid command.',
        });
      }
      const command = parsed.data;
      try {
        switch (command.type) {
          case 'ping':
            return send({ type: 'pong' });
          case 'conversation.subscribe': {
            subscribed.add(command.conversationId);
            const events = await services.conversations.eventsAfter(
              command.conversationId,
              command.afterSeq,
            );
            for (const event of events) send({ type: 'conversation.event', event });
            return;
          }
          case 'conversation.unsubscribe':
            subscribed.delete(command.conversationId);
            return;
          case 'conversation.send': {
            // Subscribe before sending so the first events aren't missed.
            if (command.conversationId) subscribed.add(command.conversationId);
            const unsubscribeCreated = services.broadcast.on((event) => {
              if (
                event.type === 'conversation.created' &&
                event.clientMessageId === command.clientMessageId
              ) {
                subscribed.add(event.conversation.id);
              }
            });
            try {
              await services.conversations.send(command);
            } finally {
              unsubscribeCreated();
            }
            return;
          }
          case 'conversation.configure':
            return await services.conversations.configure(command.conversationId, command.options);
          case 'conversation.interrupt':
            return await services.conversations.interrupt(command.conversationId);
          case 'permission.respond':
            return await services.conversations.respond(
              command.conversationId,
              command.permissionId,
              command.decision,
            );
        }
      } catch (error) {
        const code = error instanceof ConversationError ? error.code : 'internal';
        send({
          type: 'error',
          code,
          message: (error as Error).message,
          ...('conversationId' in command &&
            command.conversationId && { conversationId: command.conversationId }),
          ...(command.type === 'conversation.send' && { clientMessageId: command.clientMessageId }),
        });
      }
    });
  });

  // ── Web app ────────────────────────────────────────────────────────────
  const dist = config.CONCH_WEB_DIST ?? resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(join(dist, 'index.html'))) {
    // `wildcard: true` resolves files per request, so a rebuilt web app is served
    // without restarting the gateway. Unknown app routes fall back to the SPA;
    // missing assets (anything with a file extension) stay a real 404.
    await app.register(fastifyStatic, { root: dist, wildcard: true });
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      if (path.startsWith('/api') || /\.[a-z0-9]+$/i.test(path)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
