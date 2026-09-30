import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fakeProgram } from '../test/fakeProgram';
import { launch, onWindowsPath, presentSync, run } from './proc';

const ECHO_ARGS = 'process.stdout.write(JSON.stringify(process.argv.slice(2)));';

/** Everything `cmd.exe` would act on, and a line break it can't pass at all. */
const HOSTILE = 'Fix "this" & echo pwned | more > out.txt ^ %PATH% !x! (a) <b>\nand a second line';

describe('running programs', () => {
  it('passes every argument through exactly, whatever it contains', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-proc-'));
    const bin = await fakeProgram(dir, 'echo-args', ECHO_ARGS);
    const result = await run(bin, [HOSTILE, '', 'two words']);
    expect(JSON.parse(result.stdout)).toEqual([HOSTILE, '', 'two words']);
  });

  it('says why a program couldn’t start', async () => {
    const result = await run(join(tmpdir(), 'conch-no-such-program'), []);
    expect(result.code).toBeUndefined();
    expect(result.stderr).toContain('ENOENT');
  });
});

describe.runIf(process.platform === 'win32')('Windows batch-file shims', () => {
  /** The shim `npm install -g` writes, verbatim but for the package. */
  const NPM_SHIM = [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\bin\\tool.js" %*',
  ].join('\r\n');

  /** The shape of the shim pnpm writes. */
  const PNPM_SHIM = [
    '@SETLOCAL',
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe"  "%~dp0\\..\\tool\\cli.js" %*',
    ') ELSE (',
    '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
    '  node  "%~dp0\\..\\tool\\cli.js" %*',
    ')',
  ].join('\r\n');

  it('runs the script behind an npm shim with Node, never through cmd.exe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-shim-'));
    const script = join(dir, 'node_modules', 'tool', 'bin', 'tool.js');
    await mkdir(join(dir, 'node_modules', 'tool', 'bin'), { recursive: true });
    await writeFile(script, ECHO_ARGS);
    const bin = join(dir, 'tool.cmd');
    await writeFile(bin, NPM_SHIM);

    expect(launch(bin)).toEqual({ command: process.execPath, prefix: [script] });
    const result = await run(bin, [HOSTILE]);
    expect(JSON.parse(result.stdout)).toEqual([HOSTILE]);
  });

  it('follows a pnpm shim, and prefers the Node beside it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-shim-'));
    const bin = join(dir, 'bin', 'tool.cmd');
    await mkdir(join(dir, 'bin'));
    await writeFile(bin, PNPM_SHIM);
    await writeFile(join(dir, 'bin', 'node.exe'), '');

    expect(launch(bin)).toEqual({
      command: join(dir, 'bin', 'node.exe'),
      prefix: [join(dir, 'tool', 'cli.js')],
    });
  });

  it('refuses a batch file it can’t see through', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-shim-'));
    const bin = join(dir, 'tool.cmd');
    await writeFile(bin, '@echo off\r\necho %*\r\n');
    expect(() => launch(bin)).toThrow(/can’t start safely/);
    expect((await run(bin, ['x'])).stderr).toMatch(/can’t start safely/);
  });

  it('finds commands the way cmd.exe does', () => {
    expect(onWindowsPath('node', process.env)).toBe(true);
    expect(onWindowsPath('node.exe', process.env)).toBe(true);
    expect(onWindowsPath(process.execPath, process.env)).toBe(true);
    expect(onWindowsPath('definitely-not-installed-xyz', process.env)).toBe(false);
  });

  // 1Password, winget and Store Python install as app execution aliases, which
  // `existsSync` can't see. Conch once said “Couldn’t find 1password-mcp” with it right there.
  it('finds app execution aliases, like the one winget installs as', (ctx) => {
    const aliases = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps');
    if (!presentSync(join(aliases, 'winget.exe'))) return ctx.skip();
    expect(existsSync(join(aliases, 'winget.exe'))).toBe(false);
    expect(onWindowsPath('winget', process.env)).toBe(true);
  });
});

describe('presentSync', () => {
  it('counts a link whose target can’t be opened, as an app alias is', async (ctx) => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-link-'));
    const link = join(dir, 'tool.exe');
    try {
      await symlink(join(dir, 'locked', 'tool.exe'), link, 'file');
    } catch (error) {
      // Windows only lets developers make links.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip();
      throw error;
    }
    expect(existsSync(link)).toBe(false);
    expect(presentSync(link)).toBe(true);
    expect(presentSync(join(dir, 'nothing.exe'))).toBe(false);
  });
});
