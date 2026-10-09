import { DraftKey, DraftList, DraftReply, PutDraftBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { DraftError, type DraftStore } from './store';

/**
 * What you were writing and hadn't sent (ADR 0124). Under `/api`, behind the
 * gateway's host, origin and sign-in checks: a draft is your own words and
 * the ids of files you uploaded yourself, so it needs no more than a
 * signed-in device. `:id` is a conversation's id, or `new` for the new chat
 * page.
 */
export function registerDraftRoutes(app: FastifyInstance, drafts: DraftStore): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof DraftError)) throw error;
    return reply.code(404).send({ error: error.code, message: error.message });
  };
  const key = (id: string, reply: FastifyReply) => {
    if (DraftKey.safeParse(id).success) return id;
    void reply.code(400).send({ error: 'bad-request', message: 'Not a chat.' });
    return undefined;
  };

  app.get('/api/drafts', async () => DraftList.parse(await drafts.list()));

  app.get<{ Params: { id: string } }>('/api/conversations/:id/draft', async (request, reply) => {
    const id = key(request.params.id, reply);
    if (!id) return;
    return DraftReply.parse(await drafts.get(id));
  });

  app.put<{ Params: { id: string } }>('/api/conversations/:id/draft', async (request, reply) => {
    const id = key(request.params.id, reply);
    if (!id) return;
    const body = PutDraftBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'bad-request', message: body.error.issues[0]?.message ?? 'Not a draft.' });
    try {
      return DraftReply.parse(await drafts.put(id, body.data));
    } catch (error) {
      return fail(reply, error);
    }
  });
}
