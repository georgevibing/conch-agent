/**
 * A Conch app's package (ADR 0061 §1): read from a folder, a `.conchapp` or
 * a GitHub tarball, held to the same rules wherever it came from. Hostile
 * archives — traversal, links, devices, duplicates, bombs, huge entries,
 * too many entries, unreadable names — refuse the lot.
 */
import { link, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { APP_LIMITS } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { padding, paxRecord, tarHeader } from '../backup/archive';
import { appHash, findApps, packApp, PackageError, readFiles, readFolder } from './package';
import type { AppFiles } from './types';

const manifest = (extra: Record<string, unknown> = {}) => ({
  conch: 1,
  id: 'plant-diary',
  name: 'Plant diary',
  tagline: 'Keeps track of watering',
  version: '1.0.0',
  icon: { glyph: 'leaf', color: 'green' },
  tools: 'tools.mjs',
  pages: [{ id: 'main', title: 'Plants', file: 'pages/main.html' }],
  ...extra,
});

function files(entries: Record<string, string | Buffer>): Map<string, Buffer> {
  return new Map(
    Object.entries(entries).map(([path, data]) => [
      path,
      typeof data === 'string' ? Buffer.from(data) : data,
    ]),
  );
}

const plant = (extra: Record<string, string | Buffer> = {}, m: Record<string, unknown> = {}) =>
  files({
    'conch-app.json': JSON.stringify(manifest(m)),
    'tools.mjs': 'export const tools = {};\n',
    'pages/main.html': '<!doctype html><title>Plants</title>',
    'README.md': '# Plant diary\n',
    ...extra,
  });

const problemsOf = (f: AppFiles) => {
  const read = readFiles(f);
  return read.ok ? [] : read.problems.map((p) => p.message);
};

// ── Archives, built entry by entry so they can be as hostile as needed ────

interface Entry {
  name: string;
  data?: Buffer | string;
  type?: string;
  /** The size the header claims, when it isn't the data's. */
  size?: number;
  /** Raw bytes for the name, written over the header's. */
  rawName?: Buffer;
}

function header(entry: Entry, size: number): Buffer {
  const block = tarHeader(entry.name, size, entry.type ?? '0');
  if (entry.rawName) {
    block.fill(0, 0, 100);
    entry.rawName.copy(block, 0);
    block.write('        ', 148, 'ascii');
    let sum = 0;
    for (const byte of block) sum += byte;
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  }
  return block;
}

function tarOf(entries: Entry[], options: { globalHeader?: string } = {}): Buffer {
  const parts: Buffer[] = [];
  if (options.globalHeader !== undefined) {
    const pax = paxRecord('comment', options.globalHeader);
    parts.push(tarHeader('pax_global_header', pax.length, 'g'));
    parts.push(pax, Buffer.alloc(padding(pax.length)));
  }
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    parts.push(header(entry, entry.size ?? data.length));
    if (data.length) parts.push(data, Buffer.alloc(padding(data.length)));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

/** A GitHub tarball: one top folder, folder entries, and the commit in a global header. */
function githubTarball(tree: Record<string, string | Buffer>, top = 'ada-plants-1a2b3c4'): Buffer {
  const entries: Entry[] = [{ name: `${top}/`, type: '5' }];
  const folders = new Set<string>();
  for (const path of Object.keys(tree)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  for (const folder of [...folders].sort()) entries.push({ name: `${top}/${folder}/`, type: '5' });
  for (const [path, data] of Object.entries(tree)) entries.push({ name: `${top}/${path}`, data });
  return tarOf(entries, { globalHeader: '1a2b3c4d5e6f' });
}

const tree = (prefix: string, m: Record<string, unknown> = {}) =>
  Object.fromEntries([...plant({}, m)].map(([p, b]) => [`${prefix}${p}`, b]));

describe('reading a package from its files', () => {
  it('reads a good one, with its fingerprint', () => {
    const read = readFiles(plant());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.app.manifest).toMatchObject({ id: 'plant-diary', kind: 'personal', reaches: [] });
    expect(read.app.hash).toBe(appHash(plant()));
  });

  it('fingerprints every path and byte in any order, leaving out the signature', () => {
    const a = plant();
    const reversed = new Map([...a].reverse());
    expect(appHash(reversed)).toBe(appHash(a));
    expect(appHash(plant({ 'conch-app.sig': '{"any":"thing"}' }))).toBe(appHash(a));
    expect(appHash(plant({ 'README.md': '# Plant diary!\n' }))).not.toBe(appHash(a));
    // A file renamed is a different package, even with the same bytes.
    const renamed = plant();
    renamed.set('notes.md', renamed.get('README.md') as Buffer);
    renamed.delete('README.md');
    expect(appHash(renamed)).not.toBe(appHash(a));
  });

  it('says what’s wrong with the manifest, naming the field', () => {
    expect(problemsOf(plant({ 'conch-app.json': '{ nope' }))[0]).toMatch(
      /^conch-app\.json isn’t valid JSON/,
    );
    expect(problemsOf(plant({}, { icon: { glyph: 'unicorn', color: 'green' } }))[0]).toMatch(
      /^“icon\.glyph” in conch-app\.json must be one of: "sparkles"/,
    );
    expect(problemsOf(plant({}, { colour: 'red' }))[0]).toBe(
      'conch-app.json has a field Conch doesn’t know: “colour”. Take it out.',
    );
    expect(problemsOf(plant({}, { name: undefined }))[0]).toBe('conch-app.json needs “name”.');
    expect(problemsOf(plant({}, { name: '' }))[0]).toBe('“name” in conch-app.json can’t be empty.');
    expect(problemsOf(plant({}, { tagline: 'x'.repeat(81) }))[0]).toBe(
      '“tagline” in conch-app.json is too long: at most 80 characters.',
    );
    expect(problemsOf(plant({}, { conch: 2 }))[0]).toBe('“conch” in conch-app.json must be 1.');
    expect(problemsOf(plant({}, { id: 'Plant Diary' }))[0]).toMatch(
      /^“id” in conch-app\.json: Use lowercase letters/,
    );
    expect(problemsOf(plant({}, { reaches: ['http://x.com'] }))[0]).toMatch(/“reaches\[0\]”/);
    const none = files({ 'tools.mjs': '' });
    expect(problemsOf(none)).toEqual(['An app needs a conch-app.json at the top of its folder.']);
  });

  it('needs every file the manifest names, and skills in their own folders', () => {
    const noTools = plant();
    noTools.delete('tools.mjs');
    expect(problemsOf(noTools)).toEqual([
      'conch-app.json names “tools.mjs” as its tools, but there’s no such file.',
    ]);
    const noPage = plant();
    noPage.delete('pages/main.html');
    expect(problemsOf(noPage)[0]).toMatch(
      /The page “Plants” is “pages\/main\.html”, but there’s no such file/,
    );
    expect(
      problemsOf(
        plant(
          {},
          {
            pages: [
              { id: 'main', title: 'A', file: 'pages/main.html' },
              { id: 'main', title: 'B', file: 'pages/main.html' },
            ],
          },
        ),
      ),
    ).toContain('Two pages have the id “main”.');
    expect(readFiles(plant({ 'skills/watering/SKILL.md': '# Watering' })).ok).toBe(true);
    expect(
      readFiles(plant({ 'skills/watering/SKILL.md': '# W', 'skills/watering/notes.md': 'x' })).ok,
    ).toBe(true);
    expect(problemsOf(plant({ 'skills/watering.md': '# W' }))[0]).toMatch(/own folder/);
    expect(problemsOf(plant({ 'skills/watering/notes.md': 'x' }))).toEqual([
      'The skill “watering” has no SKILL.md.',
    ]);
    expect(problemsOf(plant({ 'skills/Watering/SKILL.md': 'x' }))[0]).toMatch(
      /can’t be a skill’s name/,
    );
  });

  it('takes only plain paths inside it, of known kinds of text', () => {
    for (const path of [
      '../escape.md',
      '/abs.md',
      'a/../../b.md',
      '.env',
      'pages/.hidden.html',
      'a\\b.md',
      'C:/x.md',
      'con.md',
      'trailing.md.',
    ])
      expect(problemsOf(plant({ [path]: 'x' })).join(' '), path).toMatch(/can’t be in an app/);
    expect(problemsOf(plant({ 'run.exe': 'x' }))[0]).toMatch(
      /isn’t a kind of file an app can carry/,
    );
    expect(problemsOf(plant({ 'pages/pic.png': 'x' }))[0]).toMatch(/isn’t a kind of file/);
    expect(problemsOf(plant({ 'data.json': Buffer.from([0x7b, 0, 0x7d]) }))[0]).toMatch(
      /isn’t text/,
    );
    expect(problemsOf(plant({ 'data.json': Buffer.from([0xff, 0xfe, 0x41]) }))[0]).toMatch(
      /isn’t text/,
    );
    expect(problemsOf(plant({ 'readme.md': 'x' }))[0]).toMatch(/differ only in case/);
    expect(readFiles(plant({ LICENSE: 'MIT', 'notes.TXT': 'x', 'style.css': 'a{}' })).ok).toBe(
      true,
    );
  });

  it('holds to the limits on files and bytes', () => {
    const many = plant();
    for (let i = 0; i < APP_LIMITS.files; i++) many.set(`notes/${i}.md`, Buffer.from('x'));
    expect(problemsOf(many)[0]).toMatch(/at most 200 files/);
    const big = plant({ 'big.txt': Buffer.alloc(APP_LIMITS.bytes, 'a') });
    expect(problemsOf(big)[0]).toMatch(/at most 2 MB/);
  });
});

describe('reading a package from a folder', () => {
  async function folder(entries: Record<string, string | Buffer>) {
    const dir = join(await mkdtemp(join(tmpdir(), 'conch app folder ')), 'plant diary');
    for (const [path, data] of Object.entries(entries)) {
      await mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
      await writeFile(join(dir, ...path.split('/')), data);
    }
    return dir;
  }

  it('reads regular files, paths with spaces included, and passes over a Mac’s .DS_Store', async () => {
    const dir = await folder({
      ...Object.fromEntries(plant()),
      'pages/more notes.md': 'x',
      '.DS_Store': 'mac',
    });
    const read = await readFolder(dir);
    expect(read.ok).toBe(true);
    if (read.ok) expect([...read.app.files.keys()].sort()).toContain('pages/more notes.md');
  });

  it('refuses a link to anywhere, a hard link, and a hidden file', async () => {
    const outside = await folder({ 'secret.md': 'the key' });
    const dir = await folder(Object.fromEntries(plant()));
    let linked = true;
    try {
      await symlink(join(outside, 'secret.md'), join(dir, 'notes.md'));
    } catch {
      // Windows without developer mode can't make links: the hard link below still runs.
      linked = false;
    }
    if (linked)
      expect(await readFolder(dir)).toMatchObject({
        ok: false,
        problems: [{ message: '“notes.md” is a link, which Conch never follows in an app.' }],
      });

    const hard = await folder(Object.fromEntries(plant()));
    await link(join(outside, 'secret.md'), join(hard, 'notes.md'));
    expect(await readFolder(hard)).toMatchObject({
      ok: false,
      problems: [
        { message: '“notes.md” is linked to another file, which Conch never reads in an app.' },
      ],
    });

    // A folder that's a link elsewhere (a junction on Windows, which anyone can make).
    const junction = await folder(Object.fromEntries(plant()));
    await symlink(outside, join(junction, 'pages', 'more'), 'junction');
    expect(await readFolder(junction)).toMatchObject({
      ok: false,
      problems: [{ message: '“pages/more” is a link, which Conch never follows in an app.' }],
    });

    const hidden = await folder({ ...Object.fromEntries(plant()), '.env': 'KEY=1' });
    const read = await readFolder(hidden);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problems[0]?.message).toMatch(/“\.env” can’t be in an app/);
  });

  it('stops at the limits while reading, not after', async () => {
    const dir = await folder({
      ...Object.fromEntries(plant()),
      'a.txt': Buffer.alloc(APP_LIMITS.bytes - 100, 'a'),
      'b.txt': Buffer.alloc(APP_LIMITS.bytes, 'b'),
    });
    expect(await readFolder(dir)).toMatchObject({
      ok: false,
      problems: [{ message: 'An app can be at most 2 MB, and this folder is bigger.' }],
    });
    const many: Record<string, string> = Object.fromEntries(
      [...plant()].map(([p, b]) => [p, b.toString()]),
    );
    for (let i = 0; i < APP_LIMITS.files; i++) many[`n/${i}.md`] = 'x';
    expect(await readFolder(await folder(many))).toMatchObject({
      ok: false,
      problems: [{ message: 'An app can hold at most 200 files, and this folder has more.' }],
    });
    expect(await readFolder(join(dir, 'not here'))).toMatchObject({
      ok: false,
      problems: [{ message: 'The app’s folder isn’t there any more.' }],
    });
  });
});

describe('a .conchapp', () => {
  it('packs the files at the top, the same bytes every time, and reads back the same app', async () => {
    const read = readFiles(plant({ 'conch-app.sig': '{"v":1}' }));
    if (!read.ok) throw new Error('fixture');
    const packed = await packApp(read.app);
    expect((await packApp(read.app)).equals(packed)).toBe(true);
    const found = await findApps(packed);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('');
    const again = found[0]?.read;
    expect(again?.ok).toBe(true);
    if (again?.ok) {
      expect(again.app.hash).toBe(read.app.hash);
      expect(again.app.files.get('conch-app.sig')?.toString()).toBe('{"v":1}');
    }
  });

  it('refuses one that isn’t a package', async () => {
    await expect(findApps(Buffer.from('not gzip at all'))).rejects.toThrow(
      'That isn’t a Conch app package, or it’s damaged.',
    );
    await expect(findApps(gzipSync(Buffer.from('not a tar')))).rejects.toThrow(PackageError);
    await expect(findApps(Buffer.alloc(APP_LIMITS.download + 1))).rejects.toThrow(
      /bigger than 10 MB/,
    );
  });
});

describe('a GitHub tarball', () => {
  it('strips the top folder, passes over the commit and folders, and finds the app', async () => {
    const found = await findApps(
      githubTarball({ ...tree(''), '.github/workflows/ci.yml': 'on: push', '.gitignore': 'x' }),
    );
    expect(found.map((f) => f.path)).toEqual(['']);
    expect(found[0]?.read.ok).toBe(true);
  });

  it('finds every app in a collection, up to three folders down, or only where asked', async () => {
    const archive = githubTarball({
      'README.md': '# My apps',
      ...tree('apps/plant/'),
      ...tree('apps/deep/weather/', { id: 'weather' }),
      ...tree('a/b/c/too-deep/', { id: 'too-deep' }),
    });
    expect((await findApps(archive)).map((f) => f.path)).toEqual([
      'apps/deep/weather',
      'apps/plant',
    ]);
    expect((await findApps(archive, { path: 'apps/plant' })).map((f) => f.path)).toEqual([
      'apps/plant',
    ]);
    expect((await findApps(archive, { path: '/apps/' })).map((f) => f.path)).toEqual([
      'apps/deep/weather',
      'apps/plant',
    ]);
    // Three down from the folder asked for.
    expect((await findApps(archive, { path: 'a' })).map((f) => f.path)).toEqual(['a/b/c/too-deep']);
    expect(await findApps(archive, { path: 'nowhere' })).toEqual([]);
    await expect(findApps(archive, { path: '../up' })).rejects.toThrow(
      /isn’t a folder Conch can look in/,
    );
  });

  it('gives an app inside another app’s folder to that app', async () => {
    const found = await findApps(
      githubTarball({ ...tree(''), ...tree('examples/weather/', { id: 'weather' }) }),
    );
    expect(found.map((f) => f.path)).toEqual(['', 'examples/weather']);
    const root = found[0]?.read;
    expect(root?.ok).toBe(true);
    if (root?.ok)
      expect([...root.app.files.keys()].some((p) => p.startsWith('examples/'))).toBe(false);
  });

  it('says which file is too big for an app, without unpacking it', async () => {
    const found = await findApps(
      githubTarball({ ...tree(''), 'huge.txt': Buffer.alloc(APP_LIMITS.bytes + 1, 'a') }),
    );
    expect(found[0]?.read).toMatchObject({ ok: false, problems: [{ file: 'huge.txt' }] });
  });
});

describe('hostile archives fail closed', () => {
  const good = Object.entries(Object.fromEntries(plant())).map(([name, data]) => ({ name, data }));

  it.each<[string, Entry[], RegExp]>([
    [
      'a path out of it',
      [...good, { name: '../evil.md', data: 'x' }],
      /won’t open: “\.\.\/evil\.md”/,
    ],
    ['a path deep out of it', [...good, { name: 'pages/../../evil.md', data: 'x' }], /won’t open/],
    ['an absolute path', [...good, { name: '/etc/passwd', data: 'x' }], /won’t open/],
    ['a drive letter', [...good, { name: 'C:/Windows/evil.md', data: 'x' }], /won’t open/],
    ['a backslash', [...good, { name: 'pages\\..\\..\\evil.md', data: 'x' }], /won’t open/],
    ['a symbolic link', [...good, { name: 'notes.md', type: '2' }], /holds a link/],
    ['a hard link', [...good, { name: 'notes.md', type: '1' }], /holds a link/],
    ['a device', [...good, { name: 'dev.md', type: '3' }], /something other than files/],
    ['a fifo', [...good, { name: 'fifo.md', type: '6' }], /something other than files/],
    ['a name twice', [...good, { name: 'README.md', data: 'again' }], /has “README\.md” twice/],
    ['a name twice in another case', [...good, { name: 'readme.MD', data: 'again' }], /twice/],
    [
      'a name that isn’t text',
      [
        ...good,
        { name: 'x.md', rawName: Buffer.from([0x6e, 0xff, 0xfe, 0x2e, 0x6d, 0x64]), data: 'x' },
      ],
      /isn’t readable text/,
    ],
    [
      'an entry that claims to be huge',
      [...good, { name: 'huge.md', size: 128 * 1024 * 1024 }],
      /bigger than Conch reads/,
    ],
  ])('refuses %s', async (_, entries, message) => {
    await expect(findApps(tarOf(entries))).rejects.toThrow(message);
  });

  it('refuses a folder entry in a .conchapp-style archive only as GitHub writes them', async () => {
    // Folders are passed over (GitHub writes them); what's in them is still checked.
    const archive = tarOf([{ name: 'pages/', type: '5' }, ...good]);
    expect((await findApps(archive))[0]?.read.ok).toBe(true);
  });

  it('stops a gzip bomb at the cap', async () => {
    // 80 MB of zeros as one file's data packs to well under a megabyte.
    const bomb = tarOf([...good, { name: 'zeros.txt', data: Buffer.alloc(80 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(APP_LIMITS.download);
    await expect(findApps(bomb)).rejects.toThrow('This package is bigger than Conch reads.');
  });

  it('stops zeros hidden after the end', async () => {
    const raw = Buffer.concat([
      ...good.flatMap((e) => {
        const d = Buffer.from(e.data);
        return [tarHeader(e.name, d.length, '0'), d, Buffer.alloc(padding(d.length))];
      }),
      Buffer.alloc(1024 * 1024),
    ]);
    await expect(findApps(gzipSync(raw))).rejects.toThrow(/damaged/);
  });

  it('refuses too many entries', async () => {
    const many: Entry[] = [...good];
    for (let i = 0; i < 10_001; i++) many.push({ name: `n/${i}.md` });
    await expect(findApps(tarOf(many))).rejects.toThrow('This package is bigger than Conch reads.');
  });
});
