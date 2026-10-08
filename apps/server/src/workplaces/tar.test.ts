import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { packTar, readTar } from './tar';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'conch-tar-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const long = `${'deep/'.repeat(30)}file.txt`;

describe('tar', () => {
  it('reads back what it packs, long names and times included', () => {
    const packed = packTar([
      { path: 'a.txt', data: Buffer.from('hello'), mode: 0o644, mtime: 1_700_000_000 },
      { path: long, data: Buffer.from('far'), mode: 0o755, mtime: 1_700_000_001 },
    ]);
    const entries = readTar(packed);
    expect(entries.map((e) => [e.path, e.type, e.data.toString(), e.mtime])).toEqual([
      ['a.txt', 'file', 'hello', 1_700_000_000],
      [long, 'file', 'far', 1_700_000_001],
    ]);
    expect(entries[1]?.mode && entries[1].mode & 0o111).toBeTruthy();
  });

  it('is unpacked by the system’s own tar, as a machine would', () => {
    const out = temp();
    const file = join(out, 'in.tgz');
    writeFileSync(
      file,
      packTar([{ path: long, data: Buffer.from('far'), mode: 0o644, mtime: 1_700_000_000 }]),
    );
    execFileSync('tar', ['-xzf', file, '-C', out]);
    expect(readFileSync(join(out, ...long.split('/')), 'utf8')).toBe('far');
  });

  it('reads what the system’s tar makes, links listed as links and never as files', () => {
    const src = temp();
    mkdirSync(join(src, ...long.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(src, ...long.split('/')), 'far');
    execFileSync('ln', ['-s', '/etc/passwd', join(src, 'link')]);
    const made = execFileSync('tar', ['-czf', '-', '-C', src, 'deep', 'link']);
    const entries = readTar(made);
    expect(entries.find((e) => e.path.replace(/^\.\//, '') === long)?.data.toString()).toBe('far');
    expect(entries.find((e) => e.path === 'link')?.type).toBe('link');
  });

  it('refuses a damaged archive instead of guessing', () => {
    const packed = packTar([{ path: 'a', data: Buffer.from('x'), mode: 0o644, mtime: 1 }]);
    const raw = gunzipSync(packed);
    raw[0] = raw[0] === 0x41 ? 0x42 : 0x41;
    expect(() => readTar(gzipSync(raw))).toThrow(/damaged/);
  });
});
