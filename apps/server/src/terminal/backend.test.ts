import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { basicBackend, ensureSpawnHelper, loadBackend } from './backend';

const noNative = () => {
  throw Object.assign(new Error("Cannot find module 'node-pty'"), { code: 'MODULE_NOT_FOUND' });
};

describe('optional native terminal', () => {
  it('is optional in the package manifest, not a required or development dependency', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest.optionalDependencies['node-pty']).toEqual(expect.any(String));
    expect(manifest.dependencies['node-pty']).toBeUndefined();
    expect(manifest.devDependencies['node-pty']).toBeUndefined();
  });

  it('uses the native backend first without looking for Python', () => {
    const native = { ...basicBackend(), kind: 'pty' as const };
    const python = vi.fn();
    const heal = vi.fn();
    expect(loadBackend(heal, { native: () => native, python })).toBe(native);
    expect(python).not.toHaveBeenCalled();
    expect(heal).not.toHaveBeenCalled();
  });

  it('uses Python after a missing or failed native build', () => {
    const heal = vi.fn();
    expect(
      loadBackend(heal, { native: noNative, python: () => 'python3', platform: 'linux' }).kind,
    ).toBe('python');
    expect(heal).toHaveBeenCalledWith(expect.stringContaining('through Python'));
  });

  it('still opens basic terminals when Python is missing', () => {
    const heal = vi.fn();
    expect(
      loadBackend(heal, { native: noNative, python: () => undefined, platform: 'linux' }).kind,
    ).toBe('basic');
    expect(heal).toHaveBeenCalledWith(expect.stringContaining('full-screen programs don’t'));
  });

  it('does not attempt the POSIX Python bridge on Windows', () => {
    const python = vi.fn(() => 'python3');
    expect(loadBackend(() => {}, { native: noNative, python, platform: 'win32' }).kind).toBe(
      'basic',
    );
    expect(python).not.toHaveBeenCalled();
  });

  const pythonAvailable =
    process.platform !== 'win32' &&
    spawnSync('python3', ['-c', 'import pty, termios, fcntl']).status === 0;
  it.skipIf(!pythonAvailable)(
    'runs a real Python PTY with native code absent: input, output, tty, exit status',
    async () => {
      const backend = loadBackend(() => {}, { native: noNative, python: () => 'python3' });
      const child = backend.spawn(
        '/bin/sh',
        [
          '-c',
          'test -t 0 && test -t 1 || exit 99; printf "READY\\n"; read line; printf "GOT:%s\\n" "$line"; exit 7',
        ],
        {
          cols: 80,
          rows: 24,
          cwd: tmpdir(),
          env: { PATH: process.env.PATH ?? '' },
        },
      );
      let output = '';
      let code: number | undefined;
      child.onData((data) => {
        output += data;
      });
      child.onExit((exit) => {
        code = exit.exitCode;
      });
      try {
        await vi.waitFor(() => expect(output).toContain('READY'));
        child.resize(100, 30);
        child.write('hello\n');
        await vi.waitFor(() => expect(output).toContain('GOT:hello'));
        await vi.waitFor(() => expect(code).toBe(7));
      } finally {
        child.kill();
      }
    },
  );
});

describe('node-pty’s spawn helper', () => {
  it.skipIf(process.platform === 'win32')(
    'heals: gives a helper unpacked without its execute bit the bit back, and says so',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'conch-pty-'));
      const dir = join(root, 'prebuilds', 'darwin-arm64');
      mkdirSync(dir, { recursive: true });
      const helper = join(dir, 'spawn-helper');
      writeFileSync(helper, '#!/bin/sh\n', { mode: 0o644 });
      const notes: string[] = [];
      expect(ensureSpawnHelper(root, (m) => notes.push(m), 'darwin-arm64')).toBe(true);
      expect(statSync(helper).mode & 0o111).not.toBe(0);
      expect(notes).toHaveLength(1);
      // Already fine: nothing to say.
      expect(ensureSpawnHelper(root, (m) => notes.push(m), 'darwin-arm64')).toBe(true);
      expect(notes).toHaveLength(1);
    },
  );

  it('is fine when there is no helper (Windows, or a build without one)', () => {
    const root = mkdtempSync(join(tmpdir(), 'conch-pty-'));
    expect(ensureSpawnHelper(root, () => {}, 'linux-x64')).toBe(true);
    expect(ensureSpawnHelper(root, () => {}, 'win32-x64')).toBe(true);
  });
});
