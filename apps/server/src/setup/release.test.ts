import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  fetchedTool,
  fetchRelease,
  findInside,
  latestRelease,
  setToolsHome,
  toolsDir,
  type Unpack,
} from './release';

const REPO = 'ggml-org/whisper.cpp';
const ASSET = 'whisper-bin-x64.zip';
const BYTES = Buffer.from('pretend whisper.cpp archive');
const SHA = createHash('sha256').update(BYTES).digest('hex');

const asset = (over: Record<string, unknown> = {}) => ({
  name: ASSET,
  browser_download_url: `https://github.com/${REPO}/releases/download/v1.9.2/${ASSET}`,
  digest: `sha256:${SHA}`,
  size: BYTES.length,
  ...over,
});

const release = (tag: string, over: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: [
    asset({ browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${ASSET}` }),
  ],
  ...over,
});

/** GitHub, pretending: the releases list, then the file itself. */
function github(releases: unknown[], body: Buffer = BYTES) {
  const asked: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    if (url.startsWith('https://api.github.com/')) return Response.json(releases);
    return new Response(new Uint8Array(body), {
      headers: { 'content-length': String(body.length) },
    });
  }) as typeof fetch;
  return { fake, asked };
}

/** Unpacking, pretending: whisper-cli lands in a `Release` folder, as the real zip has it. */
const unpack: Unpack = async (_archive, into) => {
  await mkdir(join(into, 'Release'), { recursive: true });
  await writeFile(join(into, 'Release', 'whisper-cli.exe'), 'MZ');
};

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-tools-'));
  setToolsHome(home);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5 });
});

describe('a release on GitHub', () => {
  it('takes the newest finished release with a version and a checksum', async () => {
    const { fake } = github([
      release('v1.9.4', { assets: [] }), // published without its files
      release('b5130', { prerelease: true }),
      release('b4938'), // a build number, not a version
      release('v1.9.3', { prerelease: true }),
      release('v1.9.2'),
    ]);
    expect(await latestRelease(REPO, ASSET, { fetch: fake })).toMatchObject({
      tag: 'v1.9.2',
      version: '1.9.2',
      sha256: SHA,
    });
  });

  it('never takes a file GitHub publishes no checksum for, or one from somewhere else', async () => {
    const { fake } = github([
      release('v2.0.0', { assets: [asset({ digest: undefined })] }),
      release('v1.9.9', {
        assets: [asset({ browser_download_url: 'https://evil.example/whisper-bin-x64.zip' })],
      }),
    ]);
    expect(await latestRelease(REPO, ASSET, { fetch: fake })).toBeUndefined();
    // Names that could reach another place are refused before asking.
    expect(await latestRelease('../../evil', ASSET, { fetch: fake })).toBeUndefined();
    expect(await latestRelease(REPO, '../x.zip', { fetch: fake })).toBeUndefined();
  });

  it('fetches, checks and unpacks it, and says where the program is', async () => {
    const lines: string[] = [];
    const tool = await fetchRelease({
      repo: REPO,
      asset: ASSET,
      program: 'whisper-cli',
      need: 'whisper',
      fetch: github([release('v1.9.2')]).fake,
      unpack,
      progress: (line) => lines.push(line),
    });
    expect(tool).toMatchObject({ tag: 'v1.9.2', version: '1.9.2' });
    expect(tool.bin).toBe(join(toolsDir('whisper'), 'v1.9.2', 'Release'));
    expect(fetchedTool('whisper')).toEqual(tool);
    expect(lines.some((l) => /100%/.test(l))).toBe(true);
    // Nothing left lying about: only the version and what it says.
    expect((await readdir(toolsDir('whisper'))).sort()).toEqual(['current.json', 'v1.9.2']);
  });

  it('throws away a download that doesn’t match its checksum, and keeps the copy that works', async () => {
    await fetchRelease({
      repo: REPO,
      asset: ASSET,
      program: 'whisper-cli',
      need: 'whisper',
      fetch: github([release('v1.9.2')]).fake,
      unpack,
    });
    const tampered = github([release('v1.9.5')], Buffer.from('something else entirely'));
    await expect(
      fetchRelease({
        repo: REPO,
        asset: ASSET,
        program: 'whisper-cli',
        need: 'whisper',
        fetch: tampered.fake,
        unpack,
      }),
    ).rejects.toThrow(/checksum/);
    expect(fetchedTool('whisper')?.tag).toBe('v1.9.2');
    expect(existsSync(join(toolsDir('whisper'), 'v1.9.2', 'Release', 'whisper-cli.exe'))).toBe(
      true,
    );
    expect(existsSync(join(toolsDir('whisper'), 'v1.9.5.download'))).toBe(false);
  });

  it('refuses a release that no longer has the program in it', async () => {
    await expect(
      fetchRelease({
        repo: REPO,
        asset: ASSET,
        program: 'whisper-cli',
        need: 'whisper',
        fetch: github([release('v1.9.2')]).fake,
        unpack: async () => undefined,
      }),
    ).rejects.toThrow(/doesn’t have whisper-cli/);
    expect(fetchedTool('whisper')).toBeUndefined();
  });

  it('says plainly when GitHub can’t be reached', async () => {
    await expect(
      fetchRelease({
        repo: REPO,
        asset: ASSET,
        program: 'whisper-cli',
        need: 'whisper',
        fetch: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
        unpack,
      }),
    ).rejects.toThrow(/Couldn’t reach GitHub/);
  });

  it('never points outside its own folder, whatever current.json says', async () => {
    await mkdir(toolsDir('whisper'), { recursive: true });
    await writeFile(
      join(toolsDir('whisper'), 'current.json'),
      JSON.stringify({ tag: 'v1', version: '1.0.0', bin: '../../elsewhere' }),
    );
    expect(fetchedTool('whisper')).toBeUndefined();
  });

  it('finds a program a few folders down', async () => {
    await mkdir(join(home, 'a', 'b'), { recursive: true });
    await writeFile(join(home, 'a', 'b', 'piper'), '');
    expect(findInside(home, 'piper')).toBe(join(home, 'a', 'b'));
    expect(findInside(home, 'nothing')).toBeUndefined();
  });
});
