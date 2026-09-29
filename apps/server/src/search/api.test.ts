import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SearchPreview, SearchResults } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';

async function setup(home?: string) {
  process.env.CONCH_MOCK_SPEED = '0.05';
  const dir = home ?? (await mkdtemp(join(tmpdir(), 'conch-search-')));
  const services = new Services(
    loadConfig({
      CONCH_HOME: dir,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  return { services, app: await buildApp(services), home: dir };
}

function sendAndWait(services: Services, text: string, conversationId?: string) {
  return new Promise<string>((resolve) => {
    const off = services.broadcast.on((event) => {
      if (event.type === 'conversation.event' && event.event.type === 'turn.completed') {
        off();
        resolve(event.event.conversationId);
      }
    });
    void services.conversations.send({
      conversationId,
      clientMessageId: `m${Math.random()}`,
      text,
    });
  });
}

describe('search API', () => {
  it('indexes turns as they happen and serves results and previews', async () => {
    const { services, app } = await setup();
    const id = await sendAndWait(services, 'Tell me about the Voyager golden record');
    await services.search?.indexer.settled();

    const res = await app.inject('/api/search?q=golden%20recor');
    expect(res.statusCode).toBe(200);
    const results = SearchResults.parse(res.json());
    expect(results.groups[0]).toMatchObject({ conversationId: id });
    const hit = results.groups[0]?.hits[0];
    expect(hit?.role).toBe('user');

    const preview = SearchPreview.parse(
      (
        await app.inject(`/api/search/preview?conversationId=${id}&anchor=${hit?.anchor}&q=golden`)
      ).json(),
    );
    expect(preview.messages.some((m) => m.focus && m.ranges.length > 0)).toBe(true);

    expect((await app.inject('/api/search?q=ab')).json()).toMatchObject({ mode: 'short' });
    expect((await app.inject('/api/search?limit=0')).statusCode).toBe(400);

    await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${id}`,
      payload: { title: 'Space' },
    });
    await services.search?.indexer.settled();
    const renamed = SearchResults.parse((await app.inject('/api/search?q=voyager')).json());
    expect(renamed.groups[0]?.title).toBe('Space');

    await app.inject({ method: 'DELETE', url: `/api/conversations/${id}` });
    await services.search?.indexer.settled();
    expect(SearchResults.parse((await app.inject('/api/search?q=voyager')).json()).groups).toEqual(
      [],
    );
    await app.close();
  });

  it('catches up on conversations from before the index existed', async () => {
    const first = await setup();
    await sendAndWait(first.services, 'An old chat about marmalade');
    await first.app.close();
    first.services.search?.index.close();
    const { rm } = await import('node:fs/promises');
    await rm(join(first.home, 'search.db'), { force: true });

    const second = await setup(first.home);
    const results = SearchResults.parse(
      (await second.app.inject('/api/search?q=marmalade')).json(),
    );
    expect(results.groups).toHaveLength(1);
    await second.app.close();
  });
});
