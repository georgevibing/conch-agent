import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DRAFT_LIMITS, DraftList, DraftReply, NEW_CHAT_DRAFT } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { AttachmentStore, UNSENT_MAX_AGE_MS } from '../attachments/store';
import { loadConfig } from '../config';
import { Services } from '../services';
import { onThisComputer } from '../test/here';
import { DraftError, DraftStore } from './store';

const DAY = 24 * 60 * 60 * 1000;

async function stores(chats: string[] = ['c_one', 'c_two']) {
  const home = await mkdtemp(join(tmpdir(), 'conch-drafts-'));
  // The sweep asks the drafts which uploads they hold, as `Services` wires it.
  const wired: { drafts?: DraftStore } = {};
  const attachments = new AttachmentStore(join(home, 'attachments'), {
    drafted: (now) => wired.drafts?.held(now) ?? Promise.resolve(new Set()),
  });
  const heal = vi.fn();
  const drafts = (wired.drafts = new DraftStore(join(home, 'conversations'), {
    attachment: async (id) => (await attachments.get(id))?.attachment,
    exists: async (id) => chats.includes(id),
    heal,
  }));
  const upload = (name = 'note.txt', text = 'hello\n') =>
    attachments.save({ name, bytes: Buffer.from(text) });
  return { home, drafts, attachments, upload, heal };
}

describe('DraftStore', () => {
  it('keeps the words, the files and a new chat’s choices, and reads them back', async () => {
    const { drafts, upload } = await stores();
    const file = await upload();
    const paste = await upload('Pasted text', 'line\n'.repeat(40));
    const put = await drafts.put(NEW_CHAT_DRAFT, {
      text: 'half a thought',
      attachments: [file.id, paste.id],
      options: { permissionMode: 'plan', model: 'mock-large' },
    });
    expect(put.missing).toEqual([]);
    const got = await drafts.get(NEW_CHAT_DRAFT);
    expect(got.draft).toMatchObject({
      text: 'half a thought',
      attachments: [{ id: file.id, name: 'note.txt' }, { id: paste.id }],
      options: { permissionMode: 'plan', model: 'mock-large' },
    });
    expect(DraftReply.safeParse(got).success).toBe(true);
  });

  it('keeps one per chat, and a chat’s choices stay with the chat, not its draft', async () => {
    const { drafts } = await stores();
    await drafts.put('c_one', { text: 'one', options: { model: 'x' } });
    await drafts.put('c_two', { text: 'two' });
    expect((await drafts.get('c_one')).draft).toMatchObject({ text: 'one' });
    expect((await drafts.get('c_one')).draft?.options).toBeUndefined();
    expect((await drafts.get('c_two')).draft?.text).toBe('two');
    expect((await drafts.list()).drafts.map((d) => d.key).sort()).toEqual(['c_one', 'c_two']);
  });

  it('clears a draft that has nothing left in it', async () => {
    const { drafts } = await stores();
    await drafts.put('c_one', { text: 'something' });
    const cleared = await drafts.put('c_one', { text: '   ', attachments: [] });
    expect(cleared.draft).toBeNull();
    expect((await drafts.list()).drafts).toEqual([]);
  });

  it('refuses a draft for a chat that is gone, so a deleted chat’s draft can’t come back', async () => {
    const { drafts } = await stores();
    await expect(drafts.put('c_deleted', { text: 'late' })).rejects.toBeInstanceOf(DraftError);
    expect((await drafts.list()).drafts).toEqual([]);
  });

  it('names an attachment that is no longer here instead of keeping it', async () => {
    const { drafts, attachments, upload } = await stores();
    const kept = await upload();
    const lost = await upload('lost.txt');
    await drafts.put('c_one', { text: 'see these', attachments: [kept.id, lost.id] });
    // Lost behind the draft's back (a hand-deleted folder).
    await attachments.discard(lost.id);
    const got = await drafts.get('c_one');
    expect(got.draft?.attachments.map((a) => a.id)).toEqual([kept.id]);
    expect(got.missing).toEqual([lost.id]);
    // And one that was already gone when the draft was written.
    const put = await drafts.put('c_one', { text: 'again', attachments: [kept.id, 'att_never'] });
    expect(put.missing).toEqual(['att_never']);
    expect(put.draft?.attachments.map((a) => a.id)).toEqual([kept.id]);
  });

  it('holds its uploads through the sweep, and lets them go 30 days after it was last touched', async () => {
    const { drafts, attachments, upload } = await stores();
    const held = await upload('held.txt');
    const loose = await upload('loose.txt');
    const start = Date.now();
    await drafts.put('c_one', { text: 'keep this', attachments: [held.id] }, start);

    // A week later: the unsent upload nobody holds is gone, the draft's is still here.
    expect(await attachments.sweep(start + 7 * DAY)).toBe(1);
    expect(await attachments.get(loose.id)).toBeUndefined();
    expect(await attachments.get(held.id)).toBeDefined();
    expect((await drafts.get('c_one')).draft?.text).toBe('keep this');

    // Untouched for a month: the draft is let go, and its file with it.
    expect(await attachments.sweep(start + DRAFT_LIMITS.maxAgeMs + UNSENT_MAX_AGE_MS)).toBe(1);
    expect(await attachments.get(held.id)).toBeUndefined();
    expect((await drafts.get('c_one')).draft).toBeNull();
  });

  it('remove gives back the uploads only that draft held', async () => {
    const { drafts, upload } = await stores();
    const mine = await upload('mine.txt');
    const shared = await upload('shared.txt');
    await drafts.put('c_one', { text: 'a', attachments: [mine.id, shared.id] });
    await drafts.put('c_two', { text: 'b', attachments: [shared.id] });
    expect(await drafts.remove('c_one')).toEqual([mine.id]);
    expect((await drafts.get('c_one')).draft).toBeNull();
  });

  it('survives a restart: a new store reads what the last one wrote', async () => {
    const { home, drafts } = await stores();
    await drafts.put('c_one', { text: 'still here' });
    const again = new DraftStore(join(home, 'conversations'), {
      attachment: async () => undefined,
      exists: async () => true,
    });
    expect((await again.get('c_one')).draft?.text).toBe('still here');
  });

  it('heals a damaged file, keeping the drafts that still read', async () => {
    const { home, heal } = await stores();
    const path = join(home, 'conversations', 'drafts.json');
    await mkdir(join(home, 'conversations'), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        drafts: { c_one: { text: 'fine', attachments: [], updatedAt: 1 }, 'bad key!': 7 },
      }),
    );
    const again = new DraftStore(join(home, 'conversations'), {
      attachment: async () => undefined,
      exists: async () => true,
      heal,
    });
    expect((await again.get('c_one')).draft?.text).toBe('fine');
    await again.put('c_one', { text: 'fine still' });
    expect(JSON.parse(await readFile(path, 'utf8')).drafts['bad key!']).toBeUndefined();
  });

  it('sweeps nothing when it can’t tell what drafts hold', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-drafts-'));
    const attachments = new AttachmentStore(join(home, 'attachments'), {
      drafted: () => Promise.reject(new Error('unreadable')),
    });
    const old = await attachments.save({ name: 'a.txt', bytes: Buffer.from('a') });
    expect(await attachments.sweep(Date.now() + 2 * DAY)).toBe(0);
    expect(await attachments.get(old.id)).toBeDefined();
  });
});

// ── The routes, on the gateway ─────────────────────────────────────────────

async function gateway() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const home = await mkdtemp(join(tmpdir(), 'conch-drafts-app-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
  });
  const services = new Services(config);
  const app = onThisComputer(await buildApp(services), services);
  return { app, services };
}

/** A chat with one reply in it. */
async function aChat(services: Services) {
  const done = new Promise<void>((resolve) => {
    services.conversations.events.on((event) => {
      if (event.type === 'conversation.event' && event.event.type === 'turn.completed') resolve();
    });
  });
  const convo = await services.conversations.send({ clientMessageId: 'u1', text: 'hello' });
  await done;
  return convo;
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('draft routes', () => {
  it('PUT and GET a chat’s draft, list it, and clear it on an empty PUT', async () => {
    const { app, services } = await gateway();
    close = () => app.close();
    const { id } = await aChat(services);
    const upload = (
      await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: { 'content-type': 'application/octet-stream', 'x-conch-name': 'a.txt' },
        payload: Buffer.from('some text'),
      })
    ).json().attachment as { id: string };

    const put = await app.inject({
      method: 'PUT',
      url: `/api/conversations/${id}/draft`,
      payload: { text: 'unsent', attachments: [upload.id, 'att_gone'] },
    });
    expect(put.statusCode).toBe(200);
    expect(DraftReply.parse(put.json())).toMatchObject({
      draft: { text: 'unsent', attachments: [{ id: upload.id, name: 'a.txt' }] },
      missing: ['att_gone'],
    });

    const got = DraftReply.parse((await app.inject(`/api/conversations/${id}/draft`)).json());
    expect(got.draft?.text).toBe('unsent');
    const list = DraftList.parse((await app.inject('/api/drafts')).json());
    expect(list.drafts.map((d) => d.key)).toEqual([id]);

    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/conversations/${id}/draft`,
      payload: { text: '' },
    });
    expect(cleared.json()).toEqual({ draft: null, missing: [] });
    expect(DraftList.parse((await app.inject('/api/drafts')).json()).drafts).toEqual([]);
  });

  it('refuses what isn’t a draft, and a chat that doesn’t exist', async () => {
    const { app } = await gateway();
    close = () => app.close();
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/conversations/${NEW_CHAT_DRAFT}/draft`,
      payload: { text: 'x'.repeat(DRAFT_LIMITS.maxText + 1) },
    });
    expect(bad.statusCode).toBe(400);
    const odd = await app.inject({
      method: 'PUT',
      url: `/api/conversations/${NEW_CHAT_DRAFT}/draft`,
      payload: { text: 'x', sneaky: true },
    });
    expect(odd.statusCode).toBe(400);
    const gone = await app.inject({
      method: 'PUT',
      url: '/api/conversations/c_nobody/draft',
      payload: { text: 'x' },
    });
    expect(gone.statusCode).toBe(404);
    const weird = await app.inject('/api/conversations/not%20an%20id/draft');
    expect(weird.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('is behind the sign-in, like the rest of /api', async () => {
    const { app } = await gateway();
    close = () => app.close();
    const remote = await app.inject({
      method: 'GET',
      url: '/api/drafts',
      remoteAddress: '192.168.1.20',
    });
    expect(remote.statusCode).toBe(401);
  });

  it('a deleted chat takes its draft with it, and lets its files go', async () => {
    const { app, services } = await gateway();
    close = () => app.close();
    const convo = await aChat(services);
    const file = await services.attachments.save({ name: 'b.txt', bytes: Buffer.from('b') });
    await services.drafts.put(convo.id, { text: 'next', attachments: [file.id] });

    const deleted = new Promise<void>((resolve) => {
      services.conversations.events.on((event) => {
        if (event.type === 'conversation.deleted') setTimeout(resolve, 50);
      });
    });
    await app.inject({ method: 'DELETE', url: `/api/conversations/${convo.id}` });
    await deleted;
    await vi.waitFor(async () => {
      expect((await services.drafts.get(convo.id)).draft).toBeNull();
      expect(await services.attachments.get(file.id)).toBeUndefined();
    });
  });
});
