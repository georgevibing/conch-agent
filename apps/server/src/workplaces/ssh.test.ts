import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { exec, type Exec } from './exec';
import { hostsIn, sshHosts, SshMachines, sshOptions, sshProblem } from './ssh';
import { PlaceUnavailable } from './types';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'conch-ssh-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('machines in your SSH settings', () => {
  it('lists named machines once, never a pattern or a name that reads as an option', () => {
    const text = [
      'Host *',
      '  ForwardAgent yes',
      'Host build-box pi.local # the Pi',
      'host=gpu',
      'Host !bad *.corp -oProxyCommand=evil build-box',
      'Match host x',
    ].join('\n');
    expect(hostsIn(text)).toEqual(['build-box', 'pi.local', 'gpu']);
  });

  it('follows Include, a star in the last part', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'config.d'));
    writeFileSync(join(dir, 'config'), 'Include config.d/*\nHost main\n');
    writeFileSync(join(dir, 'config.d', 'work'), 'Host work-vm\n');
    expect(await sshHosts(join(dir, 'config'))).toEqual(['work-vm', 'main']);
  });

  it('forwards nothing, never asks for a password, and ends options before the machine', () => {
    const options = sshOptions('/c/%C');
    for (const o of [
      'BatchMode=yes',
      'ForwardAgent=no',
      'ForwardX11=no',
      'ClearAllForwardings=yes',
      'PermitLocalCommand=no',
    ])
      expect(options).toContain(o);
  });

  it('says what went wrong in words, with the next step', () => {
    expect(sshProblem('box', 'Host key verification failed.')).toMatch(
      /Connect once from a terminal \(ssh box\)/,
    );
    expect(sshProblem('box', 'Permission denied (publickey).')).toMatch(/didn’t accept your key/);
    expect(sshProblem('box', 'ssh: connect to host box port 22: Operation timed out')).toMatch(
      /isn’t answering/,
    );
  });
});

describe('running on a machine', () => {
  it('refuses a machine that isn’t in your SSH settings', async () => {
    const machines = new SshMachines({
      dir: temp(),
      hosts: async () => ['box'],
      findSsh: async () => '/usr/bin/ssh',
    });
    await expect(
      machines.run('other', {
        command: 'true',
        cwd: temp(),
        timeoutMs: 1000,
        open: true,
        signal: AbortSignal.timeout(5000),
        conversationId: 'c1',
        forbidden: [],
      }),
    ).rejects.toBeInstanceOf(PlaceUnavailable);
  });

  it('copies the work there, runs the command, brings back what it made', async () => {
    const home = temp();
    const work = temp();
    writeFileSync(join(work, 'in.txt'), 'input');
    const seen: string[][] = [];
    // A pretend `ssh`: runs the remote command with this computer's shell, its home a temp folder.
    const fake: Exec = (program, args, options) => {
      seen.push(args);
      const at = args.indexOf('--');
      const remote = args[at + 2] ?? '';
      return exec('/bin/sh', ['-c', remote], {
        ...options,
        env: { PATH: process.env.PATH ?? '', HOME: home },
      });
    };
    const machines = new SshMachines({
      dir: temp(),
      exec: fake,
      hosts: async () => ['box'],
      findSsh: async () => '/usr/bin/ssh',
    });
    const result = await machines.run('box', {
      command: 'cat in.txt > out.txt && echo done',
      cwd: work,
      timeoutMs: 10_000,
      open: true,
      signal: AbortSignal.timeout(20_000),
      conversationId: 'c1',
      forbidden: [],
    });
    expect(result.output.trim()).toBe('done');
    expect(result.note).toMatch(/1 changed file came back/);
    expect(readFileSync(join(work, 'out.txt'), 'utf8')).toBe('input');
    // Every connection: the machine after `--`, our options before it.
    for (const args of seen) {
      expect(args[args.indexOf('--') + 1]).toBe('box');
      expect(args.slice(0, args.indexOf('--'))).toContain('ForwardAgent=no');
    }
  });

  it('turns a lost connection into words the person can act on', async () => {
    const fake: Exec = async () => ({
      code: 255,
      output: '',
      stdout: Buffer.alloc(0),
      stderr: 'Host key verification failed.',
      timedOut: false,
      overflow: false,
    });
    const machines = new SshMachines({
      dir: temp(),
      exec: fake,
      hosts: async () => ['box'],
      findSsh: async () => '/usr/bin/ssh',
    });
    await expect(
      machines.run('box', {
        command: 'true',
        cwd: temp(),
        timeoutMs: 1000,
        open: true,
        signal: AbortSignal.timeout(5000),
        conversationId: 'c1',
        forbidden: [],
      }),
    ).rejects.toThrow(/hasn’t met box yet/);
  });
});
