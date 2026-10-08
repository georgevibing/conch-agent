import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { exec } from './exec';
import { land, listLocal, Mirror, parseListing, safeRelative, type Remote } from './mirror';
import { packTar } from './tar';

const dirs: string[] = [];
const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `conch-${name}-`));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A "machine" that is this computer's own shell, its home a temporary folder. */
function machine(home: string): Remote {
  return {
    sh: (script, options) =>
      exec('/bin/sh', ['-c', script], {
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home },
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        ...(options.stdin && { stdin: options.stdin }),
        ...(options.binary && { maxStdout: 64 * 1024 ** 2 }),
      }),
  };
}

const signal = () => AbortSignal.timeout(30_000);
const there = (home: string, ...path: string[]) => join(home, '.conch-work', 'c1', ...path);

describe('the mirror', () => {
  it('carries the work folder there and what a command changed back', async () => {
    const work = temp('work');
    const home = temp('home');
    writeFileSync(join(work, 'a.txt'), 'one');
    mkdirSync(join(work, 'src'));
    writeFileSync(join(work, 'src', 'b.ts'), 'two');
    mkdirSync(join(work, 'node_modules'));
    writeFileSync(join(work, 'node_modules', 'big.js'), 'not copied');
    const mirror = new Mirror(machine(home), '"$HOME"/.conch-work/c1');

    await mirror.push(work, [], signal());
    expect(readFileSync(there(home, 'src', 'b.ts'), 'utf8')).toBe('two');
    expect(existsSync(there(home, 'node_modules'))).toBe(false);

    // The command, there: changes one file, makes one, deletes one.
    writeFileSync(there(home, 'a.txt'), 'changed there');
    writeFileSync(there(home, 'new.txt'), 'made there');
    rmSync(there(home, 'src', 'b.ts'));
    const back = await mirror.pull(work, [], signal());
    expect(back).toMatchObject({ changed: 2, removed: 1, skipped: 0 });
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe('changed there');
    expect(readFileSync(join(work, 'new.txt'), 'utf8')).toBe('made there');
    expect(existsSync(join(work, 'src', 'b.ts'))).toBe(false);

    // Then here: an edit and a deletion go there before the next command.
    writeFileSync(join(work, 'new.txt'), 'edited here, longer');
    rmSync(join(work, 'a.txt'));
    await mirror.push(work, [], signal());
    expect(readFileSync(there(home, 'new.txt'), 'utf8')).toBe('edited here, longer');
    expect(existsSync(there(home, 'a.txt'))).toBe(false);
    // Nothing changed since: nothing comes back.
    expect(await mirror.pull(work, [], signal())).toMatchObject({ changed: 0, removed: 0 });
  });

  it('never copies a protected place or a link out', async () => {
    const work = temp('work');
    const home = temp('home');
    mkdirSync(join(work, '.ssh'));
    writeFileSync(join(work, '.ssh', 'id_ed25519'), 'secret');
    writeFileSync(join(work, 'ok.txt'), 'fine');
    symlinkSync('/etc/hosts', join(work, 'hosts'));
    const mirror = new Mirror(machine(home), '"$HOME"/.conch-work/c1');
    await mirror.push(work, [join(work, '.ssh')], signal());
    expect(existsSync(there(home, 'ok.txt'))).toBe(true);
    expect(existsSync(there(home, '.ssh'))).toBe(false);
    expect(existsSync(there(home, 'hosts'))).toBe(false);
  });

  it('lands nothing outside the work folder, whatever the machine sends', async () => {
    const work = temp('work');
    const outside = temp('outside');
    // A machine that lies: its listing names one file, its archive brings others.
    const evil: Remote = {
      sh: async (script) => {
        const listing = script.includes('find .') ? 'asked.txt\t1700000000\t3\t644\0' : '';
        const tar = script.includes('tar -czf')
          ? packTar([
              { path: '../escape.txt', data: Buffer.from('x'), mode: 0o644, mtime: 1 },
              { path: `${outside}/abs.txt`, data: Buffer.from('x'), mode: 0o644, mtime: 1 },
              { path: 'unasked.txt', data: Buffer.from('x'), mode: 0o644, mtime: 1 },
              { path: 'asked.txt', data: Buffer.from('yes'), mode: 0o644, mtime: 1_700_000_000 },
            ])
          : Buffer.alloc(0);
        return {
          code: 0,
          output: listing,
          stdout: tar,
          stderr: '',
          timedOut: false,
          overflow: false,
        };
      },
    };
    const back = await new Mirror(evil, 'x').pull(work, [], signal());
    expect(readFileSync(join(work, 'asked.txt'), 'utf8')).toBe('yes');
    expect(existsSync(join(work, 'unasked.txt'))).toBe(false);
    expect(existsSync(join(work, '..', 'escape.txt'))).toBe(false);
    expect(existsSync(join(outside, 'abs.txt'))).toBe(false);
    expect(back.skipped).toBe(3);
  });

  it('refuses to write through a link in the work folder', async () => {
    const work = temp('work');
    const outside = temp('outside');
    symlinkSync(outside, join(work, 'linked'));
    expect(await land(work, 'linked/file.txt', Buffer.from('x'), 0o644, 1, [])).toBe(false);
    expect(existsSync(join(outside, 'file.txt'))).toBe(false);
    writeFileSync(join(outside, 'target'), 'keep');
    symlinkSync(join(outside, 'target'), join(work, 'over.txt'));
    expect(await land(work, 'over.txt', Buffer.from('x'), 0o644, 1, [])).toBe(false);
    expect(readFileSync(join(outside, 'target'), 'utf8')).toBe('keep');
    mkdirSync(join(work, 'keys'));
    expect(await land(work, 'keys/k', Buffer.from('x'), 0o644, 1, [join(work, 'keys')])).toBe(
      false,
    );
  });

  it('reads only paths that could mean a file in the work folder', () => {
    for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', 'C:/x', 'a\\b', 'a\0b'])
      expect(safeRelative(bad), bad).toBe(false);
    expect(safeRelative('src/index.ts')).toBe(true);
    const listing = parseListing(
      './a.txt\t1700000000.5\t3\t755\nwarning: something\nnode_modules/x\t1\t1\t644\n../up\t1\t1\t644\n',
    );
    expect([...listing.keys()]).toEqual(['a.txt']);
    expect(listing.get('a.txt')).toEqual({ mtime: 1_700_000_000, size: 3, exec: true });
  });

  it('says plainly when a work folder is too big to copy', async () => {
    const work = temp('work');
    writeFileSync(join(work, 'a'), 'x');
    const { LIMITS } = await import('./mirror');
    const before = LIMITS.files;
    LIMITS.files = 0;
    try {
      await expect(listLocal(work, [])).rejects.toThrow(/too big to copy/);
    } finally {
      LIMITS.files = before;
    }
  });
});
