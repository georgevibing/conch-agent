import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureSpawnHelper } from './backend';

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
