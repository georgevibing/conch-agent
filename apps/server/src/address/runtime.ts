/**
 * Ports 80 and 443, as you (ADR 0064).
 *
 * Linux keeps ports below 1024 for root. Conch never runs as root: it gives
 * the one capability needed, `CAP_NET_BIND_SERVICE`, to its *own* copy of
 * Node, in `~/.conch/runtime` (a folder only you can open), so nothing else
 * on the computer gains anything and nothing Node starts inherits it. A Conch
 * running on a system Node gets its own copy first, checked against
 * nodejs.org's checksums as the installer does. macOS and Windows let anyone
 * listen on those ports.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { arch as osArch, platform as osPlatform, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { run, type RunResult } from '../lib/proc';

export const NODE_MAJOR = 24;

export type Exec = (file: string, args: string[]) => Promise<RunResult>;

export interface RuntimeDeps {
  home: string;
  /** The Node running Conch (`process.execPath`). */
  execPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  exec?: Exec;
  fetch?: typeof fetch;
  uid?: () => number;
  /** `/proc/sys/net/ipv4/ip_unprivileged_port_start`, read (tests give it). */
  unprivilegedStart?: () => Promise<number | undefined>;
}

const resolved = (path: string) => realpath(path).catch(() => path);

/** Single quotes for the shell, when the path needs them. */
function shellQuote(value: string): string {
  return /^[\w./+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The runtime is Conch's own: inside `~/.conch/runtime`, symlinks followed. */
export async function isPrivateNode(execPath: string, home: string): Promise<boolean> {
  const runtime = await resolved(join(home, 'runtime'));
  const node = await resolved(execPath);
  const rel = relative(runtime, node);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel);
}

/** The one command that lets this Node answer on ports 80 and 443. */
export async function setcapCommand(execPath: string): Promise<string> {
  return `sudo setcap cap_net_bind_service=+ep ${shellQuote(await resolved(execPath))}`;
}

async function readUnprivilegedStart(): Promise<number | undefined> {
  try {
    const value = Number(
      (await readFile('/proc/sys/net/ipv4/ip_unprivileged_port_start', 'utf8')).trim(),
    );
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Whether this Node may listen on ports 80 and 443 here. */
export async function lowPortsAllowed(deps: RuntimeDeps): Promise<boolean> {
  const platform = deps.platform ?? osPlatform();
  if (platform !== 'linux') return true;
  if ((deps.uid ?? process.getuid)?.() === 0) return true;
  const start = await (deps.unprivilegedStart ?? readUnprivilegedStart)();
  if (start !== undefined && start <= 80) return true;
  const node = await resolved(deps.execPath ?? process.execPath);
  const exec = deps.exec ?? ((file, args) => run(file, args, { timeout: 5000 }));
  for (const getcap of ['getcap', '/usr/sbin/getcap', '/sbin/getcap']) {
    const result = await exec(getcap, [node]).catch(() => undefined);
    if (result?.code === 0) return /cap_net_bind_service/i.test(result.stdout);
  }
  // No getcap: try a low port nobody uses.
  return canBind(1);
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EADDRINUSE'));
    server.listen({ port, host: '127.0.0.1' }, () => server.close(() => resolve(true)));
  });
}

function sha256(path: string): Promise<string> {
  return readFile(path).then((bytes) => createHash('sha256').update(bytes).digest('hex'));
}

/**
 * Conch's own Node, getting it when it isn't there: the newest Node 24 for
 * this computer from nodejs.org, checked against its published checksums,
 * unpacked into `~/.conch/runtime`, with `runtime/node` pointing at it.
 * Returns the `node` program's path.
 */
export async function ensurePrivateNode(deps: RuntimeDeps): Promise<string> {
  const execPath = deps.execPath ?? process.execPath;
  if (await isPrivateNode(execPath, deps.home)) return execPath;
  const platform = deps.platform ?? osPlatform();
  const machine = deps.arch ?? osArch();
  const arch = machine === 'arm64' ? 'arm64' : machine === 'x64' ? 'x64' : undefined;
  if ((platform !== 'linux' && platform !== 'darwin') || !arch)
    throw new Error(`Conch can’t get its own Node.js for this computer (${platform} ${machine}).`);
  const fetcher = deps.fetch ?? fetch;
  const base = `https://nodejs.org/dist/latest-v${NODE_MAJOR}.x`;
  const sums = await fetcher(`${base}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30_000) });
  if (!sums.ok)
    throw new Error('Conch couldn’t reach nodejs.org. Check the connection, then try again.');
  const pattern = new RegExp(
    `^([a-f0-9]{64})\\s+(node-v${NODE_MAJOR}\\.[0-9.]+-${platform}-${arch}\\.tar\\.gz)$`,
    'm',
  );
  const match = pattern.exec(await sums.text());
  if (!match?.[1] || !match[2])
    throw new Error(`nodejs.org has no Node.js ${NODE_MAJOR} for this computer.`);
  const [, want, file] = match;
  const runtime = join(deps.home, 'runtime');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(tmpdir(), 'conch-node-'));
  try {
    const archive = join(temp, file);
    const download = await fetcher(`${base}/${file}`, { signal: AbortSignal.timeout(300_000) });
    if (!download.ok || !download.body)
      throw new Error('Downloading Node.js didn’t finish. Check the connection, then try again.');
    await pipeline(Readable.fromWeb(download.body as never), createWriteStream(archive));
    if ((await sha256(archive)) !== want)
      throw new Error(
        'The Node.js download didn’t match its checksum, so Conch threw it away. Try again; if it keeps happening, your network may be changing downloads.',
      );
    const exec = deps.exec ?? ((f, args) => run(f, args, { timeout: 300_000 }));
    const untar = await exec('tar', ['-xzf', archive, '-C', runtime]);
    if (untar.code !== 0) throw new Error(`Unpacking Node.js didn’t work: ${untar.stderr.trim()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  const folder = join(runtime, file.replace(/\.tar\.gz$/, ''));
  const link = join(runtime, 'node');
  await rm(link, { force: true });
  // A junction on Windows needs no administrator (only tests run this there).
  await symlink(folder, link, process.platform === 'win32' ? 'junction' : 'dir');
  return join(link, 'bin', 'node');
}

/** Where `ensurePrivateNode` puts Node, whether or not it's there yet. */
export function privateNodePath(home: string): string {
  return join(home, 'runtime', 'node', 'bin', 'node');
}
