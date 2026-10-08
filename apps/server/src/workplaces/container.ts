/**
 * A container on this computer (ADR 0106): every command in a fresh,
 * locked-down box that sees only the work folder. Docker or Podman, whichever
 * is here; Docker Desktop, OrbStack and Podman's machine are woken when asleep.
 *
 * The box, after OpenClaw's and Hermes's defaults and the OWASP Docker
 * Security Cheat Sheet: no capabilities, no new privileges, a read-only
 * system, your own user id, limits on memory, processes and CPUs, nothing of
 * this computer's environment, and the work folder mounted at the same path,
 * so paths mean the same in and out. Sealed commands get no network and a
 * read-only `.git`, as on this computer; your keys and Conch's are covered
 * even when they sit inside the work folder.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { cpus, homedir, platform } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { WorkedAt } from '@conch/protocol';

import { findExecutable } from '../lib/proc';
import { exec as realExec, type Exec } from './exec';
import { PlaceUnavailable, type RunRequest, type RunResult, type WorkPlace } from './types';

/** An official image with Git, Node, Python and a compiler: what most work needs, nothing more. */
export const IMAGE = 'docker.io/library/node:24-bookworm';
/** Every box Conch starts wears this, so one left behind by a crash is found and removed. */
export const LABEL = 'conch.work';

export interface ContainerProgram {
  kind: 'docker' | 'podman';
  path: string;
}

/** Where Docker Desktop, OrbStack, Rancher Desktop and Podman keep their programs. */
function containerDirs(): string[] {
  const home = homedir();
  return [
    '/Applications/Docker.app/Contents/Resources/bin',
    join(home, '.orbstack', 'bin'),
    join(home, '.rd', 'bin'),
    '/opt/podman/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(
      process.env.ProgramFiles ?? join('C:', 'Program Files'),
      'Docker',
      'Docker',
      'resources',
      'bin',
    ),
    join(process.env.ProgramFiles ?? join('C:', 'Program Files'), 'RedHat', 'Podman'),
  ];
}

/** Docker first (it's what most people have), then Podman. */
export async function findContainerProgram(): Promise<ContainerProgram | undefined> {
  const dirs = containerDirs();
  const docker = await findExecutable('docker', { extraDirs: dirs });
  if (docker) return { kind: 'docker', path: docker };
  const podman = await findExecutable('podman', { extraDirs: dirs });
  return podman ? { kind: 'podman', path: podman } : undefined;
}

/**
 * What the container program itself needs to find its engine: never anything
 * for the box. Nothing of this environment goes inside it.
 */
export function programEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [
    'PATH',
    'HOME',
    'USER',
    'LANG',
    'TMPDIR',
    'SystemRoot',
    'WINDIR',
    'XDG_RUNTIME_DIR',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CERT_PATH',
    'DOCKER_TLS_VERIFY',
    'CONTAINER_HOST',
    'CONTAINER_CONNECTION',
  ]) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

/** A `--mount` value, read as CSV by Docker and Podman: a field with a comma is quoted. */
export function mount(fields: Record<string, string | true>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      const field = value === true ? key : `${key}=${value}`;
      return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
    })
    .join(',');
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};

export interface BoxOptions {
  program: ContainerProgram['kind'];
  name: string;
  cwd: string;
  command: string;
  open: boolean;
  conversationId: string;
  /** Places to cover inside the work folder (your keys, Conch's). */
  forbidden: readonly string[];
  /** Your user and group, so files made in the box are yours. Unset on Windows. */
  user?: { uid: number; gid: number };
  /** Where the work folder is inside: the same path, but on Windows. */
  target?: string;
  /** Is this path a folder (tests pass their own). */
  isDir?: (path: string) => boolean;
  cpus?: number;
  /** An empty file to cover a key file with (`emptyFile`). */
  empty: string;
}

/**
 * An empty, read-only file of Conch's own (in its home, which Docker Desktop
 * shares where it wouldn't share `/dev/null`), laid over a key file inside the
 * work folder. Never in a shared temporary folder, where someone else could
 * have put a file of their own first.
 */
export function emptyFile(dir: string): string {
  const path = join(dir, 'covered');
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(path, '', { mode: 0o444 });
  }
  return path;
}

/** The arguments for one command's box. Every flag here is part of the seal: see the file's note. */
export function boxArgs(options: BoxOptions): string[] {
  const target = options.target ?? options.cwd;
  const isDir =
    options.isDir ??
    ((path: string) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
  const at = (path: string) =>
    target === options.cwd ? path : join(target, relative(options.cwd, path)).replaceAll('\\', '/');
  const covers: string[] = [];
  for (const place of options.forbidden) {
    if (!inside(options.cwd, place) || !existsSync(place)) continue;
    covers.push(
      ...(isDir(place)
        ? ['--mount', mount({ type: 'tmpfs', destination: at(place), 'tmpfs-size': '1m' })]
        : [
            '--mount',
            mount({ type: 'bind', source: options.empty, destination: at(place), readonly: true }),
          ]),
    );
  }
  const git = join(options.cwd, '.git');
  return [
    'run',
    '--rm',
    '--interactive',
    '--init',
    '--name',
    options.name,
    '--label',
    `${LABEL}=1`,
    '--label',
    `conch.chat=${options.conversationId}`,
    // Open: the engine's own default network. Sealed: none at all.
    ...(options.open ? [] : ['--network', 'none']),
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,exec,nosuid,size=2g,mode=1777',
    '--pids-limit',
    '512',
    '--memory',
    '4g',
    '--cpus',
    String(Math.max(1, Math.min(2, options.cpus ?? cpus().length))),
    ...(options.program === 'podman'
      ? ['--userns', 'keep-id']
      : options.user
        ? ['--user', `${options.user.uid}:${options.user.gid}`]
        : []),
    '--env',
    'HOME=/tmp',
    '--env',
    'LANG=C.UTF-8',
    '--mount',
    mount({ type: 'bind', source: options.cwd, destination: target }),
    // Sealed, `.git` is read-only, as the sealed box on this computer keeps it: no hooks planted.
    ...(!options.open && isDir(git)
      ? ['--mount', mount({ type: 'bind', source: git, destination: at(git), readonly: true })]
      : []),
    ...covers,
    '--workdir',
    target,
    IMAGE,
    'sh',
    '-c',
    options.command,
  ];
}

export interface ContainerDeps {
  /** Conch's own folder for places (`<home>/workplaces`). */
  dir: string;
  exec?: Exec;
  find?: () => Promise<ContainerProgram | undefined>;
  /** A quiet note under Health → Fixed on its own. */
  heal?: (message: string) => void;
  os?: NodeJS.Platform;
  /** How long to wait for an engine that's waking up. */
  wakeMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

type Readiness =
  | { state: 'ready'; program: ContainerProgram }
  | { state: 'needs-setup' | 'unavailable' | 'preparing'; message: string; need?: string };

/** The container engine on this computer: found, woken, and its box fetched once. */
export class Containers {
  readonly #exec: Exec;
  readonly #find: () => Promise<ContainerProgram | undefined>;
  readonly #os: NodeJS.Platform;
  #ready?: { until: number; program: ContainerProgram };
  #preparing?: Promise<ContainerProgram>;
  #last?: Readiness;

  constructor(private readonly deps: ContainerDeps) {
    this.#exec = deps.exec ?? realExec;
    this.#find = deps.find ?? findContainerProgram;
    this.#os = deps.os ?? platform();
  }

  async #engineUp(program: ContainerProgram, signal?: AbortSignal): Promise<boolean> {
    const result = await this.#exec(program.path, ['info', '--format', '{{.ServerVersion}}'], {
      env: programEnv(),
      timeoutMs: 10_000,
      ...(signal && { signal }),
    }).catch(() => undefined);
    return result?.code === 0;
  }

  /** Wake an engine that's installed but asleep: the app on a Mac, Podman's machine. */
  async #wake(program: ContainerProgram, signal?: AbortSignal): Promise<string | undefined> {
    const env = programEnv();
    if (program.kind === 'podman' && this.#os !== 'linux') {
      const started = await this.#exec(program.path, ['machine', 'start'], {
        env,
        timeoutMs: 300_000,
        ...(signal && { signal }),
      }).catch(() => undefined);
      if (started?.code !== 0) {
        // No machine yet: make Podman's own, then start it (a one-time download).
        const made = await this.#exec(program.path, ['machine', 'init', '--now'], {
          env,
          timeoutMs: 900_000,
          ...(signal && { signal }),
        }).catch(() => undefined);
        if (made?.code !== 0) return undefined;
        return 'Set up Podman’s machine for containers';
      }
      return 'Started Podman’s machine';
    }
    if (program.kind === 'docker' && this.#os === 'darwin') {
      const app = ['/Applications/OrbStack.app', '/Applications/Docker.app'].find(existsSync);
      if (!app) return undefined;
      await this.#exec('/usr/bin/open', ['-g', '-a', app], { env, timeoutMs: 15_000 }).catch(
        () => undefined,
      );
      return `Started ${app.includes('OrbStack') ? 'OrbStack' : 'Docker'}`;
    }
    if (program.kind === 'docker' && this.#os === 'win32') {
      const app = join(
        process.env.ProgramFiles ?? 'C:\\Program Files',
        'Docker',
        'Docker',
        'Docker Desktop.exe',
      );
      if (!existsSync(app)) return undefined;
      await this.#exec('cmd.exe', ['/c', 'start', '', app], { env, timeoutMs: 15_000 }).catch(
        () => undefined,
      );
      return 'Started Docker';
    }
    return undefined;
  }

  async #prepare(signal?: AbortSignal): Promise<ContainerProgram> {
    const program = await this.#find();
    if (!program)
      throw new PlaceUnavailable(
        'Running work in a container needs Docker or Podman.',
        'container',
      );
    if (!(await this.#engineUp(program, signal))) {
      this.#last = {
        state: 'preparing',
        message: `Starting ${program.kind === 'docker' ? 'Docker' : 'Podman'}…`,
      };
      const woke = await this.#wake(program, signal);
      const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
      const until = Date.now() + (this.deps.wakeMs ?? 90_000);
      let up = false;
      while (woke && !up && Date.now() < until) {
        signal?.throwIfAborted();
        await sleep(2_000);
        up = await this.#engineUp(program, signal);
      }
      if (!up)
        throw new PlaceUnavailable(
          this.#os === 'linux' && program.kind === 'docker'
            ? 'Docker is installed but not running. Start it once with: sudo systemctl start docker'
            : `${program.kind === 'docker' ? 'Docker' : 'Podman'} is installed but isn’t starting. Open it once, then try again.`,
        );
      if (woke) this.deps.heal?.(woke);
    }
    const env = programEnv();
    const has = await this.#exec(program.path, ['image', 'inspect', IMAGE], {
      env,
      timeoutMs: 15_000,
      ...(signal && { signal }),
    }).catch(() => undefined);
    if (has?.code !== 0) {
      this.#last = { state: 'preparing', message: 'Getting the box ready, the first time only…' };
      const pulled = await this.#exec(program.path, ['pull', '--quiet', IMAGE], {
        env,
        timeoutMs: 1_200_000,
        ...(signal && { signal }),
      });
      if (pulled.code !== 0)
        throw new PlaceUnavailable(
          `Couldn’t fetch the container’s system: ${pulled.stderr.trim().slice(-200) || 'no answer'}. Check the internet connection.`,
        );
      this.deps.heal?.('Got the container’s system ready');
    }
    return program;
  }

  /** The program, ready for a box: found, awake, its image here. Shared by everyone waiting. */
  async ready(signal?: AbortSignal): Promise<ContainerProgram> {
    if (this.#ready && this.#ready.until > Date.now()) return this.#ready.program;
    this.#preparing ??= this.#prepare(signal).finally(() => (this.#preparing = undefined));
    try {
      const program = await this.#preparing;
      this.#ready = { until: Date.now() + 60_000, program };
      this.#last = { state: 'ready', program };
      return program;
    } catch (error) {
      this.#ready = undefined;
      this.#last =
        error instanceof PlaceUnavailable
          ? {
              state: error.need ? 'needs-setup' : 'unavailable',
              message: error.message,
              ...(error.need && { need: error.need }),
            }
          : { state: 'unavailable', message: 'The container program didn’t answer.' };
      throw error;
    }
  }

  /** Where it stands, cheaply: never wakes or fetches anything. */
  async look(): Promise<Readiness> {
    if (this.#preparing && this.#last?.state === 'preparing') return this.#last;
    if (this.#ready && this.#ready.until > Date.now())
      return { state: 'ready', program: this.#ready.program };
    const program = await this.#find();
    if (!program)
      return {
        state: 'needs-setup',
        message: 'Needs Docker or Podman on this computer.',
        need: 'container',
      };
    // Asleep is fine: it's woken when a command needs it.
    return { state: 'ready', program };
  }

  /** Boxes left behind by a crash or a forced stop, removed. Says how many. */
  async sweep(): Promise<number> {
    const program = await this.#find();
    if (!program || !(await this.#engineUp(program))) return 0;
    const env = programEnv();
    const listed = await this.#exec(
      program.path,
      ['ps', '--all', '--quiet', '--filter', `label=${LABEL}=1`],
      { env, timeoutMs: 15_000 },
    ).catch(() => undefined);
    const ids = (listed?.output ?? '').split(/\s+/).filter((id) => /^[0-9a-f]{12,64}$/.test(id));
    if (!ids.length) return 0;
    await this.#exec(program.path, ['rm', '--force', ...ids], { env, timeoutMs: 30_000 }).catch(
      () => undefined,
    );
    return ids.length;
  }

  /** One command in its own box. */
  async run(request: RunRequest): Promise<RunResult> {
    const program = await this.ready(request.signal);
    const name = `conch-work-${randomBytes(6).toString('hex')}`;
    const env = programEnv();
    const remove = () =>
      void this.#exec(program.path, ['rm', '--force', name], { env, timeoutMs: 30_000 }).catch(
        () => undefined,
      );
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    const args = boxArgs({
      program: program.kind,
      name,
      cwd: request.cwd,
      command: request.command,
      open: request.open,
      conversationId: request.conversationId,
      forbidden: request.forbidden,
      empty: emptyFile(this.deps.dir),
      ...(uid !== undefined && gid !== undefined && { user: { uid, gid } }),
      ...(this.#os === 'win32' && { target: '/work' }),
    });
    // Stopping the program doesn't always stop its box: remove the box too.
    request.signal.addEventListener('abort', remove, { once: true });
    try {
      const result = await this.#exec(program.path, args, {
        env,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      });
      if (result.timedOut) remove();
      return { code: result.code, output: result.output, timedOut: result.timedOut };
    } finally {
      request.signal.removeEventListener('abort', remove);
    }
  }
}

/** A chat's container: the shared engine, said as "a container". */
export function containerPlace(containers: Containers): WorkPlace {
  const where: WorkedAt = { kind: 'container', name: 'a container' };
  return {
    id: 'container',
    kind: 'container',
    where,
    seals: true,
    about:
      'Commands run in a fresh, locked-down container on this computer (Linux, with Git, Node and Python; no administrator rights, so no system packages). It sees only the work folder, at the same path; the person’s keys and settings aren’t in it, and files outside the work folder are gone after each command. Sealed, it has no network and .git is read-only; set dangerouslyDisableSandbox: true for a command that needs the network or to change .git (it is asked first unless the person chose Full trust). Install a project’s dependencies inside the work folder (npm install, python -m venv .venv).',
    run: (request) => containers.run(request),
  };
}
