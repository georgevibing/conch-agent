import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fromTooling } from './packages';
import {
  BWRAP_PROFILE,
  REGISTRY_HOSTS,
  SYSTEM_BWRAP,
  elsewhere,
  publishingKeys,
  sandboxFor,
  sandboxSupport,
  sealCommand,
  sealedConfig,
  sealedHosts,
  secretPlaces,
} from './sandbox';

describe('effective command sandbox availability', () => {
  it('does not advertise shell merely because binaries exist', () => {
    expect(
      sandboxSupport(
        () => true,
        'linux',
        () => false,
      ),
    ).toMatchObject({ available: false });
    expect(
      sandboxSupport(
        () => true,
        'darwin',
        () => false,
      ),
    ).toMatchObject({ available: false });
  });
  it('requires all prerequisites before probing the kernel', () => {
    const probe = vi.fn(() => true);
    expect(sandboxSupport((name) => name !== 'socat', 'linux', probe)).toMatchObject({
      available: false,
    });
    expect(probe).not.toHaveBeenCalled();
  });
  it('advertises shell only when prerequisites and real confinement work', () => {
    expect(
      sandboxSupport(
        () => true,
        'linux',
        () => true,
      ),
    ).toEqual({ available: true });
    expect(
      sandboxSupport(
        () => true,
        'win32',
        () => true,
      ),
    ).toMatchObject({ available: false });
  });
  it('offers one typed line where it can fix things, and nothing where it can’t', () => {
    const apt = (name: string) => name === 'apt-get' || (name !== 'bwrap' && name !== 'dnf');
    // Missing programs: the system's package manager installs them.
    expect(
      sandboxSupport(
        apt,
        'linux',
        () => false,
        () => false,
      ),
    ).toMatchObject({
      available: false,
      command: 'sudo apt-get update && sudo apt-get install -y bubblewrap socat ripgrep',
    });
    // Installed, but Ubuntu restricts its sandbox: one line allows the system's bubblewrap.
    const allow = sandboxSupport(
      () => true,
      'linux',
      () => false,
      () => true,
    );
    expect(allow).toMatchObject({ available: false });
    const line = 'command' in allow ? (allow.command ?? '') : '';
    expect(line).toContain(`sudo tee ${BWRAP_PROFILE}`);
    expect(line).toContain(`profile conch-bwrap ${SYSTEM_BWRAP} flags=(unconfined)`);
    expect(line).toContain(`sudo apparmor_parser -r ${BWRAP_PROFILE}`);
    // A package manager Conch doesn't know: words, no command.
    expect(
      sandboxSupport(
        (name) => name === 'socat',
        'linux',
        () => false,
        () => false,
      ),
    ).not.toHaveProperty('command');
    // Installed and unrestricted, still refused (a container): no command would help.
    expect(
      sandboxSupport(
        () => true,
        'linux',
        () => false,
        () => false,
      ),
    ).not.toHaveProperty('command');
  });
  it('puts everything that runs as root on the line, never a file anyone could change', () => {
    const line =
      sealCommand({ missing: true, restricted: true, has: (name) => name === 'pacman' }) ?? '';
    expect(line).toMatch(/^sudo pacman -S --needed --noconfirm bubblewrap socat ripgrep && printf/);
    // No `sh <file>`: a script in Conch's folder is yours to change, and so the assistant's.
    expect(line).not.toMatch(/\bsh\s+['"/]/);
    // One line, typed whole into the terminal.
    expect(line).not.toContain('\n');
  });
});

const temp = () => mkdtemp(join(tmpdir(), 'conch-sandbox-'));
const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });

describe('where a sealed command reaches (ADR 0148)', () => {
  const all: string[] = Object.values(REGISTRY_HOSTS).flat();

  it('lists the registries, code hosts and the languages’ own tooling, by name', () => {
    for (const host of [
      'registry.npmjs.org',
      'registry.yarnpkg.com',
      'pypi.org',
      'files.pythonhosted.org',
      'crates.io',
      'index.crates.io',
      'static.crates.io',
      'proxy.golang.org',
      'sum.golang.org',
      'rubygems.org',
      'formulae.brew.sh',
      'ghcr.io',
      'github.com',
      'codeload.github.com',
      'objects.githubusercontent.com',
      'raw.githubusercontent.com',
      'gitlab.com',
      'bitbucket.org',
    ])
      expect(all).toContain(host);
    // Every host packages.ts calls the tooling's own is reachable too.
    for (const host of [
      'bootstrap.pypa.io',
      'files.pythonhosted.org',
      'python.org',
      'www.python.org',
      'nodejs.org',
      'static.rust-lang.org',
      'sh.rustup.rs',
      'astral.sh',
      'get.pnpm.io',
      'bun.sh',
      'go.dev',
      'dl.google.com',
    ]) {
      expect(fromTooling(`curl https://${host}/x`)).toBe(true);
      expect(all).toContain(host);
    }
    // Names only: no scheme, path, port or wildcard (the runtime would widen or refuse them).
    for (const host of all) expect(host).toMatch(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/);
  });

  it('leaves out where anything can be uploaded or published', () => {
    for (const host of [
      'upload.pypi.org',
      'api.github.com',
      'gist.github.com',
      'uploads.github.com',
      'storage.googleapis.com',
      's3.amazonaws.com',
    ])
      expect(all).not.toContain(host);
  });

  it('adds the work folder’s own HTTPS remotes, read locally, and nothing else of theirs', async () => {
    const dir = await temp();
    git(dir, 'init', '-q');
    git(dir, 'remote', 'add', 'origin', 'https://git.example.org/team/app.git');
    git(dir, 'remote', 'add', 'mirror', 'https://code.example.com:8443/app');
    git(dir, 'remote', 'add', 'ssh', 'git@git.internal.example:team/app.git');
    git(dir, 'remote', 'add', 'keyed', 'https://me:secret@private.example.net/app.git');
    git(dir, 'remote', 'add', 'plain', 'http://insecure.example.com/app.git');
    git(dir, 'remote', 'add', 'address', 'https://10.0.0.5/app.git');
    const hosts = await sealedHosts(dir, { moved: new Set() });
    expect(hosts).toContain('git.example.org:443');
    expect(hosts).toContain('code.example.com:8443');
    expect(hosts).toContain('registry.npmjs.org:443');
    expect(hosts).toContain('github.com:443');
    for (const host of ['git.internal.example', 'private.example.net', 'insecure', '10.0.0.5'])
      expect(hosts.join(' ')).not.toContain(host);
    // HTTPS's port only: an SSH push or plain HTTP to a listed host isn't on the list.
    expect(hosts.every((h) => /:\d+$/.test(h))).toBe(true);
  });

  it('is only the list outside a repository', async () => {
    const hosts = await sealedHosts(await temp(), { moved: new Set() });
    expect(hosts).toEqual([...new Set(all)].map((h) => `${h}:443`));
  });

  it('keeps a registry out when the person’s own settings point elsewhere', async () => {
    const dir = await temp();
    const file = async (name: string, text: string) => {
      await writeFile(join(dir, name), text);
      return join(dir, name);
    };
    const none = join(dir, 'missing');
    const look = (npmrc: string, bunfig = none, pip: string[] = []) =>
      elsewhere({ npmrc, bunfig, pip });
    // A token alone, or the public registry by name: the box asks the same one.
    expect(look(await file('a', '//registry.npmjs.org/:_authToken=x\n'))).toEqual(new Set());
    expect(look(await file('b', 'registry=https://registry.npmjs.org/\n'))).toEqual(new Set());
    // Their own registry, or one scope's: inside, npm would ask the public one instead.
    expect(look(await file('c', 'registry=https://npm.example.com/\n'))).toEqual(new Set(['npm']));
    expect(look(await file('d', '@acme:registry=https://npm.pkg.github.com\n'))).toEqual(
      new Set(['npm']),
    );
    expect(
      look(none, await file('e', '[install]\nregistry = "https://npm.example.com"\n')),
    ).toEqual(new Set(['npm']));
    expect(
      look(none, none, [await file('f', '[global]\nindex-url = https://pypi.org/simple\n')]),
    ).toEqual(new Set());
    expect(
      look(none, none, [
        await file('g', '[global]\nextra-index-url = https://pip.example.com/simple\n'),
      ]),
    ).toEqual(new Set(['pypi']));
    expect(look(none)).toEqual(new Set());
    const moved = await sealedHosts(await temp(), { moved: new Set(['npm', 'pypi'] as const) });
    expect(moved).not.toContain('registry.npmjs.org:443');
    expect(moved).not.toContain('pypi.org:443');
    expect(moved).toContain('crates.io:443');
  });
});

describe('Conch’s own sealed box (ADR 0028, ADR 0148)', () => {
  it('reaches the list, writes the work folder and caches, and reads no keys', async () => {
    const dir = await temp();
    const config = await sealedConfig(dir, {
      protectedPaths: ['/conch/vault'],
      denyRead: ['/conch/browser/profile'],
    });
    // Unless this computer's own ~/.npmrc names another registry (then npm's stays out).
    if (!elsewhere().has('npm'))
      expect(config.network.allowedDomains).toContain('registry.npmjs.org:443');
    expect(config.network.allowedDomains).toContain('github.com:443');
    expect(config.network.allowedDomains).toContain('crates.io:443');
    expect(config.network.deniedDomains).toEqual([]);
    expect(config.filesystem.allowWrite).toContain(dir);
    expect(config.filesystem.allowWrite).toContain(join(homedir(), '.npm'));
    expect(config.filesystem.denyWrite).toEqual(['/conch/vault', join(dir, '.git')]);
    for (const path of [
      '/conch/vault',
      '/conch/browser/profile',
      ...secretPlaces().map((p) => p.path),
      ...publishingKeys().map((p) => p.path),
    ])
      expect(config.filesystem.denyRead).toContain(path);
  });

  it('keeps every key that publishes out of it', () => {
    const keys = publishingKeys().map((p) => p.path);
    for (const path of [
      '.npmrc',
      '.yarnrc.yml',
      '.bunfig.toml',
      '.pypirc',
      join('.config', 'pip', 'pip.conf'),
      join('.pip', 'pip.conf'),
      join('.cargo', 'credentials'),
      join('.cargo', 'credentials.toml'),
      join('.gem', 'credentials'),
      join('.config', 'hub'),
      '.terraformrc',
      join('.terraform.d', 'credentials.tfrc.json'),
      join('.config', 'configstore'),
    ])
      expect(keys).toContain(join(homedir(), path));
    // Docker's sign-ins were kept out before, with the other keys.
    expect(secretPlaces().map((p) => p.path)).toContain(join(homedir(), '.docker', 'config.json'));
    // Never refused outside the box (that's `secretPlaces`): there a command naming one asks.
    const refused = new Set(secretPlaces().map((p) => p.path));
    expect(keys.filter((key) => refused.has(key))).toEqual([]);
    // A project's own .npmrc names its registry: it stays readable in the work folder.
    expect(keys.some((key) => !key.startsWith(homedir()))).toBe(false);
  });

  it('leaves the lists Claude Code and Codex get as they were', () => {
    const lists = sandboxFor('/work', { protectedPaths: [], home: '/conch' });
    expect(lists.denyRead).not.toContain(join(homedir(), '.npmrc'));
  });
});
