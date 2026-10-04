import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { explainInstall, type NeedSpec, readProgress, Setup } from './needs';

/** A package manager that runs a Node script: the recipe's args become `node -e <script>`. */
function recipe(script: string) {
  return { win32: { manager: 'winget' as const, args: ['-e', script] } };
}

function world(initial: Record<string, string | undefined> = {}) {
  const found = { ...initial };
  const spec = (id: string, extra: Partial<NeedSpec> = {}): NeedSpec => ({
    id,
    name: `The ${id} app`,
    short: id,
    find: () => Promise.resolve(found[id]),
    ...extra,
  });
  return { found, spec };
}

const setupWith = (specs: NeedSpec[], manager: string | null = process.execPath) =>
  new Setup(new Map(specs.map((s) => [s.id, s])), {
    platform: 'win32',
    manager: () => Promise.resolve(manager ?? undefined),
  });

describe('what a feature needs', () => {
  it('says what’s here, and what Conch can install or link to', async () => {
    const { spec } = world({ here: '/apps/here' });
    const here = spec('here');
    const app = spec('app', {
      install: recipe(''),
      download: { win32: 'https://example.com/get' },
    });
    const readiness = await setupWith([here, app]).readiness([here, app]);
    expect(readiness.ready).toBe(false);
    expect(readiness.needs[0]).toMatchObject({ id: 'here', state: 'ready' });
    expect(readiness.needs[1]).toMatchObject({
      id: 'app',
      state: 'missing',
      install: { label: 'Install app', command: expect.stringMatching(/^winget -e/) },
      download: 'https://example.com/get',
    });
  });

  it('only offers to install when the package manager is on this computer', async () => {
    const { spec } = world();
    const app = spec('app', { install: recipe('') });
    const [need] = (await setupWith([app], null).readiness([app])).needs;
    expect(need?.install).toBeUndefined();
  });

  it('says a need that comes with another one is on its way while that one installs', async () => {
    const { spec, found } = world();
    const app = spec('app', {
      install: recipe('setTimeout(() => {}, 300)'),
      opens: 'app',
    });
    const server = spec('server', {
      comesWith: 'app',
      opens: 'app',
      hint: (has) => (has('app') ? 'Update the app.' : 'Comes with the app.'),
    });
    const setup = setupWith([app, server]);
    expect((await setup.readiness([app, server])).needs[1]?.message).toBe('Comes with the app.');

    await setup.install(app);
    const during = await setup.readiness([app, server]);
    expect(during.needs.map((n) => n.state)).toEqual(['installing', 'installing']);

    found.app = 'C:\\app.exe';
    await setup.settled('app');
    const after = await setup.readiness([app, server]);
    expect(after.needs[0]).toMatchObject({ state: 'ready', openable: true });
    expect(after.needs[1]).toMatchObject({ state: 'missing', message: 'Update the app.' });
  });

  it('says a need that isn’t made for this computer can’t be had', async () => {
    const { spec } = world();
    const macOnly = spec('mac-only', { platforms: ['darwin'] });
    const [need] = (await setupWith([macOnly]).readiness([macOnly])).needs;
    expect(need?.state).toBe('unsupported');
    expect(need?.install).toBeUndefined();
  });
});

describe('installing', () => {
  it('shows progress, then finds what it installed', async () => {
    const { spec, found } = world();
    // The installer runs until the test says it's done, so a busy machine can't race it.
    const done = join(await mkdtemp(join(tmpdir(), 'conch-install-')), 'done');
    const script = `
      console.log('Found 1Password [AgileBits.1Password]');
      console.log('  ██████████  12.0 MB / 30.0 MB');
      const wait = setInterval(() => {
        if (!require('fs').existsSync(${JSON.stringify(done)})) return;
        console.log('Starting package install...');
        clearInterval(wait);
      }, 20);`;
    const app = spec('app', { install: recipe(script) });
    const setup = setupWith([app]);
    await setup.install(app);
    await vi.waitFor(
      async () => {
        const [need] = (await setup.readiness([app])).needs;
        expect(need).toMatchObject({
          state: 'installing',
          progress: { percent: 40, label: 'Downloading app · 40%' },
        });
      },
      { timeout: 10_000 },
    );
    found.app = '/apps/app';
    await writeFile(done, '');
    await setup.settled('app');
    expect((await setup.readiness([app])).ready).toBe(true);
  });

  it('says why an install failed, in plain words, and offers it again', async () => {
    const { spec } = world();
    const app = spec('app', {
      install: recipe(
        "console.error('InternetOpenUrl() failed. 0x80072ee7 : unknown error'); process.exitCode = 1;",
      ),
    });
    const setup = setupWith([app]);
    await setup.install(app);
    await setup.settled('app');
    const [need] = (await setup.readiness([app])).needs;
    expect(need).toMatchObject({
      state: 'failed',
      message: 'Couldn’t download app: the internet seems to be unreachable.',
      install: { label: 'Install app' },
    });
  });

  it('counts “already installed” as done', async () => {
    const { spec, found } = world();
    const app = spec('app', {
      install: recipe(
        "console.log('Found an existing package already installed.'); process.exitCode = 1;",
      ),
    });
    const setup = setupWith([app]);
    found.app = 'C:\\app.exe';
    await setup.install(app);
    await setup.settled('app');
    expect((await setup.readiness([app])).ready).toBe(true);
  });

  it('says so when the installer finished but the program still isn’t there', async () => {
    const { spec } = world();
    const app = spec('app', { install: recipe('') });
    const setup = setupWith([app]);
    await setup.install(app);
    await setup.settled('app');
    const [need] = (await setup.readiness([app])).needs;
    expect(need).toMatchObject({ state: 'failed', message: expect.stringContaining('can’t find') });
  });

  it('starts one install however many times the button is pressed', async () => {
    const { spec } = world();
    const app = spec('app', { install: recipe('setTimeout(() => {}, 200)') });
    const starts = vi.fn(spawn);
    const setup = new Setup(new Map([[app.id, app]]), {
      platform: 'win32',
      manager: () => Promise.resolve(process.execPath),
      spawn: starts as unknown as typeof spawn,
    });
    await Promise.all([setup.install(app), setup.install(app), setup.install(app)]);
    await setup.settled('app');
    expect(starts).toHaveBeenCalledTimes(1);
  });

  it('refuses to install what it has no recipe for here', async () => {
    const { spec } = world();
    const app = spec('app');
    await expect(setupWith([app]).install(app)).rejects.toThrow(/can’t install app/);
  });
});

describe('a package manager that isn’t here yet, and Conch’s own fetch', () => {
  it('gets the package manager first, in the same press, then the program', async () => {
    const { spec, found } = world();
    const uv = spec('uv', { install: recipe('') });
    const piper = spec('piper', {
      install: { win32: { manager: 'uv', args: ['-e', ''], via: 'uv' } },
    });
    const ran: string[] = [];
    const setup = new Setup(
      new Map([
        [uv.id, uv],
        [piper.id, piper],
      ]),
      {
        platform: 'win32',
        // winget is here; uv only once it has been installed.
        manager: (name) =>
          Promise.resolve(name === 'winget' || found.uv ? process.execPath : undefined),
        spawn: ((command: string, args: string[], options: object) => {
          ran.push(found.uv ? 'uv' : 'winget');
          if (!found.uv) found.uv = 'C:\\uv.exe';
          else found.piper = 'C:\\piper.exe';
          return spawn(command, args, options as never);
        }) as unknown as typeof spawn,
      },
    );
    const [before] = (await setup.readiness([piper])).needs;
    // Both steps are shown before the press.
    expect(before?.install?.command).toMatch(/^winget -e .* && uv -e/);
    await setup.install(piper);
    expect((await setup.readiness([piper])).needs[0]).toMatchObject({
      state: 'installing',
      progress: { label: 'Getting uv first…' },
    });
    await setup.settled('piper');
    expect(ran).toEqual(['winget', 'uv']);
    expect((await setup.readiness([piper])).ready).toBe(true);
  });

  it('offers nothing when neither the manager nor a way to get it is here', async () => {
    const { spec } = world();
    const piper = spec('piper', {
      install: { win32: { manager: 'uv', args: ['tool', 'install', 'piper-tts'], via: 'uv' } },
    });
    const [need] = (await setupWith([piper], null).readiness([piper])).needs;
    expect(need?.install).toBeUndefined();
  });

  it('fetches a release itself, with progress, and says what it downloads', async () => {
    const { spec, found } = world();
    let finish: () => void = () => undefined;
    const whisper = spec('whisper', {
      install: {
        win32: {
          manager: 'github',
          args: ['ggml-org/whisper.cpp', 'whisper-bin-x64.zip', 'whisper-cli'],
        },
      },
    });
    const github = vi.fn(
      (options: { progress?: (line: string) => void; repo: string; need: string }) =>
        new Promise<void>((resolve) => {
          options.progress?.('Downloading whisper-bin-x64.zip 37%');
          finish = () => {
            found.whisper = 'C:\\tools\\whisper-cli.exe';
            resolve();
          };
        }),
    );
    const setup = new Setup(new Map([[whisper.id, whisper]]), {
      platform: 'win32',
      manager: () => Promise.resolve(undefined),
      github: github as never,
    });
    const [before] = (await setup.readiness([whisper])).needs;
    expect(before?.install).toEqual({
      label: 'Install whisper',
      command: 'download whisper-bin-x64.zip from github.com/ggml-org/whisper.cpp',
    });
    await setup.install(whisper);
    expect((await setup.readiness([whisper])).needs[0]).toMatchObject({
      state: 'installing',
      progress: { percent: 37, label: 'Downloading whisper · 37%' },
    });
    expect(github).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'ggml-org/whisper.cpp', need: 'whisper' }),
    );
    finish();
    await setup.settled('whisper');
    expect((await setup.readiness([whisper])).ready).toBe(true);
  });

  it('says plainly when the fetch couldn’t reach the internet', async () => {
    const { spec } = world();
    const whisper = spec('whisper', {
      install: { win32: { manager: 'github', args: ['o/r', 'a.zip', 'whisper-cli'] } },
    });
    const setup = new Setup(new Map([[whisper.id, whisper]]), {
      platform: 'win32',
      github: () => Promise.reject(new Error('Couldn’t reach GitHub: fetch failed')),
    });
    await setup.install(whisper);
    await setup.settled('whisper');
    expect((await setup.readiness([whisper])).needs[0]).toMatchObject({
      state: 'failed',
      message: 'Couldn’t download whisper: the internet seems to be unreachable.',
    });
  });
});

describe('opening an app', () => {
  it('starts the app it found, detached, and uses `open -a` on macOS', async () => {
    const { spec } = world({ app: '/Applications/App.app' });
    const app = spec('app', { opens: 'app' });
    const child = { on: vi.fn(), unref: vi.fn() };
    const starts = vi.fn(() => child);
    const mac = new Setup(new Map([[app.id, app]]), {
      platform: 'darwin',
      spawn: starts as unknown as typeof spawn,
    });
    await mac.open(app);
    expect(starts).toHaveBeenCalledWith(
      'open',
      ['-a', '/Applications/App.app'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it('won’t open what isn’t there', async () => {
    const { spec } = world();
    const app = spec('app', { opens: 'app' });
    await expect(setupWith([app]).open(app)).rejects.toThrow(/can’t open app/);
  });
});

describe('reading installers', () => {
  it('turns their progress bars into a percentage', () => {
    expect(readProgress('  ██████▒▒▒▒  12.0 MB / 30.0 MB')).toBe(40);
    expect(readProgress('  ██████████  1.00 GB /  2.0 GB')).toBe(50);
    expect(readProgress('######################################## 42.5%')).toBe(43);
    expect(readProgress('Starting package install...')).toBeUndefined();
  });

  it('explains failures in words a person can act on', () => {
    expect(explainInstall('0x800704c7 : The operation was canceled by the user.', 'X')).toMatch(
      /cancelled/,
    );
    expect(explainInstall('Error: No space left on device', 'X')).toMatch(/disk space/);
    expect(explainInstall('something odd', 'X')).toBe(
      'Installing X didn’t work. You can get it from its website instead.',
    );
  });
});
