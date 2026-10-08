import { mkdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ChatImportStatus, ContinuePastChatResult, PastChatDetail } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app';
import { loadConfig } from '../../config';
import { Services } from '../../services';
import { onThisComputer } from '../../test/here';
import { CLAUDE_SESSION, claudeHome, PASTED_KEY } from './fixtures';
import { pastChatId } from './store';

const PASSWORD = 'a long enough sentence for conch';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'conch-pastchats-app-'));
  const source = join(root, 'home');
  mkdirSync(source);
  claudeHome(source);
  const services = new Services(
    loadConfig({
      CONCH_HOME: join(root, 'conch'),
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
      CONCH_IMPORT_HOME: source,
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  await app.ready();
  close = async () => {
    services.integrations.stop();
    await services.mockVendor?.stop();
    await app.close();
  };
  const signedIn = await app.inject({
    method: 'PUT',
    url: '/api/access/password',
    payload: { username: 'ada', password: PASSWORD },
  });
  const cookie = String([signedIn.headers['set-cookie']].flat()[0]).split(';')[0] ?? '';
  return { app, services, cookie };
}

describe('past chats over HTTP', () => {
  it('finds, brings in, searches, reads and carries on a past chat, never a secret', async () => {
    const { app, services, cookie } = await setup();
    const status = ChatImportStatus.parse(
      (await app.inject({ url: '/api/import/chats', headers: { cookie } })).json(),
    );
    expect(status.sources).toEqual([
      expect.objectContaining({ id: 'claude-code', found: 2, fresh: 2 }),
    ]);

    const started = await app.inject({
      method: 'POST',
      url: '/api/import/chats',
      headers: { cookie },
      payload: {},
    });
    expect(started.statusCode).toBe(202);
    await vi.waitUntil(async () => !(await services.chatImports.status()).running, {
      timeout: 5000,
    });
    await services.search.settled();

    // Search finds it like any chat, with where it was from.
    const results = await app.inject({ url: '/api/search?q=lock%20up', headers: { cookie } });
    const id = pastChatId('claude-code', CLAUDE_SESSION);
    expect(results.json().groups[0].conversationId).toBe(id);

    const read = await app.inject({ url: `/api/past-chats/${id}`, headers: { cookie } });
    expect(read.body).not.toContain(PASTED_KEY.slice(10));
    expect(PastChatDetail.parse(read.json()).chat.title).toBe('Checkout double charge');

    const carried = ContinuePastChatResult.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/past-chats/${id}/continue`,
          headers: { cookie },
          payload: {},
        })
      ).json(),
    );
    const { conversation, events } = await services.conversations.detail(carried.conversationId);
    expect(conversation.title).toBe('Checkout double charge');
    // Read from outside: anything risky asks first, and nothing it said is learned from.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'taint', source: { kind: 'app', label: 'Claude Code' } }),
    );
    expect(events.filter((e) => e.type === 'user.message')).toHaveLength(1);
    const learned = await services.learning.store.chat(carried.conversationId);
    expect(learned.reviewed).toBe(events.at(-1)?.seq);

    // Taking them out needs a recent password: just signed in, it has one.
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/import/chats',
      headers: { cookie },
    });
    expect(removed.json()).toEqual({ removed: 1 });
    // The chat carried on here stays.
    await expect(services.conversations.detail(carried.conversationId)).resolves.toBeTruthy();
    await expect(
      app.inject({ url: '/api/past-chats/nope', headers: { cookie } }),
    ).resolves.toMatchObject({
      statusCode: 404,
    });
  });

  it('is what the assistant finds when it looks through earlier chats', async () => {
    const { services } = await setup();
    await services.chatImports.start();
    await services.search.settled();
    const results = await services.search.search('double', { limit: 5 });
    if (results === 'unavailable') throw new Error('search unavailable');
    expect(results.groups[0]?.title).toBe('Checkout double charge');
  });
});
