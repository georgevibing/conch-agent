// How the app's own code is built (ADR 0054): one CommonJS file Electron runs,
// with its pictures and pages beside it. Shared by bundle.mjs and dev.mjs.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(dirname(fileURLToPath(import.meta.url)));
export const out = join(here, 'dist');
const icons = join(here, '..', 'web', 'public', 'icons');

/** @type {import('esbuild').BuildOptions} */
export const options = {
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(out, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Electron is the app itself; everything else is bundled, so the package needs no node_modules.
  external: ['electron'],
  // Shared code from the gateway reads its own folder; in one CommonJS file that's __dirname.
  define: { 'import.meta.dirname': '__dirname' },
  sourcemap: 'linked',
  logLevel: 'warning',
  legalComments: 'none',
};

/** The status page and the app's pictures (the web app's own) in dist/resources. */
export function resources() {
  const dir = join(out, 'resources');
  mkdirSync(dir, { recursive: true });
  for (const name of ['status.html', 'status.js', 'edge.html', 'stop.html', 'stop.js'])
    copyFileSync(join(here, 'pages', name), join(dir, name));
  copyFileSync(join(icons, 'conch-512.png'), join(dir, 'icon.png'));
  copyFileSync(join(icons, 'conch-tray-256.png'), join(dir, 'tray.png'));
  // Windows draws each size from a picture of its own (scripts/icons.mjs).
  copyFileSync(join(icons, 'conch.ico'), join(dir, 'icon.ico'));
  copyFileSync(join(icons, 'conch-tray.ico'), join(dir, 'tray.ico'));
}

/**
 * How to run pnpm from a script that pnpm started: the program in
 * `npm_execpath` (pnpm 12's own native program, or a script for Node), else
 * the `pnpm` on PATH (a `.cmd` on Windows, which only cmd.exe can start).
 */
export function pnpmCommand(args, env = process.env, platform = process.platform) {
  const exec = env.npm_execpath;
  if (exec && /pnpm/i.test(exec)) {
    if (/\.[cm]?js$/i.test(exec))
      return { command: process.execPath, args: [exec, ...args], shell: false };
    if (!/\.(cmd|bat|ps1)$/i.test(exec)) return { command: exec, args, shell: false };
  }
  return {
    command: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
    // Every argument here is the script's own, never a person's.
    shell: platform === 'win32',
  };
}
