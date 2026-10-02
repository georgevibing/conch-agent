import { DismissSuggestionBody, GetMeaningBody, TidyAnswerBody } from '@conch/protocol';
import type { FastifyInstance } from 'fastify';

import type { SkillSuggester } from '../skills/suggest';
import type { MemoryIndex } from './index';
import type { MemoryStore } from './store';
import type { MemoryTidy } from './tidy';

/**
 * It learns you (ADR 0032). Under `/api`, behind the gateway's host, origin
 * and sign-in checks. Nothing here grants the assistant anything: memories
 * waiting for an OK, the tidy-up's changes and skill suggestions are all
 * answered by a person.
 */
export function registerLearningRoutes(
  app: FastifyInstance,
  deps: {
    store: MemoryStore;
    index: MemoryIndex;
    tidy: MemoryTidy;
    suggester: SkillSuggester;
    /** Get Conch's own model for meaning (ADR 0041), and how far it got. */
    getMeaningModel: (languages: string[]) => Promise<void>;
    meaningState: () => { getting?: number; problem?: string };
  },
): void {
  const { store, index, tidy, suggester } = deps;

  app.get<{ Querystring: { q?: string } }>('/api/memories/search', async (request) => {
    const q = (request.query.q ?? '').slice(0, 200);
    return { results: (await index.search(q, 50)).map((r) => r.memory) };
  });

  app.post<{ Params: { id: string } }>('/api/memories/:id/keep', async (request, reply) => {
    const kept = await store.keep(request.params.id);
    if (!kept)
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'That memory isn’t there any more.' });
    void index.sync();
    return kept;
  });

  /** Everything Conch knows, to keep: Markdown (default) or JSON. */
  app.get<{ Querystring: { format?: string } }>('/api/memories/export', async (request, reply) => {
    const memories = (await store.list()).filter((m) => !m.pending);
    const date = new Date().toISOString().slice(0, 10);
    if (request.query.format === 'json') {
      return reply
        .header('content-disposition', `attachment; filename="conch-memories-${date}.json"`)
        .type('application/json')
        .send(JSON.stringify({ exportedAt: Date.now(), memories }, null, 2));
    }
    const kinds = ['preference', 'person', 'project', 'fact'] as const;
    const titles = {
      preference: 'Preferences',
      person: 'People',
      project: 'Projects',
      fact: 'Facts',
    };
    const body = [
      `# What Conch knows about you`,
      ``,
      `Exported ${date}.`,
      ...kinds.flatMap((kind) => {
        const list = memories.filter((m) => m.kind === kind);
        return list.length
          ? ['', `## ${titles[kind]}`, '', ...list.map((m) => `- ${m.content}`)]
          : [];
      }),
      '',
    ].join('\n');
    return reply
      .header('content-disposition', `attachment; filename="conch-memories-${date}.md"`)
      .type('text/markdown; charset=utf-8')
      .send(body);
  });

  /** `lang`: the browser's languages, which choose the model on offer. */
  const languagesOf = (lang: unknown) =>
    typeof lang === 'string'
      ? lang
          .split(',')
          .slice(0, 20)
          .map((l) => l.slice(0, 35))
      : [];
  const indexStatus = async (languages: string[]) => {
    const { getting, problem } = deps.meaningState();
    const status = await index.status(languages);
    return {
      ...status,
      ...(getting !== undefined && { getting }),
      // A problem matters while there's no meaning; once there is, it's past.
      ...(problem && status.mode === 'words' && { problem }),
    };
  };
  app.get<{ Querystring: { lang?: string } }>('/api/memory/index', (request) =>
    indexStatus(languagesOf(request.query.lang)),
  );
  app.post('/api/memory/index/rebuild', async () => {
    await index.rebuild();
    return indexStatus([]);
  });
  // The person pressed Get it: that's the consent for the download.
  app.post('/api/memory/index/model', async (request, reply) => {
    const body = GetMeaningBody.safeParse(request.body ?? {});
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    void deps.getMeaningModel(body.data.languages).catch(() => undefined);
    // Let it start, so the answer already shows progress.
    await new Promise((resolve) => setImmediate(resolve));
    return indexStatus(body.data.languages);
  });

  app.get('/api/memory/tidy', () => tidy.status());
  app.post('/api/memory/tidy', async () => {
    void tidy.run('now').catch(() => undefined);
    return { ...(await tidy.status()), running: true };
  });
  app.post('/api/memory/tidy/answer', async (request, reply) => {
    const body = TidyAnswerBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    return tidy.answer(body.data.runId, body.data.changeId, body.data.answer);
  });

  app.get<{ Querystring: { fresh?: string } }>('/api/skills/suggestions', async (request) => ({
    suggestions: await suggester.list({ fresh: request.query.fresh === '1' }),
  }));
  app.post('/api/skills/suggestions/dismiss', async (request, reply) => {
    const body = DismissSuggestionBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    await suggester.dismiss(body.data.id, body.data.forever);
    return { ok: true };
  });
}
