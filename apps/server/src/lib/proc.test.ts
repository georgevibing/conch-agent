import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fakeProgram } from '../test/fakeProgram';
import { launch, onWindowsPath, run } from './proc';

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
});
