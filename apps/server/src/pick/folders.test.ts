import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Access } from '../security';
import {
  crumbsOf,
  expand,
  FolderError,
  folderPlaces,
  guessFolder,
  LIST_LIMIT,
  listFolder,
  makeFolder,
  shown,
  type FolderRules,
} from './folders';
import { registerFolderRoutes } from './routes';

let root: string;
let rules: FolderRules;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'conch-folders-')));
  const home = join(root, 'home');
  const conch = join(home, '.conch');
  for (const dir of [
    'Desktop',
    'Documents/Passwords',
    'Projects/conch',
    'Projects/notes',
    '.config',
    '.ssh',
    '.conch/workspace',
    '.conch/vault',
  ])
    await mkdir(join(home, dir), { recursive: true });
  await writeFile(join(home, 'Documents', 'Passwords', 'Main.kdbx'), 'secret bytes');
  await writeFile(join(home, 'Documents', 'Passwords', 'notes.txt'), 'words');
  await writeFile(join(home, 'Documents', 'report.pdf'), 'pdf');
  rules = {
    home,
    conchHome: conch,
    workspace: join(conch, 'workspace'),
    denied: [join(conch, 'vault'), join(home, '.ssh')],
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('reading a path as a page sends it', () => {
  it('is from the home folder, never from where Conch started', () => {
    expect(expand('~', rules)).toBe(rules.home);
    expect(expand('~/Projects', rules)).toBe(join(rules.home, 'Projects'));
    expect(expand('Projects', rules)).toBe(join(rules.home, 'Projects'));
    expect(expand('/tmp/../etc', rules)).toBe('/etc');
    expect(shown(join(rules.home, 'Projects'), rules)).toBe('~/Projects');
    expect(crumbsOf(join(rules.home, 'Projects', 'conch'), rules)).toEqual([
      { name: 'Home', path: rules.home, top: 'home' },
      { name: 'Projects', path: join(rules.home, 'Projects') },
      { name: 'conch', path: join(rules.home, 'Projects', 'conch') },
    ]);
    expect(crumbsOf('/usr/local', rules)[0]).toMatchObject({ path: '/', top: 'disk' });
  });
});

describe('a listing', () => {
  it('names the folders in a folder, by name, hidden ones only when asked', async () => {
    const listing = await listFolder('~', rules);
    expect(listing.folders.map((f) => f.name)).toEqual(['Desktop', 'Documents', 'Projects']);
    // .config is hidden; .ssh and .conch are never shown, so they aren't counted either.
    expect(listing.hiddenCount).toBe(1);
    expect(listing.crumbs).toHaveLength(1);
    expect(listing.writable).toBe(true);
    expect(listing.files).toBeUndefined();
    const all = await listFolder('~', rules, { hidden: true });
    expect(all.folders.map((f) => f.name)).toEqual(['.config', 'Desktop', 'Documents', 'Projects']);
  });

  it('shows files only when choosing one, and only the kinds asked for, never what is in them', async () => {
    const plain = await listFolder('~/Documents/Passwords', rules);
    expect(plain.files).toBeUndefined();
    const kdbx = await listFolder('~/Documents/Passwords', rules, { files: ['kdbx'] });
    expect(kdbx.files).toEqual([
      { name: 'Main.kdbx', path: join(rules.home, 'Documents', 'Passwords', 'Main.kdbx') },
    ]);
    expect(JSON.stringify(kdbx)).not.toContain('secret bytes');
    const any = await listFolder('~/Documents/Passwords', rules, { files: 'all' });
    expect(any.files?.map((f) => f.name)).toEqual(['Main.kdbx', 'notes.txt']);
  });

  it('never opens Conch’s own folder or where keys are kept, by any way round', async () => {
    for (const path of ['~/.conch', '~/.conch/vault', '~/.ssh', `${rules.home}/Projects/../.ssh`])
      await expect(listFolder(path, rules)).rejects.toMatchObject({ code: 'denied' });
    // A shortcut is followed before that's decided.
    await symlink(join(rules.home, '.ssh'), join(rules.home, 'Projects', 'keys'));
    await symlink(join(rules.conchHome, 'vault'), join(rules.home, 'Desktop', 'vault'));
    await expect(listFolder('~/Projects/keys', rules)).rejects.toMatchObject({ code: 'denied' });
    const projects = await listFolder('~/Projects', rules, { hidden: true });
    expect(projects.folders.map((f) => f.name)).toEqual(['conch', 'notes']);
    const desktop = await listFolder('~/Desktop', rules, { hidden: true });
    expect(desktop.folders).toEqual([]);
    // Conch's workspace is the person's: it opens.
    await expect(listFolder(rules.workspace, rules)).resolves.toMatchObject({ name: 'workspace' });
  });

  it('follows a shortcut to a folder, says it is one, and leaves out broken ones', async () => {
    await symlink(join(rules.home, 'Projects', 'conch'), join(rules.home, 'Desktop', 'conch'));
    await symlink(join(rules.home, 'nowhere'), join(rules.home, 'Desktop', 'gone'));
    const desktop = await listFolder('~/Desktop', rules);
    expect(desktop.folders).toEqual([
      { name: 'conch', path: join(rules.home, 'Desktop', 'conch'), link: true },
    ]);
    const inside = await listFolder('~/Desktop/conch', rules);
    // Where you went, not where it really is: the trail is the way you came.
    expect(inside.path).toBe(join(rules.home, 'Desktop', 'conch'));
  });

  it('says in words what is wrong with a path', async () => {
    await expect(listFolder('~/nothing', rules)).rejects.toMatchObject({ code: 'missing' });
    await expect(listFolder('~/Documents/report.pdf', rules)).rejects.toMatchObject({
      code: 'not-folder',
      message: 'That’s a file, not a folder.',
    });
  });

  it('holds its size however many folders there are', async () => {
    const big = join(rules.home, 'Big');
    await mkdir(big);
    await Promise.all(Array.from({ length: LIST_LIMIT + 20 }, (_, i) => mkdir(join(big, `f${i}`))));
    const listing = await listFolder(big, rules);
    expect(listing.folders).toHaveLength(LIST_LIMIT);
    expect(listing.more).toBe(true);
    // Numbers sort the way people count.
    expect(listing.folders.slice(0, 3).map((f) => f.name)).toEqual(['f0', 'f1', 'f2']);
  });
});

describe('typing a path', () => {
  it('suggests the folders that go on from it, and says what is there', async () => {
    const partial = await guessFolder('~/Pro', rules);
    expect(partial).toMatchObject({ state: 'missing', matches: [{ name: 'Projects' }] });
    const inside = await guessFolder('~/Projects/', rules);
    expect(inside.state).toBe('folder');
    expect(inside.matches.map((m) => m.name)).toEqual(['conch', 'notes']);
    expect((await guessFolder('~/Documents/report.pdf', rules)).state).toBe('file');
    const secret = await guessFolder('~/.ss', rules);
    expect(secret.matches).toEqual([]);
    expect((await guessFolder('~/.ssh', rules)).state).toBe('denied');
  });
});

describe('a new folder', () => {
  it('is made where you are, by a name that can’t step out of it', async () => {
    const made = await makeFolder('~/Projects', 'garden', rules);
    expect(made).toBe(join(rules.home, 'Projects', 'garden'));
    expect((await listFolder('~/Projects', rules)).folders.map((f) => f.name)).toContain('garden');
    for (const name of ['../escape', 'a/b', '..', '.', ''])
      await expect(makeFolder('~/Projects', name, rules)).rejects.toMatchObject({ code: 'name' });
    await expect(makeFolder('~/Projects', 'garden', rules)).rejects.toMatchObject({
      code: 'exists',
    });
    await expect(makeFolder('~/.ssh', 'x', rules)).rejects.toBeInstanceOf(FolderError);
    await expect(makeFolder('~/.conch', 'x', rules)).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('places to start from', () => {
  it('are the ones that are there, Conch’s workspace among them', async () => {
    const { places, home } = await folderPlaces(rules);
    expect(home).toBe(rules.home);
    const kinds = places.map((p) => `${p.kind}:${p.title}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'home:Home',
        'desktop:Desktop',
        'documents:Documents',
        'projects:Projects',
        'workspace:Conch’s workspace',
      ]),
    );
    expect(kinds).not.toContain('downloads:Downloads');
  });
});

describe('the routes', () => {
  async function app(access: Access) {
    const server = Fastify();
    server.addHook('onRequest', async (request) => {
      request.access = access;
    });
    registerFolderRoutes(server, () => rules);
    await server.ready();
    return server;
  }

  it('walk through folders for a person, and refuse an access key', async () => {
    const person = await app({ kind: 'session' } as Access);
    const list = await person.inject({ url: '/api/pick/list?path=~/Projects' });
    expect(list.statusCode).toBe(200);
    expect(list.json().folders.map((f: { name: string }) => f.name)).toEqual(['conch', 'notes']);
    const kdbx = await person.inject({
      url: '/api/pick/list?path=~/Documents/Passwords&purpose=keepassxc-database',
    });
    expect(kdbx.json().files).toEqual([expect.objectContaining({ name: 'Main.kdbx' })]);
    const denied = await person.inject({ url: '/api/pick/list?path=~/.ssh' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'folder-denied' });
    const made = await person.inject({
      method: 'POST',
      url: '/api/pick/folder',
      payload: { parent: '~', name: 'New' },
    });
    expect(made.json()).toEqual({ path: join(rules.home, 'New') });

    const script = await app({ kind: 'bearer', keyId: 'k' } as Access);
    for (const url of ['/api/pick/places', '/api/pick/list?path=~', '/api/pick/guess?path=~'])
      expect((await script.inject({ url })).statusCode).toBe(403);
    const write = await script.inject({
      method: 'POST',
      url: '/api/pick/folder',
      payload: { parent: '~', name: 'Sneaky' },
    });
    expect(write.statusCode).toBe(403);
  });
});
