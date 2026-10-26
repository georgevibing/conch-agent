import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type * as Sandbox from '../conversations/sandbox';
import type { TurnInput } from './types';

/** What each sealed command's runtime was handed on its stdin. */
const handed: {
  config: { network: { allowedDomains: string[] }; filesystem: Record<string, string[]> };
}[] = [];
let exitCode = 0;

vi.mock('../processes/tether', () => ({
  LINK_MODULE: 'link',
  stopTree: () => undefined,
  spawnTethered: () => {
    throw new Error('A sealed command never runs unboxed.');
  },
  spawnLinked: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new Writable({
        write(chunk: Buffer, _encoding, done) {
          handed.push(JSON.parse(chunk.toString('utf8')));
          done();
        },
        final(done) {
          done();
          setImmediate(() => child.emit('close', exitCode));
        },
      }),
    });
    return child;
  },
}));

vi.mock('../conversations/sandbox', async (original) => ({
  ...(await original<typeof Sandbox>()),
  sandboxSupport: () => ({ available: true }),
}));

const { runHostCommand } = await import('./host');
const { publishingKeys } = await import('../conversations/sandbox');

async function turn(): Promise<TurnInput> {
  const cwd = await mkdtemp(join(tmpdir(), 'conch-sealed-'));
  return {
    conversationId: 'c1',
    cwd,
    prompt: '',
    systemAppend: '',
    tools: [],
    options: { permissionMode: 'auto', effort: 'auto', fastMode: false },
    signal: new AbortController().signal,
    requestPermission: async () => 'allow',
    sandbox: { allowWrite: [cwd], denyRead: ['/conch/browser/profile'] },
    protectedPaths: ['/conch/vault'],
  };
}

describe('a sealed command on Conch’s own tools (ADR 0148)', () => {
  it('reaches the registries, code hosts and the folder’s own remotes, and no keys', async () => {
    const input = await turn();
    execFileSync('git', ['-C', input.cwd, 'init', '-q']);
    execFileSync('git', [
      '-C',
      input.cwd,
      'remote',
      'add',
      'origin',
      'https://git.example.org/a.git',
    ]);
    await runHostCommand(input, 'npm install', 30_000);
    const { config } = handed.at(-1) ?? { config: undefined };
    expect(config?.network.allowedDomains).toEqual(
      expect.arrayContaining(['github.com:443', 'crates.io:443', 'git.example.org:443']),
    );
    expect(config?.filesystem.allowWrite).toEqual(
      expect.arrayContaining([input.cwd, join(homedir(), '.npm')]),
    );
    expect(config?.filesystem.denyWrite).toContain(join(input.cwd, '.git'));
    expect(config?.filesystem.denyRead).toEqual(
      expect.arrayContaining([
        '/conch/vault',
        '/conch/browser/profile',
        join(homedir(), '.ssh'),
        ...publishingKeys().map((p) => p.path),
      ]),
    );
  });

  it('says what the box reaches when a command fails in it, so the model knows what to do', async () => {
    exitCode = 1;
    await expect(runHostCommand(await turn(), 'npm publish', 30_000)).rejects.toThrow(
      /Package registries, GitHub, GitLab, Bitbucket and this folder’s own remotes work in it[\s\S]*dangerouslyDisableSandbox: true/,
    );
    exitCode = 0;
  });
});
