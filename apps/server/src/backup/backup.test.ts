/**
 * Back up and restore, end to end through the gateway: a Conch in use is
 * backed up with its keys, restored into a fresh home on “another computer”,
 * and everything comes back — then Undo puts the fresh one back. Plus the
 * automatic backups, what's kept, the Repair everything check, and the
 * routes' guards.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cookieOf, gateway, PASSWORD, useConch, type Gateway } from '../test/session';
import { BackupError } from './archive';
import { backupCheck, OVERDUE_MS } from './doctor';
import { applyPendingRestore, applyPlan, mergeUsage, Plan, stagingDir } from './restore';
import { dayOf, retain, retainUndo, weekOf } from './retention';
import { BackupService, IDLE_MS } from './service';

vi.setConfig({ testTimeout: 90_000 });

const PASSPHRASE = 'seven lemons sail past the harbour';
const DAY = 24 * 60 * 60 * 1000;

const opened: Gateway[] = [];
async function open(home?: string) {
  const g = await gateway(home);
  opened.push(g);
  return g;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const g of opened.splice(0)) await g.app.close();
});

type App = Gateway['app'];
const json = (res: { body: string }) => JSON.parse(res.body) as Record<string, unknown>;

async function download(app: App, id: string, cookie?: string): Promise<Buffer> {
  const res = await app.inject({
    url: `/api/backups/${id}/download`,
    headers: cookie ? { cookie } : {},
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-disposition']).toMatch(
    /attachment; filename="Conch backup \d{4}-\d\d-\d\d\.conchbackup"/,
  );
  return res.rawPayload;
}

async function upload(app: App, bytes: Buffer, cookie?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/backups/upload',
    headers: { 'content-type': 'application/octet-stream', ...(cookie && { cookie }) },
    payload: bytes,
  });
}

/** Close a gateway, finish its restore as a start would, and open it again. */
async function restart(g: Gateway) {
  await g.app.close();
  opened.splice(opened.indexOf(g), 1);
  const applied = await applyPendingRestore(g.home);
  return { applied, g: await open(g.home) };
}

async function signIn(app: App) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    payload: { with: 'password', username: 'ada', password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}

describe('back up, restore on another computer, undo', () => {
  it('brings everything back, keys and sign-in included, and Undo puts it back', async () => {
    const a = await open();
    const made = await useConch(a);
    const cookie = made.cookie;

    const created = await a.app.inject({
      method: 'POST',
      url: '/api/backups',
      headers: { cookie },
      payload: { chats: true, passphrase: PASSPHRASE },
    });
    expect(created.statusCode).toBe(200);
    expect(json(created)).toMatchObject({
      name: expect.stringMatching(/^Conch backup .*\.conchbackup$/),
    });
    const file = await download(a.app, String(json(created).id), cookie);

    // Another computer: a fresh Conch.
    let b = await open();
    await b.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { profile: { name: 'Fresh' } },
    });
    await b.services.memory.add({ content: 'Only on the new computer.', source: 'user' });
    const uploaded = await upload(b.app, file);
    expect(uploaded.statusCode).toBe(200);
    const preview = json(uploaded);
    expect(preview).toMatchObject({
      kind: 'uploaded',
      downloadable: false,
      contents: {
        settings: true,
        memories: 1,
        commands: expect.any(Number),
        routines: 1,
        skills: 2,
        integrations: 1,
        integrationsSigningIn: 1,
        chats: expect.any(Number),
        attachments: 1,
        secrets: 'passphrase',
      },
    });

    const wrong = await b.app.inject({
      method: 'POST',
      url: `/api/backups/${String(preview.id)}/restore`,
      payload: { passphrase: 'not the right one, sorry' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(json(wrong)).toMatchObject({ error: 'wrong-passphrase' });
    const needs = await b.app.inject({
      method: 'POST',
      url: `/api/backups/${String(preview.id)}/restore`,
      payload: {},
    });
    expect(json(needs)).toMatchObject({ error: 'needs-passphrase' });
    // Nothing was touched by the refusals.
    expect((await b.services.memory.list()).map((m) => m.content)).toEqual([
      'Only on the new computer.',
    ]);

    const restored = await b.app.inject({
      method: 'POST',
      url: `/api/backups/${String(preview.id)}/restore`,
      payload: { passphrase: PASSPHRASE },
    });
    expect(restored.statusCode).toBe(200);
    // Not running under `pnpm start` here, so it says to restart.
    expect(json(restored)).toMatchObject({
      restarting: false,
      message: expect.stringContaining('Restart Conch'),
    });
    expect(json(await b.app.inject('/api/backups'))).toMatchObject({
      pending: { kind: 'uploaded' },
    });
    // Until Conch starts again, nothing has changed.
    expect((await b.services.memory.list()).map((m) => m.content)).toEqual([
      'Only on the new computer.',
    ]);

    const again = await restart(b);
    expect(again.applied.kind).toBe('applied');
    b = again.g;
    // Sign-in came back: the password from the backup opens it.
    expect((await b.app.inject('/api/state')).statusCode).toBe(401);
    const bCookie = await signIn(b.app);
    const state = json(await b.app.inject({ url: '/api/state', headers: { cookie: bCookie } }));
    expect(state).toMatchObject({ persona: { name: 'Shelly' }, profile: { name: 'Ada' } });
    expect((await b.services.memory.list()).map((m) => m.content)).toEqual([
      'Ada takes her tea with lemon.',
    ]);
    expect((await b.services.routines.list()).map((r) => r.title)).toEqual(['Morning briefing']);
    expect((await b.services.commands.list()).map((c) => c.name)).toContain('standup');
    expect((await b.services.skills.list()).skills.map((s) => s.id)).toContain(
      'summarise-invoices',
    );
    const [integration] = await b.services.integrations.store.all();
    expect(integration).toMatchObject({ catalogId: 'github' });
    expect(await b.services.integrations.store.secrets(integration?.id ?? '')).toMatchObject({
      values: { token: expect.stringMatching(/^github_pat_/) },
    });
    expect(await b.services.settings.providerSecret('openrouter')).toMatchObject({
      value: 'sk-or-v1-0123456789abcdef',
    });
    const convo = await b.services.conversations.detail(made.conversationId);
    expect(convo.events.some((e) => e.type === 'user.message' && e.attachments?.length === 1)).toBe(
      true,
    );
    const [attached] = convo.events.flatMap((e) =>
      e.type === 'user.message' ? (e.attachments ?? []) : [],
    );
    expect(await b.services.attachments.bytes(attached?.id ?? '')).toBeDefined();
    expect((await b.services.usage.snapshot()).spend?.budget).toBe(25);
    // The search index was rebuilt from the chats that came back.
    await vi.waitFor(async () => {
      const found = json(
        await b.app.inject({ url: '/api/search?q=weather', headers: { cookie: bCookie } }),
      );
      expect(JSON.stringify(found)).toContain('weather');
    });

    // It says what happened, and offers Undo.
    const status = json(await b.app.inject({ url: '/api/backups', headers: { cookie: bCookie } }));
    expect(status).toMatchObject({
      restored: { from: { kind: 'uploaded' }, undoId: expect.stringMatching(/^undo-/) },
    });
    expect(status.pending).toBeUndefined();
    const undoId = String((status.restored as { undoId: string }).undoId);
    const undoCopy = (status.backups as { id: string; kind: string; downloadable: boolean }[]).find(
      (x) => x.id === undoId,
    );
    expect(undoCopy).toMatchObject({ kind: 'before-restore', downloadable: false });
    expect(
      (await b.app.inject({ url: `/api/backups/${undoId}/download`, headers: { cookie: bCookie } }))
        .statusCode,
    ).toBe(404);

    const undo = await b.app.inject({
      method: 'POST',
      url: `/api/backups/${undoId}/restore`,
      headers: { cookie: bCookie },
      payload: {},
    });
    expect(undo.statusCode).toBe(200);
    const undone = await restart(b);
    b = undone.g;
    // The fresh computer's own things are back, and it has no sign-in again.
    expect((await b.app.inject('/api/state')).statusCode).toBe(200);
    expect((await b.services.memory.list()).map((m) => m.content)).toEqual([
      'Only on the new computer.',
    ]);
    expect(json(await b.app.inject('/api/state'))).toMatchObject({ profile: { name: 'Fresh' } });
    expect(await b.services.routines.list()).toEqual([]);
    expect(await b.services.settings.providerSecret('openrouter')).toBeUndefined();
    await expect(b.services.conversations.detail(made.conversationId)).rejects.toThrow();
  });

  it('restores without the keys when asked, and keeps this computer’s own', async () => {
    const a = await open();
    await useConch(a);
    const [daily] = await a.services.backups.list();
    const file = await readFile(a.services.backups.pathOf(daily?.id ?? ''));

    let b = await open();
    await b.services.settings.setProviderSecret('anthropic-api', {
      source: 'conch',
      value: 'sk-ant-mine',
      savedAt: 1,
    });
    const preview = json(await upload(b.app, file));
    expect(preview.contents).toMatchObject({ integrationsSigningIn: 1 });
    expect((preview.contents as { secrets?: string }).secrets).toBeUndefined();
    expect(
      (
        await b.app.inject({
          method: 'POST',
          url: `/api/backups/${String(preview.id)}/restore`,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    b = (await restart(b)).g;
    // No sign-in in that backup: this computer stays open, its key stays.
    expect((await b.app.inject('/api/state')).statusCode).toBe(200);
    expect(await b.services.settings.providerSecret('anthropic-api')).toMatchObject({
      value: 'sk-ant-mine',
    });
    expect(await b.services.settings.providerSecret('openrouter')).toBeUndefined();
    expect((await b.services.memory.list()).map((m) => m.content)).toEqual([
      'Ada takes her tea with lemon.',
    ]);
    // The integration is back, and asks to be signed in to again.
    const [integration] = await b.services.integrations.store.all();
    expect(integration?.catalogId).toBe('github');
    expect((await b.services.integrations.store.secrets(integration?.id ?? '')).values).toEqual({});
  });

  it('keeps the device restoring signed in, and signs the others out', async () => {
    const a = await open();
    const { cookie } = await useConch(a);
    const phone = await signIn(a.app);
    const made = json(
      await a.app.inject({
        method: 'POST',
        url: '/api/backups',
        headers: { cookie },
        payload: { chats: false, passphrase: PASSPHRASE },
      }),
    );
    const restored = await a.app.inject({
      method: 'POST',
      url: `/api/backups/${String(made.id)}/restore`,
      headers: { cookie },
      payload: { passphrase: PASSPHRASE },
    });
    expect(restored.statusCode).toBe(200);
    const b = (await restart(a)).g;
    expect((await b.app.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(200);
    expect((await b.app.inject({ url: '/api/state', headers: { cookie: phone } })).statusCode).toBe(
      401,
    );
    // A backup without chats left the chats alone.
    expect((await b.services.conversations.list()).length).toBeGreaterThan(0);
  });
});

describe('guards', () => {
  it('needs a recent sign-in to restore, or to take keys out', async () => {
    const g = await open();
    const { cookie } = await useConch(g);
    const [daily] = await g.services.backups.list();
    const later = Date.now() + 11 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const restore = await g.app.inject({
      method: 'POST',
      url: `/api/backups/${daily?.id ?? ''}/restore`,
      headers: { cookie },
      payload: {},
    });
    expect(restore.statusCode).toBe(403);
    expect(json(restore).error).toBe('verify-required');
    const keys = await g.app.inject({
      method: 'POST',
      url: '/api/backups',
      headers: { cookie },
      payload: { chats: false, passphrase: PASSPHRASE },
    });
    expect(keys.statusCode).toBe(403);
    // A backup without keys is no more than what you can already read.
    const plain = await g.app.inject({
      method: 'POST',
      url: '/api/backups',
      headers: { cookie },
      payload: { chats: false },
    });
    expect(plain.statusCode).toBe(200);
    // Nobody signed in gets nothing at all.
    expect((await g.app.inject('/api/backups')).statusCode).toBe(401);
    expect(
      (await g.app.inject({ url: `/api/backups/${daily?.id ?? ''}/download` })).statusCode,
    ).toBe(401);
    expect((await upload(g.app, Buffer.from('x'))).statusCode).toBe(401);
  });

  it('refuses a weak passphrase, a file that isn’t a backup, one too big, and odd ids', async () => {
    const g = await open();
    const weak = await g.app.inject({
      method: 'POST',
      url: '/api/backups',
      payload: { passphrase: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    expect(json(weak).error).toBe('weak-passphrase');

    const junk = await upload(g.app, Buffer.from('not a backup at all'));
    expect(junk.statusCode).toBe(400);
    expect(json(junk)).toMatchObject({
      error: 'not-backup',
      message: 'That file isn’t a Conch backup.',
    });
    expect((await readdir(g.services.backups.dir)).filter((n) => n.startsWith('upload-'))).toEqual(
      [],
    );

    const huge = await g.app.inject({
      method: 'POST',
      url: '/api/backups/upload',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(3 * 1024 ** 3),
      },
      payload: Buffer.from('x'),
    });
    expect(huge.statusCode).toBe(413);
    await expect(
      g.services.backups.receive(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), {
        maxBytes: 1000,
      }),
    ).rejects.toMatchObject({ code: 'too-big' });

    const json400 = await g.app.inject({
      method: 'POST',
      url: '/api/backups/upload',
      payload: { a: 1 },
    });
    expect(json400.statusCode).toBe(415);
    for (const id of ['..%2F..%2Fsettings', 'auto-1.x', 'nope'])
      expect([404, 400]).toContain((await g.app.inject(`/api/backups/${id}`)).statusCode);
  });

  it('refuses an upload the disk can’t hold with a gigabyte to spare, before and while it arrives', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-backup-space-'));
    let free = 1.5 * 1024 ** 3;
    const backups = new BackupService({
      home,
      conchVersion: '0.0.0-test',
      busy: () => false,
      lastActivity: () => 0,
      emit: () => undefined,
      freeBytes: async () => free,
    });
    const refused = { code: 'no-space', message: expect.stringMatching(/enough free space/) };
    // 600 MB said, 1.5 GB free: not a gigabyte to spare. Nothing is read or written.
    let pulled = 0;
    const body = (async function* () {
      pulled++;
      yield Buffer.alloc(10);
    })();
    await expect(backups.receive(body, { size: 600 * 1024 ** 2 })).rejects.toMatchObject(refused);
    expect(pulled).toBe(0);
    // A file that says nothing about its size is cut off once it passes the room there is.
    free = 1024 ** 3 + 1000;
    await expect(
      backups.receive(Readable.from([Buffer.alloc(600), Buffer.alloc(600)])),
    ).rejects.toMatchObject(refused);
    expect(await readdir(backups.dir)).toEqual([]);
    await rm(home, { recursive: true, force: true });
  });

  it('passes the size an upload says it is on to the space check', async () => {
    const g = await open();
    const receive = vi
      .spyOn(g.services.backups, 'receive')
      .mockRejectedValue(new BackupError('no-space', 'There isn’t enough free space.'));
    const res = await upload(g.app, Buffer.from('x'.repeat(2048)));
    expect(res.statusCode).toBe(507);
    expect(json(res).error).toBe('no-space');
    expect(receive).toHaveBeenCalledWith(expect.anything(), { size: 2048 });
  });

  it('won’t restore while a chat is working, and leaves everything as it was', async () => {
    const g = await open();
    await g.services.backups.backupNow();
    const [daily] = await g.services.backups.list();
    vi.spyOn(g.services.conversations, 'busy').mockReturnValue(true);
    const res = await g.app.inject({
      method: 'POST',
      url: `/api/backups/${daily?.id ?? ''}/restore`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).message).toMatch(/chat is still working/);
    expect(json(await g.app.inject('/api/backups')).pending).toBeUndefined();
  });

  it('refuses a damaged upload and stages nothing', async () => {
    const g = await open();
    await g.services.backups.backupNow();
    const [daily] = await g.services.backups.list();
    const bytes = await readFile(g.services.backups.pathOf(daily?.id ?? ''));
    const cut = bytes.subarray(0, bytes.length - 40);
    const uploaded = await upload(g.app, cut);
    // The header still reads, so it's offered; the full check at restore catches it.
    expect(uploaded.statusCode).toBe(200);
    const res = await g.app.inject({
      method: 'POST',
      url: `/api/backups/${String(json(uploaded).id)}/restore`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toBe('damaged');
    expect(json(await g.app.inject('/api/backups')).pending).toBeUndefined();
    await expect(readdir(stagingDir(g.home))).rejects.toThrow();
  });
});

describe('finishing a restore at start', () => {
  it('finishes one cut short, with the same result', async () => {
    const a = await open();
    await useConch(a);
    await a.services.memory.add({ content: 'Added after the backup.', source: 'user' });
    const [daily] = await a.services.backups.list();
    await a.services.backups.restore(daily?.id ?? '');
    const plan = Plan.parse(
      JSON.parse(await readFile(join(stagingDir(a.home), 'plan.json'), 'utf8')),
    );
    await a.app.close();
    opened.splice(opened.indexOf(a), 1);
    // A first go that stops before clearing up, as a power cut would.
    await applyPlan(a.home, plan);
    expect((await applyPendingRestore(a.home)).kind).toBe('applied');
    const b = await open(a.home);
    expect((await b.services.memory.list()).map((m) => m.content)).toEqual([
      'Ada takes her tea with lemon.',
    ]);
  });

  it('makes the Undo copy again at start, with what changed while it waited', async () => {
    const a = await open();
    await useConch(a);
    const [daily] = await a.services.backups.list();
    await a.services.backups.restore(daily?.id ?? '');
    // Conch keeps running until someone restarts it; meanwhile, a new memory.
    await a.services.memory.add({ content: 'Added while the restore waited.', source: 'user' });
    const plan = Plan.parse(
      JSON.parse(await readFile(join(stagingDir(a.home), 'plan.json'), 'utf8')),
    );
    const b = (await restart(a)).g;
    expect((await b.services.memory.list()).map((m) => m.content)).toEqual([
      'Ada takes her tea with lemon.',
    ]);
    const undone = await b.services.backups.restore(plan.undoId ?? '');
    expect(undone.kind).toBe('before-restore');
    const c = (await restart(b)).g;
    expect((await c.services.memory.list()).map((m) => m.content).sort()).toEqual(
      ['Added while the restore waited.', 'Ada takes her tea with lemon.'].sort(),
    );
  });

  it('clears a staging folder that never got its plan, and does nothing else', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-stage-'));
    await writeFile(join(home, 'settings.json'), '{}');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(stagingDir(home), 'files'), { recursive: true });
    expect((await applyPendingRestore(home)).kind).toBe('none');
    await expect(readdir(stagingDir(home))).rejects.toThrow();
    expect(await readFile(join(home, 'settings.json'), 'utf8')).toBe('{}');
  });

  it('never lowers what was spent, and brings the budget back', () => {
    const merged = JSON.parse(
      mergeUsage(
        Buffer.from(JSON.stringify({ days: { '2026-09-29': 3, '2026-09-30': 1 } })),
        Buffer.from(JSON.stringify({ budget: 20, days: { '2026-09-28': 2, '2026-09-29': 1 } })),
      ).toString(),
    );
    expect(merged).toEqual({
      version: 1,
      budget: 20,
      days: { '2026-09-28': 2, '2026-09-29': 3, '2026-09-30': 1 },
    });
  });
});

describe('automatic backups', () => {
  async function service(
    home: string,
    over: Partial<ConstructorParameters<typeof BackupService>[0]> = {},
  ) {
    let now = Date.parse('2026-09-30T03:12:00');
    const clock = { set: (at: number) => (now = at), get: () => now };
    const s = new BackupService({
      home,
      conchVersion: '0.2.0',
      busy: () => false,
      lastActivity: () => 0,
      emit: () => undefined,
      now: () => now,
      ...over,
    });
    return { s, clock };
  }

  it('backs up once a day, only when nothing is busy, and not when off', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-auto-'));
    await writeFile(join(home, 'settings.json'), '{}');
    let busy = true;
    let activity = 0;
    const { s, clock } = await service(home, { busy: () => busy, lastActivity: () => activity });
    expect(await s.tick()).toBe('busy');
    busy = false;
    activity = clock.get() - 60_000;
    expect(await s.tick()).toBe('busy');
    activity = clock.get() - IDLE_MS - 1;
    expect(await s.tick()).toBe('made');
    expect(await s.tick()).toBe('not-due');
    clock.set(clock.get() + DAY);
    expect(await s.tick()).toBe('made');
    expect((await s.list()).map((b) => b.kind)).toEqual(['automatic', 'automatic']);
    const status = await s.setAutomatic(false);
    expect(status.automatic).toBe(false);
    clock.set(clock.get() + DAY);
    expect(await s.tick()).toBe('off');
    // No secrets in them: they're on this disk already.
    const [latest] = await s.list();
    expect(latest?.contents.secrets).toBeUndefined();
  });

  it('says so plainly when there isn’t room, and tries again later', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-full-'));
    let free = 10;
    const { s } = await service(home, { freeBytes: async () => free });
    expect(await s.tick()).toBe('failed');
    expect((await s.status()).problem).toMatch(/enough free space/);
    free = 10 * 1024 ** 3;
    expect(await s.tick()).toBe('made');
    expect((await s.status()).problem).toBeUndefined();
  });

  it('won’t start a restore the disk can’t hold, and stages nothing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-full-restore-'));
    await writeFile(join(home, 'settings.json'), '{}');
    await mkdir(join(home, 'memory'));
    await writeFile(join(home, 'memory', 'm_1.md'), 'x'.repeat(200_000));
    let free = 10 * 1024 ** 3;
    const { s } = await service(home, { freeBytes: async () => free });
    const made = await s.backupNow();
    const before = await readdir(s.dir);
    // Just short of what staging and the Undo copy need together.
    free = 64 * 1024 * 1024 + 200_000;
    const error = await s.restore(made.id).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'no-space',
      message: expect.stringMatching(/enough free space on this computer to restore/),
    });
    // Nothing was staged, and no Undo copy was made.
    expect(await readdir(s.dir)).toEqual(before);
    expect((await s.status()).pending).toBeUndefined();
    // Room enough for the file, not for what it unpacks to: stops there, and clears up.
    free = 64 * 1024 * 1024 + 200_000 + made.size + 1_000;
    await expect(s.restore(made.id)).rejects.toMatchObject({ code: 'no-space' });
    expect(await readdir(s.dir)).toEqual(before);
    free = 10 * 1024 ** 3;
    await expect(s.restore(made.id)).resolves.toMatchObject({ kind: 'automatic' });
  });

  it('keeps 7 dailies and 4 weeklies, and lets the rest go', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-keep-'));
    const { s, clock } = await service(home);
    const start = Date.parse('2026-08-01T03:00:00');
    for (let day = 0; day < 60; day++) {
      clock.set(start + day * DAY);
      await s.backupNow();
    }
    const kept = await s.list();
    expect(kept).toHaveLength(11);
    const days = kept.map((b) => dayOf(b.createdAt));
    expect(days.slice(0, 7)).toEqual(
      Array.from({ length: 7 }, (_, i) => dayOf(start + (59 - i) * DAY)),
    );
    expect(new Set(kept.slice(7).map((b) => weekOf(b.createdAt))).size).toBe(4);
  });

  it('chooses what to keep like a phone does', () => {
    const at = (iso: string, id = iso) => ({ id, createdAt: Date.parse(iso) });
    const backups = [
      at('2026-09-30T03:00:00'),
      at('2026-09-30T15:00:00'),
      at('2026-09-29T03:00:00'),
      at('2026-09-20T03:00:00'),
      at('2026-09-19T03:00:00'),
      at('2026-09-12T03:00:00'),
    ];
    const keep = retain(backups, { dailies: 2, weeklies: 2 });
    expect([...keep].sort()).toEqual(
      [
        '2026-09-30T15:00:00',
        '2026-09-29T03:00:00',
        '2026-09-20T03:00:00',
        '2026-09-12T03:00:00',
      ].sort(),
    );
    const now = Date.parse('2026-09-30T12:00:00');
    const undo = retainUndo(
      [
        at('2026-09-30T10:00:00'),
        at('2026-09-29T10:00:00'),
        at('2026-09-28T10:00:00'),
        at('2026-07-01T10:00:00'),
      ],
      now,
    );
    expect([...undo].sort()).toEqual(['2026-09-29T10:00:00', '2026-09-30T10:00:00']);
  });
});

describe('Repair everything', () => {
  it('is fine when backed up lately, worth knowing when not, and off when off', async () => {
    const g = await open();
    let now = Date.now();
    const check = backupCheck(g.services.backups, () => now);
    const run = async (repair = false) =>
      (await check.run({ repair, signal: new AbortController().signal }))[0];

    expect(await run()).toMatchObject({
      state: 'ok',
      message: expect.stringContaining('first backup'),
    });
    now += OVERDUE_MS + DAY;
    expect(await run()).toMatchObject({ state: 'warning', message: 'Not backed up yet.' });
    now = Date.now();
    await g.services.backups.backupNow();
    expect(await run()).toMatchObject({ state: 'ok', message: 'Backed up today.' });
    now += 9 * DAY;
    expect(await run()).toMatchObject({
      state: 'warning',
      message: 'No backup for 9 days.',
      action: { kind: 'open', place: 'health' },
    });
    // A repair makes one now.
    const before = (await g.services.backups.status()).lastAutomaticAt ?? 0;
    const repaired = await run(true);
    expect(repaired).toMatchObject({ state: 'fixed', message: 'Backed up just now.' });
    expect((await g.services.backups.status()).lastAutomaticAt).toBeGreaterThan(before);

    await g.services.backups.setAutomatic(false);
    expect(await run()).toMatchObject({ state: 'off', message: 'Daily backups are off.' });
    // Registered with Repair everything.
    expect(g.services.doctor.checks().map((c) => c.id)).toContain('backups');
  });
});

describe('errors', () => {
  it('are plain sentences', () => {
    const error = new BackupError(
      'newer',
      'This backup was made by a newer Conch. Update Conch, then restore it.',
    );
    expect(error.message).not.toMatch(/version|format|ENOENT/i);
  });

  it('cleans up after itself', async () => {
    const g = await open();
    await rm(g.services.backups.dir, { recursive: true, force: true });
    expect(json(await g.app.inject('/api/backups'))).toMatchObject({
      backups: [],
      automatic: true,
    });
  });
});
