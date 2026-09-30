/**
 * The `.conchbackup` format, and the attacks on it: a backup can come from
 * anywhere, so a hostile one must be refused before anything is written
 * outside the staging folder — traversal (“zip slip”), absolute paths,
 * links, places Conch never restores to, bombs, tampering, a wrong
 * passphrase, and formats this Conch doesn't know.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { BackupError, padding, paxRecord, tarHeader } from './archive';
import { credentialsOnly, extractBackup, FORMAT_VERSION, readHeader, writeBackup } from './format';
import { groupsFor } from './manifest';
import { safeJoinPath, validRelPath } from './paths';

// scrypt (N=2^17) takes a moment on shared runners.
vi.setConfig({ testTimeout: 30_000 });

const PASSPHRASE = 'seven lemons sail past the harbour';
const ACCESS = {
  version: 1,
  method: 'password',
  username: 'ada',
  passwordHash: 'scrypt$131072$8$1$salt$hash',
  keys: [],
  sessions: [{ id: 's_1', hash: 'h' }],
  pairings: [{ hash: 'p', createdAt: 1, expiresAt: 2 }],
};

async function temp(prefix = 'conch-format-') {
  return mkdtemp(join(tmpdir(), prefix));
}

async function home() {
  const dir = await temp();
  await mkdir(join(dir, 'memory'));
  await mkdir(join(dir, 'conversations'));
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ persona: { name: 'Shelly' } }));
  await writeFile(join(dir, 'memory', 'm_1.md'), '---\nid: m_1\n---\nLikes lemon tea.\n');
  await writeFile(join(dir, 'conversations', 'c_1.jsonl'), '{"type":"user.message"}\n');
  await writeFile(join(dir, 'conversations', 'index.json'), '[]');
  await writeFile(join(dir, 'secrets.json'), JSON.stringify({ providers: { openrouter: 'k' } }));
  await writeFile(join(dir, 'access.json'), JSON.stringify(ACCESS));
  await writeFile(join(dir, 'search.db'), 'index');
  return dir;
}

const all = groupsFor({ chats: true, secrets: false });

async function backup(from: string, secrets?: 'passphrase' | 'local') {
  const out = join(await temp('conch-out-'), 'b.conchbackup');
  await writeBackup(from, out, {
    kind: 'manual',
    groups: all,
    conchVersion: '0.2.0',
    ...(secrets === 'passphrase' && { secrets: { mode: 'passphrase', passphrase: PASSPHRASE } }),
    ...(secrets === 'local' && { secrets: { mode: 'local' } }),
  });
  return out;
}

/** Every file under `dir`, relative, with `/`. */
async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (at: string, rel: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(at, entry.name), path);
      else out.push(path);
    }
  };
  await visit(dir, '');
  return out.sort();
}

async function refused(path: string, code: BackupError['code'], options = {}) {
  const staging = await temp('conch-staging-');
  const error = await extractBackup(path, { staging, ...options }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BackupError);
  expect((error as BackupError).code).toBe(code);
  return staging;
}

// ── Hand-built archives ─────────────────────────────────────────────────

interface Raw {
  name: string;
  data?: Buffer | string;
  type?: string;
}

function tar(entries: Raw[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    blocks.push(
      tarHeader(entry.name, data.length, entry.type ?? '0'),
      data,
      Buffer.alloc(padding(data.length)),
    );
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const validHeader = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'conch-backup',
    version: FORMAT_VERSION,
    createdAt: 1,
    conchVersion: '0.2.0',
    kind: 'manual',
    groups: ['settings', 'memory'],
    dirs: [],
    contents: {
      settings: true,
      memories: 1,
      commands: 0,
      routines: 0,
      skills: 0,
      integrations: 0,
      integrationsSigningIn: 0,
    },
    ...overrides,
  });

const sha = (data: string) => createHash('sha256').update(data).digest('hex');

async function crafted(entries: Raw[], header = validHeader()): Promise<string> {
  const path = join(await temp('conch-crafted-'), 'evil.conchbackup');
  await writeFile(path, gzipSync(tar([{ name: 'conch-backup.json', data: header }, ...entries])));
  return path;
}

describe('backing up and reading it back', () => {
  it('keeps every kept file, byte for byte, and leaves derived ones out', async () => {
    const from = await home();
    const path = await backup(from);
    const header = await readHeader(path);
    expect(header).toMatchObject({
      format: 'conch-backup',
      version: 1,
      kind: 'manual',
      conchVersion: '0.2.0',
      contents: { settings: true, memories: 1, chats: 1 },
    });
    expect(header.contents.secrets).toBeUndefined();
    const staging = await temp();
    const extracted = await extractBackup(path, { staging });
    expect(extracted.files.sort()).toEqual(
      [
        'conversations/c_1.jsonl',
        'conversations/index.json',
        'memory/m_1.md',
        'settings.json',
      ].sort(),
    );
    expect(await readFile(join(staging, 'files', 'memory', 'm_1.md'), 'utf8')).toContain('lemon');
    // No keys, no sign-in, no search index.
    expect(await files(join(staging, 'files'))).not.toContain('secrets.json');
    expect(await files(join(staging, 'files'))).not.toContain('search.db');
  });

  it('is a real tar.gz that any tar can open', async () => {
    const path = await backup(await home());
    const raw = gunzipSync(await readFile(path));
    expect(raw.subarray(257, 262).toString()).toBe('ustar');
    expect(raw.subarray(0, 17).toString()).toBe('conch-backup.json');
  });

  it('keeps who may sign in, never signed-in devices or pairing codes', () => {
    const kept = JSON.parse(credentialsOnly(Buffer.from(JSON.stringify(ACCESS)))?.toString() ?? '');
    expect(kept).toMatchObject({
      method: 'password',
      username: 'ada',
      passwordHash: ACCESS.passwordHash,
    });
    expect(kept.sessions).toBeUndefined();
    expect(kept.pairings).toBeUndefined();
  });

  it('names paths that can’t escape, and refuses those that could', () => {
    expect(validRelPath('memory/m_1.md')).toBe(true);
    expect(validRelPath('skills/tidy/.hidden/notes é.md')).toBe(true);
    for (const bad of [
      '',
      '../x',
      'memory/../../x',
      '/etc/passwd',
      'C:/Windows/x',
      'memory\\..\\x',
      'memory//m.md',
      'memory/./m.md',
      'memory/CON',
      'memory/m.md.',
      'memory/m.md:stream',
      'memory/\u0000.md',
      'x'.repeat(600),
    ])
      expect(validRelPath(bad), bad).toBe(false);
    expect(() => safeJoinPath('/home', '../etc')).toThrow(/Unsafe/);
    expect(safeJoinPath(join('/home'), 'memory/m.md')).toBe(join('/home', 'memory', 'm.md'));
  });
});

describe('keys and sign-ins, locked with a passphrase', () => {
  it('encrypts them, and the right passphrase opens them', async () => {
    const path = await backup(await home(), 'passphrase');
    const raw = gunzipSync(await readFile(path));
    // Nowhere in the file in the clear.
    expect(raw.includes(Buffer.from('openrouter'))).toBe(false);
    expect(raw.includes(Buffer.from('scrypt$131072'))).toBe(false);
    expect(raw.includes(Buffer.from(PASSPHRASE))).toBe(false);
    const header = await readHeader(path);
    expect(header.secrets).toMatchObject({
      mode: 'passphrase',
      lock: { kdf: { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 }, cipher: 'aes-256-gcm' },
    });
    expect(JSON.stringify(header)).not.toMatch(/hint/i);

    const staging = await temp();
    const extracted = await extractBackup(path, { staging, passphrase: PASSPHRASE });
    expect(extracted.secrets.sort()).toEqual(['access.json', 'secrets.json']);
    const access = JSON.parse(await readFile(join(staging, 'files', 'access.json'), 'utf8'));
    expect(access).toMatchObject({ method: 'password', username: 'ada' });
    expect(access.sessions).toBeUndefined();
  });

  it('says so plainly when the passphrase is wrong or missing, and can leave them out', async () => {
    const path = await backup(await home(), 'passphrase');
    await refused(path, 'wrong-passphrase', { passphrase: 'not the one at all, sorry' });
    await refused(path, 'needs-passphrase');
    const staging = await temp();
    const extracted = await extractBackup(path, { staging, skipSecrets: true });
    expect(extracted.secrets).toEqual([]);
    expect(await files(join(staging, 'files'))).not.toContain('secrets.json');
  });

  it('never salts or nonces the same twice', async () => {
    const from = await home();
    const [a, b] = await Promise.all([backup(from, 'passphrase'), backup(from, 'passphrase')]);
    const [ha, hb] = [await readHeader(a), await readHeader(b)];
    if (ha.secrets?.mode !== 'passphrase' || hb.secrets?.mode !== 'passphrase') throw new Error();
    expect(ha.secrets.lock.kdf.salt).not.toBe(hb.secrets.lock.kdf.salt);
    expect(ha.secrets.lock.nonce).not.toBe(hb.secrets.lock.nonce);
  });

  it('keeps an Undo copy’s unlocked keys to the computer that made it', async () => {
    const path = await backup(await home(), 'local');
    await refused(path, 'local-only');
    const staging = await temp();
    const extracted = await extractBackup(path, { staging, allowLocal: true });
    expect(extracted.files).toContain('secrets.json');
  });
});

describe('tampering', () => {
  /** Rebuild a backup's tar with one entry changed. */
  async function altered(path: string, change: (name: string, data: Buffer) => Buffer) {
    const raw = gunzipSync(await readFile(path));
    const entries: Raw[] = [];
    let offset = 0;
    let pending: string | undefined;
    while (offset < raw.length) {
      const block = raw.subarray(offset, offset + 512);
      if (block.every((b) => b === 0)) break;
      const size = parseInt(block.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
      const type = String.fromCharCode(block[156] ?? 0);
      const data = raw.subarray(offset + 512, offset + 512 + size);
      offset += 512 + size + padding(size);
      if (type === 'x') {
        pending = /path=(.*)\n/.exec(data.toString())?.[1];
        continue;
      }
      const name = pending ?? block.subarray(0, 100).toString().replace(/\0.*$/s, '');
      pending = undefined;
      entries.push({ name, data: change(name, Buffer.from(data)) });
    }
    const out = join(await temp('conch-tampered-'), 'b.conchbackup');
    await writeFile(out, gzipSync(tar(entries)));
    return out;
  }

  it('catches a changed file', async () => {
    const path = await backup(await home());
    const tampered = await altered(path, (name, data) =>
      name === 'files/memory/m_1.md'
        ? Buffer.from(data.toString().replace('lemon', 'LEMON'))
        : data,
    );
    await refused(tampered, 'damaged');
  });

  it('catches a changed header or file list when keys are locked in it', async () => {
    const path = await backup(await home(), 'passphrase');
    const header = await altered(path, (name, data) =>
      name === 'conch-backup.json'
        ? Buffer.from(data.toString().replace('"memories":1', '"memories":9'))
        : data,
    );
    await refused(header, 'damaged', { passphrase: PASSPHRASE });
    // A changed file with its sum changed to match: the seal is authenticated too.
    const forged = await altered(path, (name, data) => {
      if (name === 'files/memory/m_1.md') return Buffer.from('forged');
      if (name === 'seal.json') {
        const seal = JSON.parse(data.toString());
        for (const f of seal.files)
          if (f.path === 'memory/m_1.md') Object.assign(f, { size: 6, sha256: sha('forged') });
        return Buffer.from(JSON.stringify(seal));
      }
      return data;
    });
    await refused(forged, 'damaged', { passphrase: PASSPHRASE });
    const keys = await altered(path, (name, data) => {
      if (name !== 'secrets.enc') return data;
      const flipped = Buffer.from(data);
      flipped[0] = (flipped[0] ?? 0) ^ 1;
      return flipped;
    });
    await refused(keys, 'damaged', { passphrase: PASSPHRASE });
  });

  it('catches a cut-off file, and something that isn’t a backup at all', async () => {
    const path = await backup(await home());
    const bytes = await readFile(path);
    const cut = join(await temp(), 'cut.conchbackup');
    await writeFile(cut, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await refused(cut, 'damaged');
    const text = join(await temp(), 'notes.conchbackup');
    await writeFile(text, 'just some notes');
    await refused(text, 'not-backup');
    const other = join(await temp(), 'other.conchbackup');
    await writeFile(other, gzipSync(tar([{ name: 'README.md', data: 'hello' }])));
    await refused(other, 'not-backup');
  });
});

describe('hostile archives', () => {
  const outside = join(tmpdir(), 'conch-escaped.txt');

  it.each([
    ['a path up and out', 'files/../../conch-escaped.txt'],
    ['a path up and out, halfway', 'files/memory/../../../conch-escaped.txt'],
    ['an absolute path', `files/${outside.replace(/\\/g, '/')}`],
    ['a drive letter', 'files/C:/conch-escaped.txt'],
    ['backslashes', 'files/memory\\..\\..\\conch-escaped.txt'],
    ['a name outside the files', '../conch-escaped.txt'],
    ['the backups folder', 'files/backups/auto-1.conchbackup'],
    ['the work folder', 'files/workspace/run.sh'],
    ['the browser’s cookies', 'files/browser/profile/Default/Cookies'],
    ['keys that aren’t locked', 'files/secrets.json'],
    ['a group it doesn’t hold', 'files/conversations/c_1.jsonl'],
    ['a file Conch doesn’t know', 'files/.bashrc'],
  ])('refuses %s', async (_what, name) => {
    const path = await crafted([{ name, data: 'pwned' }]);
    const staging = await refused(path, 'unsafe');
    expect(existsSync(outside)).toBe(false);
    expect(await files(join(staging, 'files'))).toEqual([]);
  });

  it('refuses a long name that climbs out, given in a pax header', async () => {
    const pax = paxRecord('path', `files/${'../'.repeat(40)}conch-escaped.txt`);
    const path = await crafted([
      { name: 'PaxHeader', data: pax, type: 'x' },
      { name: 'x', data: 'pwned' },
    ]);
    await refused(path, 'unsafe');
    expect(existsSync(outside)).toBe(false);
  });

  it.each([
    ['a symbolic link', '2'],
    ['a hard link', '1'],
    ['a folder', '5'],
    ['a device', '3'],
    ['a pipe', '6'],
    ['a global pax header', 'g'],
    ['a GNU long name', 'L'],
  ])('refuses %s', async (_what, type) => {
    const path = await crafted([{ name: 'files/memory/m_1.md', type }]);
    await refused(path, 'unsafe');
  });

  it('refuses the same file twice, even in another case', async () => {
    const path = await crafted([
      { name: 'files/memory/m_1.md', data: 'a' },
      { name: 'files/memory/M_1.md', data: 'b' },
    ]);
    await refused(path, 'damaged');
  });

  it('stops a bomb at the size limit, before it’s unpacked', async () => {
    const zeros = Buffer.alloc(40 * 1024 * 1024);
    const path = join(await temp(), 'bomb.conchbackup');
    await writeFile(
      path,
      gzipSync(
        tar([
          { name: 'conch-backup.json', data: validHeader() },
          { name: 'files/memory/big.md', data: zeros },
        ]),
      ),
    );
    expect((await readFile(path)).length).toBeLessThan(1024 * 1024);
    const staging = await refused(path, 'too-big', {
      limits: { maxUnpackedBytes: 8 * 1024 * 1024, maxFileBytes: 64 * 1024 * 1024 },
    });
    expect(await files(join(staging, 'files'))).toEqual([]);
    await refused(path, 'too-big', { limits: { maxFileBytes: 1024 * 1024 } });
  });

  it('stops at too many files', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      name: `files/memory/m_${i}.md`,
      data: 'x',
    }));
    await refused(await crafted(entries), 'too-big', { limits: { maxFiles: 10 } });
  });

  it('refuses anything hidden after the end', async () => {
    const path = join(await temp(), 'trailer.conchbackup');
    const body = Buffer.concat([
      tar([{ name: 'conch-backup.json', data: validHeader() }]),
      Buffer.from('surprise'),
    ]);
    await writeFile(path, gzipSync(body));
    await refused(path, 'damaged');
  });
});

describe('formats', () => {
  it('refuses a backup from a newer Conch, in a plain sentence', async () => {
    const path = await crafted([], validHeader({ version: FORMAT_VERSION + 1 }));
    await expect(readHeader(path)).rejects.toMatchObject({
      code: 'newer',
      message: 'This backup was made by a newer Conch. Update Conch, then restore it.',
    });
  });

  it('explains one older than it can read', async () => {
    const path = await crafted([], validHeader({ version: 0 }));
    await expect(readHeader(path)).rejects.toMatchObject({
      code: 'older',
      message: expect.stringContaining('early Conch'),
    });
  });

  it('refuses a header that isn’t ours', async () => {
    await expect(
      readHeader(await crafted([], JSON.stringify({ format: 'zip' }))),
    ).rejects.toMatchObject({ code: 'not-backup' });
    await expect(
      readHeader(await crafted([], validHeader({ groups: ['everything'] }))),
    ).rejects.toMatchObject({ code: 'damaged' });
  });
});
