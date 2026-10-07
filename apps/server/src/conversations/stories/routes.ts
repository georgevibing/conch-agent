/**
 * "Why?" on a step (ADR 0103), under `/api`, behind the gateway's host,
 * origin and sign-in checks like every other chat route. It only reads the
 * chat's log and asks a small model about it: it changes nothing, and no tool
 * the assistant has reaches it.
 */
import { ExplainStepBody, type ExplainStepResult } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import { ConversationError } from '../manager';
import { ExplainError, type StoryExplainer } from './explain';

/** A chat id as the store makes them: nothing that could become a path. */
const CHAT_ID = /^[\w-]{1,128}$/;

export function registerStoryRoutes(app: FastifyInstance, explainer: StoryExplainer): void {
  app.post<{ Params: { id: string } }>(
    '/api/conversations/:id/explain',
    async (request, reply): Promise<ExplainStepResult | undefined> => {
      if (!CHAT_ID.test(request.params.id))
        return reply.code(404).send({ error: 'not-found', message: 'Conversation not found.' });
      const body = ExplainStepBody.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({
          error: 'bad-request',
          message: body.error.issues[0]?.message ?? 'Say which step.',
        });
      try {
        return await explainer.explain(request.params.id, body.data.toolUseId);
      } catch (error) {
        if (
          (error instanceof ExplainError || error instanceof ConversationError) &&
          error.code === 'not-found'
        )
          return reply.code(404).send({ error: 'not-found', message: error.message });
        throw error;
      }
    },
  );
}
