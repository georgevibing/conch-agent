import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isUnread, ServerEvent, type ChatFolder, type ConversationSummary } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { hereInit, onThisComputer } from '../test/here';

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const home = await mkdtemp(join(tmpdir(), 'conch-organise-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const folderEvents: ChatFolder[][] = [];
  services.broadcast.on((e: ServerEvent) => {
    if (e.type === 'folders.changed') folderEvents.push(e.folders);
  });
  return { services, home, folderEvents };
}

async function until(services: Services, id: string, status: ConversationSummary['status']) {
  for (let i = 0; i < 300; i++) {
    const { conversation } = await services.conversations.detail(id);
    if (conversation.status === status && (status !== 'idle' || !conversation.titling))
      return conversation;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`never ${status}`);
}

async function chat(services: Services, text = 'hello') {
  const convo = await services.conversations.send({ clientMessageId: `u-${text}`, text });
  return until(services, convo.id, 'idle');
}

const get = async (services: Services, id: string) =>
  (await services.conversations.detail(id)).conversation;

describe('pinning a chat', () => {
  it('pins in the order you pin, moves among the pinned, and unpins', async () => {
    const { services } = await setup();
    const a = await chat(services, 'first');
    const b = await chat(services, 'second');
    await services.conversations.change(a.id, { pinned: true });
    await services.conversations.change(b.id, { pinned: true });
    const pa = (await get(services, a.id)).pinned ?? NaN;
    const pb = (await get(services, b.id)).pinned ?? NaN;
    expect(pa).toBeLessThanOrEqual(pb);

    // Dragged above the first.
    await services.conversations.change(b.id, { pinOrder: pa - 1 });
    expect((await get(services, b.id)).pinned).toBe(pa - 1);
    // A place among the pinned means nothing to a chat that isn't pinned.
    await services.conversations.change(b.id, { pinned: false });
    await services.conversations.change(b.id, { pinOrder: 5 });
    expect((await get(services, b.id)).pinned).toBeUndefined();

    // Kept across a restart.
    expect(
      (await new Services(services.config).conversations.detail(a.id)).conversation.pinned,
    ).toBe(pa);
  });

  it('archiving unpins it but keeps its folder, so it comes back where it was', async () => {
    const { services } = await setup();
    const a = await chat(services);
    const folder = await services.folders.create({ name: 'Work' });
    await services.conversations.change(a.id, { pinned: true, folder: folder.id });
    await services.conversations.change(a.id, { archived: true });
    const archived = await get(services, a.id);
    expect(archived.pinned).toBeUndefined();
    expect(archived.folderId).toBe(folder.id);
    await services.conversations.change(a.id, { archived: false });
    expect((await get(services, a.id)).folderId).toBe(folder.id);
  });
});

describe('folders', () => {
  it('are made, renamed, moved and removed, and say so to every window', async () => {
    const { services, folderEvents } = await setup();
    const work = await services.folders.create({ name: 'Work', glyph: 'briefcase', color: 'blue' });
    const home = await services.folders.create({ name: 'Home' });
    expect(work.id).toMatch(/^f_/);
    expect(home).toMatchObject({ glyph: 'folder', color: 'blue' });
    expect((await services.folders.list()).map((f) => f.name)).toEqual(['Work', 'Home']);

    await services.folders.update(home.id, { order: work.order - 1, name: 'House' });
    expect((await services.folders.list()).map((f) => f.name)).toEqual(['House', 'Work']);
    expect(folderEvents.at(-1)?.map((f) => f.name)).toEqual(['House', 'Work']);

    // Kept across a restart.
    expect((await new Services(services.config).folders.list()).map((f) => f.name)).toEqual([
      'House',
      'Work',
    ]);
  });

  it('removing one puts its chats back in the list, untouched', async () => {
    const { services } = await setup();
    const a = await chat(services);
    const folder = await services.folders.create({ name: 'Trip' });
    await services.conversations.change(a.id, { folder: folder.id, pinned: true });
    await services.conversations.unfile(folder.id);
    await services.folders.remove(folder.id);
    const after = await get(services, a.id);
    expect(after.folderId).toBeUndefined();
    expect(after.pinned).toEqual(expect.any(Number));
    expect(after.title).toBe(a.title);
  });

  it('a damaged folders file is set aside, and the chats keep their place', async () => {
    const { services, home } = await setup();
    await services.folders.create({ name: 'Work' });
    await writeFile(join(home, 'conversations', 'folders.json'), '{not json');
    const fresh = new Services(services.config);
    expect(await fresh.folders.list()).toEqual([]);
    // A good folder survives beside a bad one.
    await writeFile(
      join(home, 'conversations', 'folders.json'),
      JSON.stringify({
        folders: [
          { id: 'f_good1', name: 'Good', glyph: 'leaf', color: 'green', order: 1, createdAt: 1 },
          { id: '../../etc', name: 'Bad' },
        ],
      }),
    );
    expect((await new Services(services.config).folders.list()).map((f) => f.id)).toEqual([
      'f_good1',
    ]);
  });
});

describe('what’s new since you looked', () => {
  it('a chat you started here is seen; a reply you weren’t there for is new until you open it', async () => {
    const { services } = await setup();
    const a = await chat(services);
    // The reply landed after it was started: new, until it's seen.
    expect(isUnread(a)).toBe(true);
    await services.conversations.seen(a.id);
    expect(isUnread(await get(services, a.id))).toBe(false);
  });

  it('a chat from before Conch kept track is never new until something happens in it', async () => {
    const { services, home } = await setup();
    const a = await chat(services);
    // Idle is visible before the final disk write finishes. Stop and flush the
    // old manager before replacing its index with a pre-seenAt fixture.
    await services.conversations.drain();
    const index = join(home, 'conversations', 'index.json');
    const records = JSON.parse(await readFile(index, 'utf8')) as Record<string, unknown>[];
    for (const r of records) delete r.seenAt;
    await writeFile(index, JSON.stringify(records));
    const fresh = new Services(services.config);
    expect(isUnread((await fresh.conversations.detail(a.id)).conversation)).toBe(false);
  });
});

describe('a chat started in a folder', () => {
  it('is filed there from its first moment; a folder that went starts it in the list', async () => {
    const { services } = await setup();
    const app = onThisComputer(await buildApp(services), services);
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const folder = (
        await app.inject({ method: 'POST', url: '/api/folders', payload: { name: 'Trips' } })
      ).json<ChatFolder>();
      const port = (app.server.address() as { port: number }).port;
      const ws = new WebSocket(`ws://localhost:${port}/ws`, hereInit(app));
      const created = new Map<string, ConversationSummary>();
      ws.onmessage = (msg) => {
        const event = ServerEvent.parse(JSON.parse(String(msg.data)));
        if (event.type === 'conversation.created')
          created.set(event.clientMessageId, event.conversation);
      };
      await new Promise((r) => (ws.onopen = r));
      const start = async (clientMessageId: string, extra: Record<string, unknown>) => {
        ws.send(
          JSON.stringify({ type: 'conversation.send', clientMessageId, text: 'Plan it', ...extra }),
        );
        for (let i = 0; i < 300 && !created.has(clientMessageId); i++)
          await new Promise((r) => setTimeout(r, 10));
        const made = created.get(clientMessageId);
        if (!made) throw new Error('never created');
        return made;
      };

      // Announced already in the folder, so no window ever shows it outside first.
      const filed = await start('u-in', { folder: folder.id });
      expect(filed.folderId).toBe(folder.id);
      expect((await until(services, filed.id, 'idle')).folderId).toBe(folder.id);

      // Gone meanwhile: the message isn't lost, the chat just starts in the list.
      const loose = await start('u-gone', { folder: 'f_missing1' });
      expect(loose.folderId).toBeUndefined();

      // Sending on in an existing chat never refiles it.
      await until(services, loose.id, 'idle');
      ws.send(
        JSON.stringify({
          type: 'conversation.send',
          conversationId: loose.id,
          clientMessageId: 'u-again',
          text: 'And again',
          folder: folder.id,
        }),
      );
      await new Promise((r) => setTimeout(r, 50));
      expect((await until(services, loose.id, 'idle')).folderId).toBeUndefined();
      ws.close();
    } finally {
      await app.close();
    }
  });
});

describe('the routes', () => {
  it('PATCH pins, files and marks seen; a folder that isn’t there is refused', async () => {
    const { services } = await setup();
    const app = onThisComputer(await buildApp(services), services);
    const a = await chat(services);
    const folder = (
      await app.inject({ method: 'POST', url: '/api/folders', payload: { name: 'Ideas' } })
    ).json<ChatFolder>();
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/conversations/${a.id}`, payload });

    expect((await patch({ pinned: true, folder: folder.id, seen: true })).statusCode).toBe(200);
    const after = await get(services, a.id);
    expect(after).toMatchObject({ folderId: folder.id, pinned: expect.any(Number) });
    expect(isUnread(after)).toBe(false);

    expect((await patch({ folder: 'f_missing1' })).statusCode).toBe(404);
    expect((await patch({ folder: '../x' })).statusCode).toBe(400);
    expect((await patch({ folder: null })).statusCode).toBe(200);
    expect((await get(services, a.id)).folderId).toBeUndefined();
    await app.close();
  });

  it('bulk changes many chats at once, skips ones already gone, and deletes on request', async () => {
    const { services } = await setup();
    const app = onThisComputer(await buildApp(services), services);
    const a = await chat(services, 'one');
    const b = await chat(services, 'two');
    const bulk = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/conversations/bulk', payload });

    const archived = await bulk({ ids: [a.id, b.id, 'c_gone'], change: { archived: true } });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ done: 2 });
    expect((await services.conversations.list()).every((c) => c.archivedAt)).toBe(true);

    expect((await bulk({ ids: [a.id] })).statusCode).toBe(400);
    expect(
      (await bulk({ ids: [a.id], change: { archived: false }, remove: true })).statusCode,
    ).toBe(400);
    expect((await bulk({ ids: [], remove: true })).statusCode).toBe(400);

    expect((await bulk({ ids: [a.id, b.id], remove: true })).statusCode).toBe(200);
    expect(await services.conversations.list()).toEqual([]);
    await app.close();
  });

  it('folders: list, rename, refuse a bad id, and delete', async () => {
    const { services } = await setup();
    const app = onThisComputer(await buildApp(services), services);
    const made = await app.inject({
      method: 'POST',
      url: '/api/folders',
      payload: { name: 'Reading', glyph: 'book-open', color: 'violet' },
    });
    const folder = made.json<ChatFolder>();
    expect(folder).toMatchObject({ name: 'Reading', glyph: 'book-open', color: 'violet' });
    expect(
      (await app.inject({ method: 'POST', url: '/api/folders', payload: { name: '' } })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/folders',
          payload: { name: 'x', glyph: 'not-a-glyph' },
        })
      ).statusCode,
    ).toBe(400);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/folders/${folder.id}`,
      payload: { name: 'Books' },
    });
    expect(renamed.json()).toMatchObject({ name: 'Books' });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/folders/not-a-folder',
          payload: { name: 'y' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/folders/f_missing1',
          payload: { name: 'y' },
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/folders/${folder.id}` })).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/folders' })).json()).toEqual([]);
    await app.close();
  });
});
