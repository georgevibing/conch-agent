import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationSummary, ServerEvent } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { onThisComputer } from '../test/here';
import { askFirst } from '../test/modes';
import { loadConfig } from '../config';
import { Services } from '../services';

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const home = await mkdtemp(join(tmpdir(), 'conch-archive-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const updates: ConversationSummary[] = [];
  services.conversations.events.on((e: ServerEvent) => {
    if (e.type === 'conversation.updated') updates.push(e.conversation);
  });
  return { services, updates };
}

/** The conversation once it's `status` — and, when idle, done naming itself too. */
async function until(services: Services, id: string, status: ConversationSummary['status']) {
  for (let i = 0; i < 300; i++) {
    const { conversation } = await services.conversations.detail(id);
    if (conversation.status === status && (status !== 'idle' || !conversation.titling))
      return conversation;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`never ${status}`);
}

describe('archiving a chat', () => {
  it('puts it away and back, says so, and remembers it after a restart', async () => {
    const { services, updates } = await setup();
    const convo = await services.conversations.send({ clientMessageId: 'u1', text: 'hello' });
    await until(services, convo.id, 'idle');

    await services.conversations.archive(convo.id, true);
    const archived = (await services.conversations.list()).find((c) => c.id === convo.id);
    expect(archived?.archivedAt).toEqual(expect.any(Number));
    expect(updates.at(-1)).toMatchObject({ id: convo.id, archivedAt: archived?.archivedAt });

    // Archiving again keeps the moment it was first put away.
    await services.conversations.archive(convo.id, true);
    expect((await services.conversations.detail(convo.id)).conversation.archivedAt).toBe(
      archived?.archivedAt,
    );

    const fresh = new Services(services.config);
    expect((await fresh.conversations.detail(convo.id)).conversation.archivedAt).toBe(
      archived?.archivedAt,
    );

    await fresh.conversations.archive(convo.id, false);
    expect((await fresh.conversations.detail(convo.id)).conversation.archivedAt).toBeUndefined();
    expect((await new Services(services.config).conversations.list())[0]?.archivedAt).toBe(
      undefined,
    );
  });

  it('comes back to the list when you write in it', async () => {
    const { services, updates } = await setup();
    const convo = await services.conversations.send({ clientMessageId: 'u1', text: 'hello' });
    await until(services, convo.id, 'idle');
    await services.conversations.archive(convo.id, true);

    await services.conversations.send({
      conversationId: convo.id,
      clientMessageId: 'u2',
      text: 'one more thing',
    });
    expect((await services.conversations.detail(convo.id)).conversation.archivedAt).toBeUndefined();
    expect(updates.at(-1)?.archivedAt).toBeUndefined();
    await until(services, convo.id, 'idle');
    expect((await new Services(services.config).conversations.list())[0]?.archivedAt).toBe(
      undefined,
    );
  });

  it('keeps working while archived, and comes back when it needs you', async () => {
    const { services } = await setup();
    await askFirst(services);
    const convo = await services.conversations.send({ clientMessageId: 'u1', text: 'list files' });
    await services.conversations.archive(convo.id, true);
    expect((await services.conversations.detail(convo.id)).conversation.archivedAt).toEqual(
      expect.any(Number),
    );

    const asking = await until(services, convo.id, 'awaiting-permission');
    expect(asking.archivedAt).toBeUndefined();
  });

  it('a finished turn leaves an archived chat where you put it', async () => {
    const { services } = await setup();
    const convo = await services.conversations.send({ clientMessageId: 'u1', text: 'hello' });
    await services.conversations.archive(convo.id, true);
    const done = await until(services, convo.id, 'idle');
    expect(done.archivedAt).toEqual(expect.any(Number));
  });
});

describe('PATCH /api/conversations/:id', () => {
  it('renames, archives and puts back, and refuses an empty change', async () => {
    const { services } = await setup();
    const app = onThisComputer(await buildApp(services), services);
    const convo = await services.conversations.send({ clientMessageId: 'u1', text: 'hello' });
    await until(services, convo.id, 'idle');
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/conversations/${convo.id}`, payload });

    expect((await patch({ archived: true })).statusCode).toBe(200);
    expect((await services.conversations.detail(convo.id)).conversation.archivedAt).toEqual(
      expect.any(Number),
    );

    expect((await patch({ title: 'Kept for later', archived: false })).statusCode).toBe(200);
    const after = (await services.conversations.detail(convo.id)).conversation;
    expect(after).toMatchObject({ title: 'Kept for later' });
    expect(after.archivedAt).toBeUndefined();

    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ archived: 'yes' })).statusCode).toBe(400);
    expect((await patch({ pinned: 'yes' })).statusCode).toBe(400);
    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/conversations/c_nope',
      payload: { archived: true },
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
