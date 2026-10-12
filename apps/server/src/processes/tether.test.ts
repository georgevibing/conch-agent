import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
import type { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { cleanUp, gone, until } from '../test/gateway';
import { spawnLinked, spawnTethered, stopTree } from './tether';

const posix = process.platform !== 'win32';

function run(child: ChildProcess) {
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const ended = new Promise<{ code: number | null; error?: NodeJS.ErrnoException }>((done) => {
    child.once('error', (error) => done({ code: null, error }));
    child.once('close', (code) => done({ code }));
  });
  return { ended, output: () => output };
}

describe('commands tied to their gateway', () => {
  it.skipIf(!posix)(
    'passes input, output and the exit code through, with only the given variables',
    async () => {
      const child = spawnTethered('/bin/sh', ['-c', 'cat; env; exit 3'], {
        env: { PATH: process.env.PATH ?? '', GIVEN: 'yes' },
        stdin: 'pipe',
      });
      const { ended, output } = run(child);
      child.stdin?.end('typed\n');
      expect((await ended).code).toBe(3);
      expect(output()).toContain('typed');
      expect(output()).toContain('GIVEN=yes');
      expect(output()).not.toContain('__CF_USER_TEXT_ENCODING');
      expect(output()).not.toContain('HOME=');
    },
  );

  it.skipIf(!posix)('runs a line through the shell and ends as its signal ended it', async () => {
    const child = spawnTethered('echo "$GIVEN"; kill -TERM $$', [], {
      env: { PATH: process.env.PATH ?? '', GIVEN: 'through sh' },
      shell: '/bin/sh',
      stdin: 'ignore',
    });
    const { ended, output } = run(child);
    expect((await ended).code).toBeNull();
    expect(child.signalCode).toBe('SIGTERM');
    expect(output()).toContain('through sh');
  });

  it.skipIf(!posix)("never opens Node's debugger when the command sends SIGUSR1", async () => {
    // To the runtime that holds it, then to itself: dying of it made the runtime re-raise it.
    const poke = spawnTethered('kill -USR1 $PPID; sleep 0.3; echo poked', [], {
      env: { PATH: process.env.PATH ?? '' },
      shell: '/bin/sh',
      stdin: 'ignore',
    });
    const poked = run(poke);
    expect((await poked.ended).code).toBe(0);
    expect(poked.output()).toContain('poked');
    const dies = spawnTethered('kill -USR1 $$', [], {
      env: { PATH: process.env.PATH ?? '' },
      shell: '/bin/sh',
      stdin: 'ignore',
    });
    const died = run(dies);
    expect((await died.ended).code).toBe(128 + constants.signals.SIGUSR1);
    // The sandbox's runtime (engines/host.ts) is a linked one too.
    const worker = spawnLinked(
      ['-e', "process.kill(process.pid, 'SIGUSR1'); setTimeout(() => {}, 300)"],
      { env: { PATH: process.env.PATH ?? '' }, stdin: 'ignore' },
    );
    const own = run(worker);
    expect((await own.ended).code).toBe(0);
    for (const output of [poked.output(), died.output(), own.output()])
      expect(output).not.toContain('Debugger listening');
  });

  it('reports a program that cannot start as spawn does', async () => {
    const child = spawnTethered('conch-no-such-program', [], { env: {}, stdin: 'ignore' });
    const { ended } = run(child);
    expect((await ended).error?.code).toBe('ENOENT');
  });

  it.skipIf(!posix)(
    'kills the command and what it started when the gateway pipe closes',
    async () => {
      const child = spawnTethered('/bin/sh', ['-c', 'sleep 300 & echo "$$ $!"; wait'], {
        env: { PATH: process.env.PATH ?? '' },
        stdin: 'ignore',
      });
      const { ended, output } = run(child);
      let pids: number[] = [];
      try {
        await until(
          async () => output(),
          (text) => /\d+ \d+/.test(text),
        );
        pids = output().trim().split(' ').map(Number);
        // What the gateway's death does to the pipe: its end closes.
        (child.stdio[3] as Readable).destroy();
        await ended;
        for (const pid of pids) await until(() => gone(pid), Boolean);
      } finally {
        cleanUp(child.pid, ...pids);
      }
    },
  );

  it.skipIf(!posix)('stops the whole tree on request', async () => {
    const child = spawnTethered('/bin/sh', ['-c', 'sleep 300 & echo "$$ $!"; wait'], {
      env: { PATH: process.env.PATH ?? '' },
      stdin: 'ignore',
    });
    const { ended, output } = run(child);
    let pids: number[] = [];
    try {
      await until(
        async () => output(),
        (text) => /\d+ \d+/.test(text),
      );
      pids = output().trim().split(' ').map(Number);
      stopTree(child);
      await ended;
      expect(child.signalCode).toBe('SIGKILL');
      for (const pid of pids) await until(() => gone(pid), Boolean);
    } finally {
      cleanUp(child.pid, ...pids);
    }
  });
});
