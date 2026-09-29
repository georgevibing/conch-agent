import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Install a stand-in command-line program written as a CommonJS Node script,
 * the way npm installs a real one: run by its `#!` line on macOS and Linux, and
 * behind a `.cmd` shim on Windows. Returns the path to hand to Conch.
 *
 * Scripts end by setting `process.exitCode`, never `process.exit()`: on Windows
 * a pipe is written asynchronously, and exiting early would drop the output.
 */
export async function fakeProgram(dir: string, name: string, source: string): Promise<string> {
  if (process.platform === 'win32') {
    await writeFile(join(dir, `${name}.js`), source);
    const bin = join(dir, `${name}.cmd`);
    await writeFile(bin, `@ECHO off\r\nnode "%~dp0\\${name}.js" %*\r\n`);
    return bin;
  }
  const bin = join(dir, name);
  await writeFile(bin, `#!/usr/bin/env node\n${source}`);
  await chmod(bin, 0o755);
  return bin;
}
