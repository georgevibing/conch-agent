import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';
import { SEAL_SCRIPT, sandboxSupport, sealCommand } from './sandbox';

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
  it('offers Conch’s one command where it can fix things, and nothing where it can’t', () => {
    // Missing programs: the script installs them.
    expect(
      sandboxSupport(
        (name) => name !== 'bwrap',
        'linux',
        () => false,
      ),
    ).toMatchObject({
      available: false,
      command: sealCommand(),
    });
    // Installed, but Ubuntu restricts its sandbox: the script allows it.
    expect(
      sandboxSupport(
        () => true,
        'linux',
        () => false,
        () => true,
      ),
    ).toMatchObject({ available: false, command: sealCommand() });
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
  it('types the script by its own path, quoted for any folder name', () => {
    expect(SEAL_SCRIPT).toMatch(/seal-commands\.sh$/);
    expect(existsSync(SEAL_SCRIPT)).toBe(true);
    // It's shell a system can read (where there's a shell to ask).
    const syntax = spawnSync('sh', ['-n', SEAL_SCRIPT]);
    if (!syntax.error) expect(syntax.status).toBe(0);
    expect(sealCommand("/home/a b/it's/seal.sh")).toBe(
      String.raw`sudo sh '/home/a b/it'\''s/seal.sh'`,
    );
  });
});
