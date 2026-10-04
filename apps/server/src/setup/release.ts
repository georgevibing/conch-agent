/**
 * Programs Conch fetches itself (ADR 0016), for the few a person needs that
 * no package manager here carries: whisper.cpp on Windows and Linux, uv on
 * Linux. They come from the project's own GitHub releases, and only:
 *
 * - **A finished release.** Never a draft or a pre-release, and its tag is a
 *   version (`v1.9.2`), so Updates can compare it.
 * - **Checked as a whole.** GitHub publishes each file's SHA-256 (`digest`);
 *   the download is hashed as it arrives and thrown away unless it matches.
 *   A file GitHub says nothing about isn't used at all.
 * - **Unpacked by the system's own `tar`**, which refuses paths that climb out
 *   of the folder, into `CONCH_HOME/tools/<need>/<tag>`. The old version is
 *   removed only once the new one is in place, so a failed update leaves the
 *   working copy where it was.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { parseVersion } from '../updates/version';
import { run as runProgram } from '../lib/proc';

/** `owner/name`, as GitHub spells a repository. */
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
/** A file name Conch may ask for: no folders, nothing odd. */
const ASSET = /^[A-Za-z0-9_.+-]{1,200}$/;

let toolsHome: string | undefined;

/** Where Conch keeps the programs it fetched (set from `CONCH_HOME` on start). */
export function setToolsHome(home: string): void {
  toolsHome = join(resolve(home), 'tools');
}

export function toolsDir(need: string): string {
  const base =
    toolsHome ?? join(resolve(process.env.CONCH_HOME ?? join(homedir(), '.conch')), 'tools');
  return join(base, need);
}

/** What `current.json` says about the copy Conch fetched. */
export interface FetchedTool {
  tag: string;
  version: string;
  /** The folder its program is in, inside `tools/<need>`. */
  bin: string;
}

/** The copy of a need Conch fetched, if there is one. */
export function fetchedTool(need: string): FetchedTool | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(toolsDir(need), 'current.json'), 'utf8')) as Partial<
      Record<keyof FetchedTool, unknown>
    >;
    if (
      typeof raw.tag !== 'string' ||
      typeof raw.version !== 'string' ||
      typeof raw.bin !== 'string'
    )
      return undefined;
    const bin = resolve(toolsDir(need), raw.bin);
    // Never a folder outside its own.
    if (relative(toolsDir(need), bin).startsWith('..')) return undefined;
    return { tag: raw.tag, version: raw.version, bin };
  } catch {
    return undefined;
  }
}

/** The folder to look in for a need's program, when Conch fetched it. */
export const fetchedBin = (need: string): string[] => {
  const tool = fetchedTool(need);
  return tool ? [tool.bin] : [];
};

export interface ReleaseFile {
  tag: string;
  version: string;
  name: string;
  url: string;
  sha256: string;
  size: number;
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown; digest?: unknown; size?: unknown }[];
}

const headers = { accept: 'application/vnd.github+json', 'user-agent': 'Conch' };

/**
 * The newest finished release of `repo` that has `asset`, with its checksum.
 * Undefined when there's none (offline, or the project stopped publishing it).
 */
export async function latestRelease(
  repo: string,
  asset: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ReleaseFile | undefined> {
  if (!REPO.test(repo) || !ASSET.test(asset)) return undefined;
  const response = await (options.fetch ?? fetch)(
    `https://api.github.com/repos/${repo}/releases?per_page=20`,
    { headers, signal: options.signal ?? AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  const releases = (await response.json()) as GitHubRelease[];
  for (const release of Array.isArray(releases) ? releases : []) {
    if (release.draft !== false || release.prerelease !== false) continue;
    const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
    // A build number (`b4938`) isn't a version Updates can compare.
    const version = /^v?\d+\.\d+/.test(tag) ? parseVersion(tag) : undefined;
    if (!version) continue;
    const file = release.assets?.find((a) => a.name === asset);
    const sha256 =
      typeof file?.digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(file.digest)?.[1] : '';
    const url = typeof file?.browser_download_url === 'string' ? file.browser_download_url : '';
    // Only GitHub's own download address for this very repository.
    if (!sha256 || !url.startsWith(`https://github.com/${repo}/releases/download/`)) continue;
    return {
      tag,
      version,
      name: asset,
      url,
      sha256,
      size: typeof file?.size === 'number' ? file.size : 0,
    };
  }
  return undefined;
}

/** Where a program is, inside what was unpacked: the first folder that has it. */
export function findInside(root: string, program: string, depth = 3): string | undefined {
  const names = [program, `${program}.exe`];
  const look = (dir: string, left: number): string | undefined => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return undefined;
    }
    if (entries.some((e) => names.includes(e))) return dir;
    if (left === 0) return undefined;
    for (const entry of entries.sort()) {
      const path = join(dir, entry);
      try {
        if (!statSync(path).isDirectory()) continue;
      } catch {
        continue;
      }
      const found = look(path, left - 1);
      if (found) return found;
    }
    return undefined;
  };
  return look(root, depth);
}

/** The system's own tar: Windows has bsdtar in System32, which reads zips too. */
function systemTar(): string {
  return process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : process.platform === 'darwin'
      ? '/usr/bin/tar'
      : 'tar';
}

export type Unpack = (archive: string, into: string) => Promise<void>;

const unpackWithTar: Unpack = async (archive, into) => {
  const result = await runProgram(systemTar(), ['-xf', archive, '-C', into], {
    timeout: 5 * 60_000,
  });
  if (result.code !== 0)
    throw new Error(`The download couldn’t be unpacked: ${result.stderr.trim().slice(0, 200)}`);
};

export interface FetchOptions {
  /** `ggml-org/whisper.cpp` */
  repo: string;
  /** The file to fetch from its release: `whisper-bin-x64.zip`. */
  asset: string;
  /** The program that must be inside it: `whisper-cli`. */
  program: string;
  /** The need it's for: its folder under `tools`. */
  need: string;
  fetch?: typeof fetch;
  unpack?: Unpack;
  signal?: AbortSignal;
  /** How far it got, as a line `readProgress` reads ("Downloading 42%"). */
  progress?: (line: string) => void;
}

/** Fetch, check and unpack the newest release; resolves once it's in place. */
export async function fetchRelease(options: FetchOptions): Promise<FetchedTool> {
  const say = options.progress ?? (() => undefined);
  const release = await latestRelease(options.repo, options.asset, options).catch(
    (error: Error) => {
      throw new Error(`Couldn’t reach GitHub: ${error.message}`);
    },
  );
  if (!release) throw new Error(`${options.repo} has no ${options.asset} to download right now.`);
  const dir = toolsDir(options.need);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const current = fetchedTool(options.need);
  if (current?.tag === release.tag && findInside(current.bin, options.program, 0)) return current;

  const archive = join(dir, `${release.tag}.download`);
  const staging = join(dir, `${release.tag}.partial`);
  await rm(staging, { recursive: true, force: true });
  try {
    say(`Downloading ${options.asset}…`);
    const response = await (options.fetch ?? fetch)(release.url, {
      headers: { 'user-agent': 'Conch' },
      signal: options.signal ?? AbortSignal.timeout(15 * 60_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`GitHub answered ${response.status} for ${options.asset}.`);
    const total = Number(response.headers.get('content-length')) || release.size;
    const hash = createHash('sha256');
    let done = 0;
    let shown = -1;
    const count = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        hash.update(chunk);
        done += chunk.length;
        const percent = total ? Math.floor((done / total) * 100) : -1;
        if (percent >= 0 && percent !== shown) {
          shown = percent;
          say(`Downloading ${options.asset} ${Math.min(percent, 100)}%`);
        }
        next(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as never),
      count,
      createWriteStream(archive, { mode: 0o600 }),
    );
    if (hash.digest('hex') !== release.sha256)
      throw new Error(
        `${options.asset} didn’t match the checksum GitHub publishes for it, so Conch threw it away.`,
      );
    say(`Unpacking ${options.asset}…`);
    await mkdir(staging, { recursive: true });
    await (options.unpack ?? unpackWithTar)(archive, staging);
    const binInStaging = findInside(staging, options.program);
    if (!binInStaging)
      throw new Error(`${options.asset} doesn’t have ${options.program} in it any more.`);
    const final = join(dir, release.tag);
    await rm(final, { recursive: true, force: true });
    await rename(staging, final);
    const tool: FetchedTool = {
      tag: release.tag,
      version: release.version,
      bin: join(final, relative(staging, binInStaging)),
    };
    await writeFile(
      join(dir, 'current.json'),
      `${JSON.stringify({ ...tool, bin: relative(dir, tool.bin) }, null, 2)}\n`,
      { mode: 0o600 },
    );
    // The old version goes only now that the new one works.
    for (const entry of await readdir(dir))
      if (entry !== release.tag && entry !== 'current.json')
        await rm(join(dir, entry), { recursive: true, force: true }).catch(() => undefined);
    say(`Installed ${options.program} ${release.version}`);
    return tool;
  } finally {
    await rm(archive, { force: true }).catch(() => undefined);
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
