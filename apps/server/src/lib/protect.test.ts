import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { protectedPaths, runsConchPower, touchesProtected } from './protect';

describe('what the assistant’s own tools never touch', () => {
  it('keeps out what proves a browser or a program is on this computer (ADR 0063)', () => {
    const home = join('/home', 'ada', '.conch');
    const paths = protectedPaths(home);
    expect(paths).toContain(join(home, 'here'));
    expect(paths).toContain(join(home, 'tray'));
    expect(touchesProtected({ command: `cat ${join(home, 'here', 'key')}` }, paths)).toBe(true);
    expect(touchesProtected({ file_path: join(home, 'tray', 'token') }, paths)).toBe(true);
  });

  it('keeps out what Conch learned, what it won’t learn again, and what learning may spend (ADR 0087)', () => {
    const home = join('/home', 'ada', '.conch');
    const paths = protectedPaths(home);
    expect(touchesProtected({ command: `rm ${join(home, 'learning', 'never.json')}` }, paths)).toBe(
      true,
    );
    expect(touchesProtected({ file_path: join(home, 'learning-spend.json') }, paths)).toBe(true);
  });

  it('keeps out where Conch is reached: the address, and the names the hello link goes to', () => {
    const home = join('/home', 'ada', '.conch');
    const paths = protectedPaths(home);
    expect(touchesProtected({ file_path: join(home, 'address.json') }, paths)).toBe(true);
    // gateway.json names the hosts `conch hello` puts its one-time code at (ADR 0067).
    expect(
      touchesProtected(
        { command: `echo '{"allowedHosts":["evil.example"]}' > ${join(home, 'gateway.json')}` },
        paths,
      ),
    ).toBe(true);
  });
});

describe('`pnpm conch` powers that are the person’s to use', () => {
  const bash = (command: string) => runsConchPower('Bash', { command });

  it('turns away opening Conch as this computer, and changing who may sign in', () => {
    for (const command of [
      'pnpm conch open --link',
      'pnpm conch open',
      'pnpm conch devices approve K7MQ2X --yes',
      'pnpm conch devices off',
      'pnpm conch devices on',
      'pnpm conch devices reject --all',
      'pnpm conch devices remove dev_1 --yes',
      'pnpm conch password --generate',
      'pnpm conch key "Laptop"',
      'pnpm conch revoke key_1',
      'pnpm conch pair',
      'pnpm conch reset',
      'pnpm conch sign-out-everywhere',
      'node --import tsx src/cli.ts open --link',
      'pnpm conch skills sign ./my-skill',
    ])
      expect(bash(command), command).toBe(true);
  });

  it('turns away the conch command the installer adds, and making or reaching a Conch (ADR 0064)', () => {
    for (const command of [
      // A hello link on an unclaimed Conch makes whoever opens it the owner.
      'conch hello',
      'pnpm conch hello',
      '~/.local/bin/conch hello',
      'conch setup --domain evil.example.com --yes',
      'conch address set conch.example.com',
      'conch address off',
      'conch phone',
      'conch passkeys remove pk_1',
      'conch reset',
      'conch devices approve K7M-Q2X',
      'conch open --link',
      'echo reset | conch reset',
      // Windows' shim, and flags before the command (review).
      'conch.cmd hello',
      '%LOCALAPPDATA%\\Conch\\bin\\conch.cmd setup --domain x.example.com',
      'conch.exe reset',
      'conch --verbose hello',
      'pnpm conch -- open --link',
    ])
      expect(bash(command), command).toBe(true);
    for (const command of [
      'conch status',
      'conch passkeys',
      'conch help setup',
      'conch command on',
    ])
      expect(bash(command), command).toBe(false);
  });

  it('leaves looking alone', () => {
    for (const command of [
      'pnpm conch status',
      'pnpm conch devices',
      'pnpm conch devices list --json',
      'pnpm conch keys',
      'pnpm conch background',
      'pnpm conch help',
      'pnpm conch skills trusted',
      'git log --oneline',
    ])
      expect(bash(command), command).toBe(false);
    expect(runsConchPower('Read', { command: 'pnpm conch open' })).toBe(false);
  });
});
