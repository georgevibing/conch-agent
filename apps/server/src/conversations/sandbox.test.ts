import { describe, expect, it, vi } from 'vitest';
import { BWRAP_PROFILE, SYSTEM_BWRAP, sandboxSupport, sealCommand } from './sandbox';

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
