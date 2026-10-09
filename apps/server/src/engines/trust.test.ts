import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runsUnsealedByTrust } from './trust';
import type { TurnInput } from './types';

const cwd = join(homedir(), '.conch', 'workspace');
const as = (permissionMode: string, tainted = false) =>
  ({ cwd, options: { permissionMode }, tainted }) as unknown as Pick<
    TurnInput,
    'cwd' | 'options' | 'tainted'
  >;

describe('Full trust runs what a seal would only break', () => {
  it('lets git and installs reach the network', () => {
    expect(runsUnsealedByTrust(as('bypassPermissions'), 'git pull --ff-only')).toBe(true);
    expect(runsUnsealedByTrust(as('bypassPermissions'), 'pnpm install')).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'lets a command work in another of the person’s folders',
    () => {
      const repo = join(homedir(), 'projects', 'conch-agent');
      expect(runsUnsealedByTrust(as('bypassPermissions'), `cd ${repo} && pnpm check`)).toBe(true);
      expect(runsUnsealedByTrust(as('bypassPermissions'), 'cd ~/projects/x && ls')).toBe(true);
    },
  );

  it('keeps the seal for work in its own folder, the system’s folders and scratch space', () => {
    expect(runsUnsealedByTrust(as('bypassPermissions'), `ls ${cwd}/src`)).toBe(false);
    expect(runsUnsealedByTrust(as('bypassPermissions'), 'cat /etc/hostname && ls /tmp/x')).toBe(
      false,
    );
  });

  it('Auto does the same until the chat reads something (ADR 0100)', () => {
    expect(runsUnsealedByTrust(as('auto'), 'pnpm install')).toBe(true);
    expect(runsUnsealedByTrust(as('auto'), `ls ${cwd}/src`)).toBe(false);
    expect(runsUnsealedByTrust(as('auto', true), 'pnpm install')).toBe(false);
  });

  it('never skips the seal in any other mode', () => {
    expect(runsUnsealedByTrust(as('default'), 'git pull')).toBe(false);
    expect(runsUnsealedByTrust(as('plan'), 'cd ~/projects/x && ls')).toBe(false);
  });
});
