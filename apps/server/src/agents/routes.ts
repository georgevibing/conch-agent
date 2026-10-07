/**
 * Agents (ADR 0101), under `/api`, behind the gateway's host, origin and
 * sign-in checks like every other route. Only a person makes, changes or
 * removes an agent: the assistant has no tool for it, and its own file tools
 * can't reach `~/.conch/agents` (`lib/protect.ts`), so it can't rewrite the
 * instructions it is given.
 */
import {
  AGENT_LIMITS,
  AgentAvatarBody,
  AgentId,
  AgentImageId,
  CreateAgentBody,
  DefaultAgentBody,
  GenerateAvatarBody,
  ReorderAgentsBody,
  TONES,
  UpdateAgentBody,
  type AvatarGeneration,
  type GeneratedAvatar,
  type Tone,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';

import { cleanPicture } from './picture';
import { AgentError, type AgentStore } from './store';

const STATUS: Record<AgentError['code'], number> = {
  'not-found': 404,
  'too-many': 409,
  'name-taken': 409,
  last: 409,
  'bad-order': 409,
  'bad-picture': 400,
};

/** What makes a face: the provider that draws it, when one is connected. */
export interface FaceMaker {
  canMake(): Promise<boolean>;
  face(
    prompt: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Buffer; mimeType: string; costUsd?: number }>;
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof AgentError)
    return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
  throw error;
}

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  reply: FastifyReply,
): z.infer<T> | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  void reply.code(400).send({ error: 'bad-request', message: parsed.error.issues[0]?.message });
  return undefined;
}

/**
 * What the model is asked to draw: your words, inside a frame that keeps it a
 * face (square, one subject, no words in it). Your words can't make it more
 * than a picture: it only ever comes back to the page as bytes to look at.
 */
export function facePrompt(body: { prompt: string; name?: string; tone?: Tone }): string {
  return [
    'A square avatar for a personal AI assistant, to be shown small and round beside its messages in a chat app.',
    body.name ? `The assistant is called ${body.name}.` : '',
    body.tone ? `Its manner: ${TONES[body.tone].description.toLowerCase()}.` : '',
    `What it should look like: ${body.prompt}`,
    'One clear subject, centred, filling most of the frame, on a simple background. No text, letters, logos or watermarks.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function registerAgentRoutes(
  app: FastifyInstance,
  deps: { agents: AgentStore; faces?: FaceMaker },
): void {
  const { agents } = deps;

  app.get('/api/agents', () => agents.list());

  // Before `/api/agents/:id`, so `avatar` is never read as an id.
  app.get('/api/agents/avatar/generate', async (): Promise<AvatarGeneration> => {
    const available = (await deps.faces?.canMake().catch(() => false)) ?? false;
    return available
      ? { available, by: 'OpenRouter', paid: true }
      : {
          available,
          reason: 'Connect OpenRouter in Settings → Providers, and your assistant can make one.',
        };
  });

  app.post(
    '/api/agents/avatar/generate',
    { bodyLimit: 8_000 },
    async (request, reply): Promise<GeneratedAvatar | undefined> => {
      const body = parse(GenerateAvatarBody, request.body, reply);
      if (!body) return;
      if (!deps.faces || !(await deps.faces.canMake().catch(() => false)))
        return reply.code(409).send({
          error: 'unavailable',
          message: 'Connect OpenRouter in Settings → Providers to make a picture.',
        });
      const abort = new AbortController();
      request.raw.on('close', () => {
        if (!reply.sent) abort.abort();
      });
      let made: Awaited<ReturnType<FaceMaker['face']>>;
      try {
        made = await deps.faces.face(facePrompt(body), abort.signal);
      } catch (error) {
        return reply.code(502).send({
          error: 'not-made',
          message: error instanceof Error ? error.message : 'No picture was made. Try again.',
        });
      }
      // Read and cleaned like an upload: what comes back is only a picture.
      const clean = cleanPicture(made.bytes, AGENT_LIMITS.generatedBytes);
      if (!clean.ok)
        return reply.code(502).send({
          error: 'not-made',
          message: 'The picture that came back can’t be used. Try again.',
        });
      return {
        data: clean.bytes.toString('base64'),
        type: clean.type,
        ...(made.costUsd !== undefined && { costUsd: made.costUsd }),
      };
    },
  );

  app.put('/api/agents/order', async (request, reply) => {
    const body = parse(ReorderAgentsBody, request.body, reply);
    if (!body) return;
    try {
      return await agents.reorder(body.ids);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.put('/api/agents/default', async (request, reply) => {
    const body = parse(DefaultAgentBody, request.body, reply);
    if (!body) return;
    try {
      return await agents.setDefault(body.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/agents', { bodyLimit: 64_000 }, async (request, reply) => {
    const body = parse(CreateAgentBody, request.body, reply);
    if (!body) return;
    try {
      return await agents.create(body);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const id = parse(AgentId, request.params.id, reply);
    if (!id) return;
    const agent = await agents.get(id);
    return agent ?? reply.code(404).send({ error: 'not-found', message: 'No such agent.' });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/agents/:id',
    { bodyLimit: 64_000 },
    async (request, reply) => {
      const id = parse(AgentId, request.params.id, reply);
      const body = id && parse(UpdateAgentBody, request.body, reply);
      if (!id || !body) return;
      try {
        return await agents.update(id, body);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const id = parse(AgentId, request.params.id, reply);
    if (!id) return;
    try {
      await agents.remove(id);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** A picture of your own: base64, framed by the page, read and cleaned here. */
  app.put<{ Params: { id: string } }>(
    '/api/agents/:id/avatar',
    { bodyLimit: Math.ceil((AGENT_LIMITS.avatarBytes * 4) / 3) + 1024 },
    async (request, reply) => {
      const id = parse(AgentId, request.params.id, reply);
      const body = id && parse(AgentAvatarBody, request.body, reply);
      if (!id || !body) return;
      try {
        return await agents.setImage(id, body.data);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  /** Served only as the picture it is, never as a page, and cached for good (its address changes with it). */
  app.get<{ Params: { id: string; imageId: string } }>(
    '/api/agents/:id/avatar/:imageId',
    async (request, reply) => {
      const id = AgentId.safeParse(request.params.id);
      const imageId = AgentImageId.safeParse(request.params.imageId);
      const image =
        id.success && imageId.success ? await agents.image(id.data, imageId.data) : undefined;
      if (!image) return reply.code(404).send({ error: 'not-found', message: 'No picture.' });
      return reply
        .type(image.type)
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'")
        .header('content-disposition', 'inline')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(image.bytes);
    },
  );
}
