import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHIM_MARK,
  cliName,
  installShim,
  onPath,
  profileFor,
  removeShim,
  shimPlace,
  shimScript,
  type Exec,
} from './command';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'conch-shim-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const base = () => ({
  installDir: join(home, 'app'),
  conchHome: join(home, '.conch'),
  node: '/opt/node/bin/node',
  home,
});

describe('the script', () => {
  it('runs the CLI from the release Conch runs, with its own Node', () => {
    const script = shimScript({
      installDir: "/home/o'neil/conch",
      conchHome: '/home/x/.conch',
      node: '/n/node',
      platform: 'linux',
    });
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain(SHIM_MARK);
    // Quoted for sh, even with a quote in the path.
    expect(script).toContain(`DIR='/home/o'\\''neil/conch'`);
    expect(script).toContain('versions/current');
    expect(script).toContain(
      'exec "$NODE" --import "$DIR/apps/server/node_modules/tsx/dist/loader.mjs" "$DIR/apps/server/src/cli.ts" "$@"',
    );
  });

  it('is a batch file on Windows, with the loader as a file URL', () => {
    const script = shimScript({
      installDir: 'C:\\Users\\a b\\Conch',
      conchHome: 'C:\\Users\\a b\\.conch',
      node: 'C:\\node\\node.exe',
      platform: 'win32',
    });
    expect(script).toContain('@echo off');
    expect(script).toContain('\r\n');
    expect(script).toContain(
      'set "LOADER=file:///%DIR:\\=/%/apps/server/node_modules/tsx/dist/loader.mjs"',
    );
    expect(script).toContain('%*');
  });
});

describe('where it goes', () => {
  it('is ~/.local/bin on macOS and Linux, and LOCALAPPDATA on Windows', () => {
    expect(shimPlace('linux', '/home/x', {}).file).toBe(join('/home/x', '.local', 'bin', 'conch'));
    expect(shimPlace('win32', 'C:\\Users\\x', { LOCALAPPDATA: 'C:\\L' }).file).toBe(
      join('C:\\L', 'Conch', 'bin', 'conch.cmd'),
    );
  });

  it('knows which profile each shell reads', () => {
    expect(profileFor('/bin/zsh', 'darwin', '/h').file).toBe(join('/h', '.zshrc'));
    expect(profileFor('/bin/bash', 'darwin', '/h').file).toBe(join('/h', '.bash_profile'));
    expect(profileFor('/usr/bin/bash', 'linux', '/h').file).toBe(join('/h', '.bashrc'));
    expect(profileFor('/usr/bin/fish', 'linux', '/h').file).toBe(
      join('/h', '.config', 'fish', 'conf.d', 'conch.fish'),
    );
    expect(profileFor(undefined, 'linux', '/h').file).toBe(join('/h', '.profile'));
  });

  it('reads PATH the way the platform writes it', () => {
    expect(onPath('/home/x/.local/bin', { PATH: '/usr/bin:/home/x/.local/bin' }, 'linux')).toBe(
      true,
    );
    expect(onPath('/home/x/.local/bin', { PATH: '/usr/bin' }, 'linux')).toBe(false);
    expect(onPath('C:\\L\\Conch\\bin', { Path: 'C:\\Windows;c:\\l\\conch\\bin' }, 'win32')).toBe(
      true,
    );
  });
});

describe.skipIf(process.platform === 'win32')('installing it on macOS and Linux', () => {
  it('writes an executable command and a profile line when the folder isn’t on PATH', async () => {
    const result = await installShim({
      ...base(),
      platform: 'linux',
      env: { PATH: '/usr/bin', SHELL: '/bin/bash' },
    });
    expect(result.ready).toBe(false);
    expect(result.profile).toBe(join(home, '.bashrc'));
    expect(statSync(result.file).mode & 0o111).toBeTruthy();
    expect(readFileSync(result.file, 'utf8')).toContain(SHIM_MARK);
    expect(readFileSync(join(home, '.bashrc'), 'utf8')).toContain(
      'export PATH="$HOME/.local/bin:$PATH"',
    );
  });
});

describe('installing it', () => {
  it('needs no profile line when the folder is on PATH already', async () => {
    // This computer's own platform, so PATH is split the way it really is.
    const local = { LOCALAPPDATA: join(home, 'L'), SHELL: '/bin/zsh' };
    const { dir, file } = shimPlace(process.platform, home, local);
    const env = { ...local, PATH: [join(home, 'x'), dir].join(delimiter) };
    const result = await installShim({ ...base(), env });
    expect(result).toEqual({ file, ready: true });
    expect(existsSync(join(home, '.zshrc'))).toBe(false);
  });

  it('adds its profile line once, however often it runs, after what was there', async () => {
    writeFileSync(join(home, '.zshrc'), 'alias ll="ls -l"');
    const env = { PATH: '/usr/bin', SHELL: '/bin/zsh' };
    await installShim({ ...base(), platform: 'linux', env });
    await installShim({ ...base(), platform: 'linux', env });
    const profile = readFileSync(join(home, '.zshrc'), 'utf8');
    expect(profile.startsWith('alias ll="ls -l"\nexport PATH=')).toBe(true);
    expect(profile.match(/added by Conch/g)).toHaveLength(1);
  });

  it('never replaces a conch that isn’t Conch’s', async () => {
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'conch'), '#!/bin/sh\necho someone else\n');
    await expect(installShim({ ...base(), platform: 'linux', env: { PATH: bin } })).rejects.toThrow(
      /isn't Conch's/,
    );
    expect(readFileSync(join(bin, 'conch'), 'utf8')).toContain('someone else');
  });

  it('puts its folder on the user’s PATH on Windows, through PowerShell', async () => {
    const exec = vi.fn<Exec>(async () => ({ code: 0, stdout: '', stderr: '' }));
    const env = { LOCALAPPDATA: join(home, 'L'), Path: 'C:\\Windows' };
    const result = await installShim({ ...base(), platform: 'win32', env, exec });
    expect(result.file).toBe(join(home, 'L', 'Conch', 'bin', 'conch.cmd'));
    expect(result.ready).toBe(false);
    const [file, args, extra] = exec.mock.calls[0] ?? [];
    expect(file).toBe('powershell');
    expect(args).toContain('-NoProfile');
    expect(args?.at(-1)).toContain("SetEnvironmentVariable('Path'");
    // The folder travels in the environment, never inside the command.
    expect(extra).toEqual({ CONCH_BIN: join(home, 'L', 'Conch', 'bin') });
  });

  it('says so when Windows refuses the PATH change', async () => {
    const exec = vi.fn<Exec>(async () => ({ code: 1, stdout: '', stderr: 'denied' }));
    await expect(
      installShim({ ...base(), platform: 'win32', env: { LOCALAPPDATA: join(home, 'L') }, exec }),
    ).rejects.toThrow(/denied/);
  });
});

describe('removing it', () => {
  it('takes the command and every profile line away, and leaves the rest', async () => {
    writeFileSync(join(home, '.bashrc'), 'alias ll="ls -l"\n');
    const env = { PATH: '/usr/bin', SHELL: '/bin/bash' };
    const { file } = await installShim({ ...base(), platform: 'linux', env });
    await installShim({ ...base(), platform: 'linux', env: { ...env, SHELL: '/usr/bin/fish' } });
    expect(await removeShim({ home, platform: 'linux', env })).toEqual({ removed: true });
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(home, '.bashrc'), 'utf8')).toBe('alias ll="ls -l"\n');
    expect(existsSync(join(home, '.config', 'fish', 'conf.d', 'conch.fish'))).toBe(false);
    expect(await removeShim({ home, platform: 'linux', env })).toEqual({ removed: false });
  });

  it('leaves someone else’s conch alone', async () => {
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'conch'), 'not ours');
    expect(await removeShim({ home, platform: 'linux', env: {} })).toEqual({ removed: false });
    expect(existsSync(join(bin, 'conch'))).toBe(true);
  });
});

describe('cliName', () => {
  it('says conch once Conch’s command is on PATH, and pnpm conch before', async () => {
    const local = { LOCALAPPDATA: join(home, 'L'), HOME: home, USERPROFILE: home };
    const { dir, file } = shimPlace(process.platform, home, local);
    const env = { ...local, PATH: [join(home, 'x'), dir].join(delimiter) };
    expect(cliName(env, process.platform, true)).toBe('pnpm conch');
    await installShim({ ...base(), env });
    expect(cliName(env, process.platform, true)).toBe('conch');
    // Another program called conch doesn't count.
    writeFileSync(file, 'not ours');
    expect(cliName(env, process.platform, true)).toBe('pnpm conch');
  });
});
