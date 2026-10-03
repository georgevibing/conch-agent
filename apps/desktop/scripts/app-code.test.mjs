import { describe, expect, it } from 'vitest';

import { pnpmCommand } from './app-code.mjs';

describe('running pnpm from a script', () => {
  it('starts pnpm 12’s own program directly', () => {
    expect(
      pnpmCommand(
        ['install'],
        { npm_execpath: '/home/me/.cache/node/corepack/v1/pnpm/12.6.0/pnpm-native' },
        'linux',
      ),
    ).toEqual({
      command: '/home/me/.cache/node/corepack/v1/pnpm/12.6.0/pnpm-native',
      args: ['install'],
      shell: false,
    });
    expect(
      pnpmCommand(['install'], { npm_execpath: 'C:\\Users\\me\\pnpm\\pnpm.exe' }, 'win32').shell,
    ).toBe(false);
  });

  it('runs a pnpm script with this Node, and falls back to the pnpm on PATH', () => {
    expect(
      pnpmCommand(['x'], { npm_execpath: '/usr/lib/node_modules/pnpm/bin/pnpm.cjs' }, 'linux'),
    ).toEqual({
      command: process.execPath,
      args: ['/usr/lib/node_modules/pnpm/bin/pnpm.cjs', 'x'],
      shell: false,
    });
    expect(pnpmCommand(['x'], {}, 'linux')).toEqual({ command: 'pnpm', args: ['x'], shell: false });
    expect(pnpmCommand(['x'], { npm_execpath: 'C:\npm\npm-cli.js' }, 'win32')).toEqual({
      command: 'pnpm.cmd',
      args: ['x'],
      shell: true,
    });
  });
});
