import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensurePrivateNode,
  isPrivateNode,
  lowPortsAllowed,
  privateNodePath,
  setcapCommand,
  type Exec,
} from './runtime';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-runtime-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('isPrivateNode', () => {
  it('is Conch’s own only inside ~/.conch/runtime', async () => {
    const own = join(home, 'runtime', 'node-v24.1.0-linux-x64', 'bin', 'node');
    await mkdir(join(home, 'runtime', 'node-v24.1.0-linux-x64', 'bin'), { recursive: true });
    await writeFile(own, '');
    expect(await isPrivateNode(own, home)).toBe(true);
    expect(await isPrivateNode('/usr/bin/node', home)).toBe(false);
    expect(await isPrivateNode(join(home, 'runtime-evil', 'node'), home)).toBe(false);
  });
});

describe('setcapCommand', () => {
  it('names the real program, quoted when it needs to be', async () => {
    expect(await setcapCommand('/home/me/.conch/runtime/node/bin/node')).toBe(
      'sudo setcap cap_net_bind_service=+ep /home/me/.conch/runtime/node/bin/node',
    );
    expect(await setcapCommand("/home/o'neil/my node")).toBe(
      "sudo setcap cap_net_bind_service=+ep '/home/o'\\''neil/my node'",
    );
  });
});

describe('lowPortsAllowed', () => {
  const linux = { home, platform: 'linux' as const, uid: () => 1000, execPath: '/x/node' };
  it('is always yes on macOS and Windows', async () => {
    expect(await lowPortsAllowed({ home, platform: 'darwin' })).toBe(true);
    expect(await lowPortsAllowed({ home, platform: 'win32' })).toBe(true);
  });

  it('is yes for root, or when the system lets everyone', async () => {
    expect(await lowPortsAllowed({ ...linux, uid: () => 0 })).toBe(true);
    expect(await lowPortsAllowed({ ...linux, unprivilegedStart: async () => 80 })).toBe(true);
  });

  it('reads the capability from getcap', async () => {
    const exec =
      (output: string): Exec =>
      async () => ({ code: 0, stdout: output, stderr: '' });
    const base = { ...linux, unprivilegedStart: async () => 1024 };
    expect(
      await lowPortsAllowed({ ...base, exec: exec('/x/node cap_net_bind_service=ep\n') }),
    ).toBe(true);
    expect(await lowPortsAllowed({ ...base, exec: exec('') })).toBe(false);
  });
});

describe('ensurePrivateNode', () => {
  const file = 'node-v24.9.0-linux-x64.tar.gz';
  const archive = Buffer.from('pretend archive');
  const sums = (hash: string) =>
    `${'0'.repeat(64)}  node-v24.9.0-darwin-arm64.tar.gz\n${hash}  ${file}\n`;
  const fetcher = (hash: string) =>
    (async (url: string) => {
      if (url.endsWith('SHASUMS256.txt')) return new Response(sums(hash));
      if (url.endsWith(file)) return new Response(archive);
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

  it('gets Node, checks it against nodejs.org’s checksums, and points runtime/node at it', async () => {
    const calls: string[][] = [];
    const exec: Exec = async (cmd, args) => {
      calls.push([cmd, ...args]);
      await mkdir(join(home, 'runtime', 'node-v24.9.0-linux-x64', 'bin'), { recursive: true });
      return { code: 0, stdout: '', stderr: '' };
    };
    const node = await ensurePrivateNode({
      home,
      execPath: '/usr/bin/node',
      platform: 'linux',
      arch: 'x64',
      exec,
      fetch: fetcher(createHash('sha256').update(archive).digest('hex')),
    });
    expect(node).toBe(privateNodePath(home));
    expect(calls[0]?.slice(0, 2)).toEqual(['tar', '-xzf']);
    expect(await readlink(join(home, 'runtime', 'node'))).toContain('node-v24.9.0-linux-x64');
  });

  it('throws away a download that doesn’t match its checksum', async () => {
    await expect(
      ensurePrivateNode({
        home,
        execPath: '/usr/bin/node',
        platform: 'linux',
        arch: 'x64',
        exec: async () => ({ code: 0, stdout: '', stderr: '' }),
        fetch: fetcher('f'.repeat(64)),
      }),
    ).rejects.toThrow(/didn’t match its checksum/);
  });

  it('keeps a Node that’s already Conch’s own', async () => {
    const own = join(home, 'runtime', 'node', 'bin', 'node');
    await mkdir(join(home, 'runtime', 'node', 'bin'), { recursive: true });
    await writeFile(own, '');
    expect(await ensurePrivateNode({ home, execPath: own, platform: 'linux' })).toBe(own);
  });
});
