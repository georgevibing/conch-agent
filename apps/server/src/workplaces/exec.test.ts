import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cleanUp, gone, standInGateway, until } from '../test/gateway';
import { exec } from './exec';

const posix = process.platform !== 'win32';

describe('running a program for a place', () => {
  it.skipIf(!posix)('hands it stdin and gives back its output and exit code', async () => {
    const result = await exec('/bin/sh', ['-c', 'cat; echo oops >&2; exit 4'], {
      stdin: 'data in',
      maxStdout: 1024,
    });
    expect(result).toMatchObject({ code: 4, stderr: 'oops\n', timedOut: false });
    expect(result.stdout.toString()).toBe('data in');
    expect(result.output).toContain('oops');
  });

  it('fails as spawn does for a program that isn’t there', async () => {
    await expect(exec('conch-no-such-program', [])).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(!posix)('stops a program that runs too long', async () => {
    const result = await exec('/bin/sh', ['-c', 'sleep 30'], { timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
  });

  it.skipIf(!posix)('ends the program and what it started when its gateway goes away', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-exec-'));
    const gateway = standInGateway(`
        import { exec } from './src/workplaces/exec.ts';
        await exec('/bin/sh', ['-c', 'sleep 300 & echo "$$ $!" > pids; wait'], { cwd: ${JSON.stringify(dir)} });
      `);
    let pids: number[] = [];
    try {
      const text = await until(
        () => readFile(join(dir, 'pids'), 'utf8').catch(() => ''),
        (t) => /^\d+ \d+\n/.test(t),
      ).catch((error: Error) => {
        throw new Error(`${error.message}\n${gateway.output()}`);
      });
      pids = text.trim().split(' ').map(Number);
      for (const pid of pids) expect(await gone(pid)).toBe(false);
      await gateway.crash();
      for (const pid of pids) await until(() => gone(pid), Boolean);
    } finally {
      await gateway.crash();
      cleanUp(...pids);
    }
  });
});
