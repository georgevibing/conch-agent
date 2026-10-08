/**
 * A machine you already reach with SSH (ADR 0106): named in your own SSH
 * settings (`~/.ssh/config`), never typed. Each chat has its copy of the work
 * folder there (`~/.conch-work/<chat>`), brought up to date before each command
 * and brought back after it (`mirror.ts`).
 *
 * Conch runs your own `ssh`, with your keys and your agent, never asking for a
 * password (`BatchMode`). It forwards nothing: no agent, no X11, no ports, so
 * a command there can't borrow your keys to reach a third machine.
 */
import { mkdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { findExecutable } from '../lib/proc';
import { exec as realExec, shq, type Exec, type ExecResult } from './exec';
import { Mirror, MirrorError, type Remote } from './mirror';
import { PlaceUnavailable, type RunRequest, type RunResult, type WorkPlace } from './types';

/** A machine's name as `ssh` may be handed it: never something that reads as an option. */
const HOST_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

/** The machines named in SSH settings: `Host` lines without patterns, in order, once each. */
export function hostsIn(text: string): string[] {
  const hosts: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^host(?:\s+|\s*=\s*)(.+)$/i.exec(line);
    if (!match?.[1]) continue;
    for (const name of match[1].split(/\s+/)) {
      if (/[*?!]/.test(name) || !HOST_NAME.test(name) || hosts.includes(name)) continue;
      hosts.push(name);
    }
  }
  return hosts;
}

/** The files an `Include` line names, relative to `~/.ssh`; a `*` only in the last part. */
async function included(line: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const pattern of line.split(/\s+/).filter(Boolean)) {
    const path = pattern.startsWith('~/')
      ? join(homedir(), pattern.slice(2))
      : isAbsolute(pattern)
        ? pattern
        : join(base, pattern);
    const name = basename(path);
    if (!name.includes('*')) {
      out.push(path);
      continue;
    }
    const re = new RegExp(`^${name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);
    const files = await readdir(dirname(path)).catch(() => []);
    out.push(...files.filter((f) => re.test(f)).map((f) => join(dirname(path), f)));
  }
  return out;
}

/** Every machine in your SSH settings, following `Include`s (two levels, no more). */
export async function sshHosts(file = join(homedir(), '.ssh', 'config')): Promise<string[]> {
  const base = dirname(file);
  const seen = new Set<string>();
  const read = async (path: string, depth: number): Promise<string> => {
    if (depth > 2 || seen.has(path)) return '';
    seen.add(path);
    const text = await readFile(path, 'utf8').catch(() => '');
    const parts: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const include = /^\s*include\s+(.+)$/i.exec(line);
      if (include?.[1])
        for (const inner of await included(include[1].trim(), base))
          parts.push(await read(inner, depth + 1));
      else parts.push(line);
    }
    return parts.join('\n');
  };
  return hostsIn(await read(file, 0));
}

/**
 * The options every connection gets. Asked first on the command line, so they
 * win over anything in the settings file (the first value `ssh` reads holds).
 */
export function sshOptions(control?: string): string[] {
  return [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=4',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ForwardX11=no',
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'LogLevel=ERROR',
    ...(control
      ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${control}`, '-o', 'ControlPersist=120']
      : []),
  ];
}

/** What `ssh` itself needs: your agent for your keys, nothing for the machine. */
function sshEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LANG', 'SSH_AUTH_SOCK', 'SystemRoot', 'WINDIR']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

/** What went wrong with a connection, in words, from what `ssh` said. */
export function sshProblem(host: string, stderr: string): string {
  const said = stderr.trim();
  if (/host key verification failed|no .* host key is known/i.test(said))
    return `This computer hasn’t met ${host} yet. Connect once from a terminal (ssh ${host}) and accept its key, then try again.`;
  if (/permission denied/i.test(said))
    return `${host} didn’t accept your key without a password. Add your key to its authorized keys, or to your SSH agent.`;
  if (/could not resolve|name or service not known|nodename nor servname/i.test(said))
    return `${host} can’t be found on the network. Check its name in your SSH settings.`;
  if (/timed out|no route|connection refused|network is unreachable/i.test(said))
    return `${host} isn’t answering. It may be asleep or off the network.`;
  return `Couldn’t reach ${host}${said ? `: ${said.slice(-200)}` : ''}.`;
}

export interface SshDeps {
  /** Conch's folder for places; the connection sockets live in `ssh/` under it. */
  dir: string;
  exec?: Exec;
  findSsh?: () => Promise<string | undefined>;
  hosts?: () => Promise<string[]>;
}

/** Ids that name a chat's copy there: already checked as ids, checked again as a folder name. */
const copyName = (conversationId: string) =>
  /^[A-Za-z0-9_-]{1,128}$/.test(conversationId) ? conversationId : 'chat';

/** Your SSH machines, each with every chat's copy on it. */
export class SshMachines {
  readonly #exec: Exec;
  readonly #mirrors = new Map<string, Mirror>();
  #looks = new Map<string, { until: number; ok: boolean; message?: string }>();

  constructor(private readonly deps: SshDeps) {
    this.#exec = deps.exec ?? realExec;
  }

  hosts(): Promise<string[]> {
    return (this.deps.hosts ?? sshHosts)();
  }

  async #ssh(): Promise<string> {
    const ssh = await (this.deps.findSsh ?? (() => findExecutable('ssh')))();
    if (!ssh)
      throw new PlaceUnavailable('Running work on another machine needs SSH on this computer.');
    return ssh;
  }

  /** Short enough for a socket's name (macOS allows 104 bytes): otherwise no shared connection. */
  #control(): string | undefined {
    const dir = join(this.deps.dir, 'ssh');
    const path = join(dir, '%C');
    if (path.length + 40 > 100) return undefined;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return path;
  }

  /** The machine as a `Remote`: a POSIX shell script over `ssh`. */
  remote(host: string): Remote {
    return {
      sh: async (script, options) => {
        const ssh = await this.#ssh();
        const result = await this.#exec(
          ssh,
          [...sshOptions(this.#control()), '--', host, `sh -c ${shq(script)}`],
          {
            env: sshEnv(),
            timeoutMs: options.timeoutMs,
            signal: options.signal,
            ...(options.stdin && { stdin: options.stdin }),
            ...(options.binary && { maxStdout: 1024 ** 3 }),
          },
        );
        if (result.code === 255) throw new PlaceUnavailable(sshProblem(host, result.stderr));
        return result;
      },
    };
  }

  /** Whether the machine answers now: looked at for the picker, at most once a minute. */
  async look(host: string): Promise<{ ok: boolean; message?: string }> {
    const cached = this.#looks.get(host);
    if (cached && cached.until > Date.now()) return cached;
    let look: { ok: boolean; message?: string };
    try {
      const result = await this.remote(host).sh('true', {
        timeoutMs: 20_000,
        signal: AbortSignal.timeout(20_000),
      });
      look = { ok: result.code === 0 };
    } catch (error) {
      look = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    this.#looks.set(host, { ...look, until: Date.now() + 60_000 });
    return look;
  }

  #mirror(host: string, conversationId: string): Mirror {
    const key = `${host}\0${conversationId}`;
    let mirror = this.#mirrors.get(key);
    if (!mirror) {
      mirror = new Mirror(this.remote(host), `"$HOME"/.conch-work/${copyName(conversationId)}`);
      this.#mirrors.set(key, mirror);
    }
    return mirror;
  }

  /** One command there, with the work folder carried both ways. */
  async run(host: string, request: RunRequest): Promise<RunResult> {
    if (!(await this.hosts()).includes(host))
      throw new PlaceUnavailable(
        `${host} isn’t in your SSH settings any more. Choose where this chat’s work runs again.`,
      );
    const mirror = this.#mirror(host, request.conversationId);
    return mirror.serial(async () => {
      try {
        await mirror.push(request.cwd, request.forbidden, request.signal);
        const seconds = Math.ceil(request.timeoutMs / 1000);
        const script = [
          `cd ${mirror.root} || exit 97`,
          'if command -v timeout >/dev/null 2>&1; then',
          `  exec timeout -k 5 ${seconds} sh -c ${shq(request.command)}`,
          'fi',
          `exec sh -c ${shq(request.command)}`,
        ].join('\n');
        let result: ExecResult | undefined;
        let failure: unknown;
        try {
          result = await this.remote(host).sh(script, {
            timeoutMs: request.timeoutMs + 30_000,
            signal: request.signal,
          });
        } catch (error) {
          failure = error;
        }
        // Whatever the command did, even failing, what it changed comes back. Not after Stop.
        const back =
          request.signal.aborted || failure instanceof PlaceUnavailable
            ? undefined
            : await mirror.pull(request.cwd, request.forbidden, request.signal);
        if (failure || !result) throw failure;
        const note = back && backNote(back);
        return {
          code: result.code,
          output: result.output,
          timedOut: result.timedOut || result.code === 124,
          ...(note && { note }),
        };
      } catch (error) {
        if (error instanceof MirrorError) throw new PlaceUnavailable(error.message);
        throw error;
      }
    });
  }
}

/** What came back, for the model: "3 files came back, 1 was deleted." */
export function backNote(back: {
  changed: number;
  removed: number;
  skipped: number;
}): string | undefined {
  const parts: string[] = [];
  if (back.changed - back.skipped > 0)
    parts.push(
      `${back.changed - back.skipped} changed file${back.changed - back.skipped === 1 ? '' : 's'} came back to the work folder`,
    );
  if (back.removed > 0)
    parts.push(
      `${back.removed} deleted there ${back.removed === 1 ? 'was' : 'were'} deleted here too`,
    );
  if (back.skipped > 0)
    parts.push(
      `${back.skipped} ${back.skipped === 1 ? 'was' : 'were'} left there (links, or places Conch keeps out)`,
    );
  return parts.length ? `${parts.join('; ')}.` : undefined;
}

/** One SSH machine as a chat's place. */
export function sshPlace(machines: SshMachines, host: string): WorkPlace {
  return {
    id: `ssh:${host}`,
    kind: 'ssh',
    where: { kind: 'ssh', name: host },
    seals: false,
    about: `Commands run on ${host}, the person’s own machine, over SSH, in this chat’s copy of the work folder there (~/.conch-work/…). The copy is brought up to date before each command and what a command changes comes back after it (except dependency folders like node_modules and .venv, which stay there: install them there). Use paths relative to the work folder. Commands there have that machine’s own access, the network included, and are asked about as if they left the sealed box.`,
    run: (request) => machines.run(host, request),
  };
}
