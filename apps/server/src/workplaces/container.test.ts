import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { boxArgs, Containers, IMAGE, LABEL, mount, type ContainerProgram } from './container';
import type { Exec, ExecResult } from './exec';
import { PlaceUnavailable } from './types';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'conch-box-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const ok = (output = ''): ExecResult => ({
  code: 0,
  output,
  stdout: Buffer.from(output),
  stderr: '',
  timedOut: false,
  overflow: false,
});
const fail = (stderr = 'no'): ExecResult => ({ ...ok(), code: 1, stderr, output: stderr });

const base = {
  program: 'docker' as const,
  name: 'conch-work-x',
  command: 'npm test',
  conversationId: 'c1',
  empty: '/conch/covered',
};

describe('the box', () => {
  it('is locked down: no capabilities, no new privileges, read-only, limited, nothing of this environment', () => {
    const work = temp();
    const args = boxArgs({
      ...base,
      cwd: work,
      open: false,
      forbidden: [],
      user: { uid: 501, gid: 20 },
    });
    const joined = args.join(' ');
    for (const flag of [
      '--rm',
      '--init',
      '--cap-drop ALL',
      '--security-opt no-new-privileges',
      '--read-only',
      '--pids-limit 512',
      '--memory 4g',
      '--user 501:20',
      `--label ${LABEL}=1`,
      '--network none',
    ])
      expect(joined).toContain(flag);
    // Only the two words of its own: no host variable is ever passed in.
    const envs = args.flatMap((a, i) => (args[i - 1] === '--env' ? [a] : []));
    expect(envs).toEqual(['HOME=/tmp', 'LANG=C.UTF-8']);
    expect(joined).not.toMatch(/--privileged|--env-file|docker\.sock|--network host|--pid host/);
    expect(args).toContain(mount({ type: 'bind', source: work, destination: work }));
    expect(args.slice(-4)).toEqual([IMAGE, 'sh', '-c', 'npm test']);
  });

  it('keeps .git read-only and the network off while sealed, and opens both when allowed', () => {
    const work = temp();
    mkdirSync(join(work, '.git'));
    const sealed = boxArgs({ ...base, cwd: work, open: false, forbidden: [] });
    expect(sealed).toContain(
      mount({
        type: 'bind',
        source: join(work, '.git'),
        destination: join(work, '.git'),
        readonly: true,
      }),
    );
    const open = boxArgs({ ...base, cwd: work, open: true, forbidden: [] });
    expect(open.join(' ')).not.toContain('--network none');
    expect(open.join(' ')).not.toContain(`${join(work, '.git')},readonly`);
  });

  it('covers keys that sit inside the work folder', () => {
    const work = temp();
    mkdirSync(join(work, '.ssh'));
    writeFileSync(join(work, '.netrc'), 'machine x password y');
    const args = boxArgs({
      ...base,
      cwd: work,
      open: true,
      forbidden: [join(work, '.ssh'), join(work, '.netrc'), '/elsewhere/.aws'],
    });
    expect(args).toContain(
      mount({ type: 'tmpfs', destination: join(work, '.ssh'), 'tmpfs-size': '1m' }),
    );
    expect(args).toContain(
      mount({
        type: 'bind',
        source: '/conch/covered',
        destination: join(work, '.netrc'),
        readonly: true,
      }),
    );
    expect(args.join(' ')).not.toContain('.aws');
  });

  it('quotes a path with a comma, so it can’t add a mount option of its own', () => {
    expect(mount({ type: 'bind', source: '/a,readonly=false,b', destination: '/w' })).toBe(
      'type=bind,"source=/a,readonly=false,b",destination=/w',
    );
  });

  it('uses Podman’s own user mapping', () => {
    const args = boxArgs({
      ...base,
      program: 'podman',
      cwd: temp(),
      open: false,
      forbidden: [],
      user: { uid: 1, gid: 1 },
    });
    expect(args.join(' ')).toContain('--userns keep-id');
    expect(args).not.toContain('--user');
  });
});

/** A pretend Docker: answers by what it's asked, and remembers every call. */
function fakeDocker(answers: (args: string[]) => ExecResult | Promise<ExecResult>) {
  const calls: string[][] = [];
  const exec: Exec = async (_program, args, options) => {
    calls.push(args);
    if (options?.signal?.aborted) throw new Error('Stopped.');
    return answers(args);
  };
  return { exec, calls };
}

const docker: ContainerProgram = { kind: 'docker', path: '/usr/local/bin/docker' };
const request = (cwd: string, signal = AbortSignal.timeout(10_000)) => ({
  command: 'echo hi',
  cwd,
  timeoutMs: 10_000,
  open: false,
  signal,
  conversationId: 'c1',
  forbidden: [],
});

describe('the container engine', () => {
  it('asks for Docker or Podman as a need, never “couldn’t find”', async () => {
    const containers = new Containers({ dir: temp(), find: async () => undefined });
    await expect(containers.run(request(temp()))).rejects.toMatchObject({ need: 'container' });
    expect(await containers.look()).toMatchObject({ state: 'needs-setup', need: 'container' });
  });

  it('wakes an engine that’s asleep, fetches the box once, says so quietly, then runs', async () => {
    let up = false;
    const healed: string[] = [];
    const { exec, calls } = fakeDocker((args) => {
      if (args[0] === 'info') return up ? ok('27.0') : fail('Cannot connect to the Docker daemon');
      if (args[0] === 'machine') {
        up = true;
        return ok();
      }
      if (args[0] === 'image') return fail('No such image');
      if (args[0] === 'pull') return ok();
      if (args[0] === 'run') return ok('hi\n');
      return ok();
    });
    const containers = new Containers({
      dir: temp(),
      exec,
      find: async () => ({ kind: 'podman', path: '/opt/podman/bin/podman' }),
      os: 'darwin',
      heal: (m) => healed.push(m),
      sleep: async () => undefined,
    });
    const result = await containers.run(request(temp()));
    expect(result).toMatchObject({ code: 0, output: 'hi\n' });
    expect(calls.map((c) => c[0])).toEqual(['info', 'machine', 'info', 'image', 'pull', 'run']);
    expect(healed).toEqual(['Started Podman’s machine', 'Got the container’s system ready']);
    // Ready now: the next command goes straight in.
    await containers.run(request(temp()));
    expect(calls.at(-1)?.[0]).toBe('run');
    expect(calls.filter((c) => c[0] === 'pull')).toHaveLength(1);
  });

  it('says what to do when the engine won’t start', async () => {
    const { exec } = fakeDocker((args) => (args[0] === 'info' ? fail() : ok()));
    const containers = new Containers({ dir: temp(), exec, find: async () => docker, os: 'linux' });
    const failure = containers.run(request(temp()));
    await expect(failure).rejects.toBeInstanceOf(PlaceUnavailable);
    await expect(failure).rejects.toThrow(/sudo systemctl start docker/);
  });

  it('removes the box when the command is stopped or runs out of time', async () => {
    const stop = new AbortController();
    const { exec, calls } = fakeDocker(async (args) => {
      if (args[0] === 'run') {
        stop.abort();
        return { ...ok(), timedOut: true, code: null };
      }
      return ok();
    });
    const containers = new Containers({ dir: temp(), exec, find: async () => docker });
    await containers.run(request(temp(), stop.signal)).catch(() => undefined);
    const run = calls.find((c) => c[0] === 'run') ?? [];
    const name = run[run.indexOf('--name') + 1];
    expect(calls).toContainEqual(['rm', '--force', name]);
  });

  it('clears boxes a crash left behind, and only Conch’s', async () => {
    const { exec, calls } = fakeDocker((args) =>
      args[0] === 'ps' ? ok('0123456789ab\nnot-an-id\nfedcba987654\n') : ok(),
    );
    const containers = new Containers({ dir: temp(), exec, find: async () => docker });
    expect(await containers.sweep()).toBe(2);
    expect(calls.find((c) => c[0] === 'ps')).toEqual([
      'ps',
      '--all',
      '--quiet',
      '--filter',
      `label=${LABEL}=1`,
    ]);
    expect(calls.at(-1)).toEqual(['rm', '--force', '0123456789ab', 'fedcba987654']);
  });
});
