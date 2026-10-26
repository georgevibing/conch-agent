import { describe, expect, it } from 'vitest';

import type { RunResult } from '../lib/proc';
import { cleanAccount, Clis, clisPrompt, readGhStatus } from './clis';

const out = (stdout: string, stderr = '', code: number | undefined = 0): RunResult => ({
  stdout,
  stderr,
  code,
});

describe('readGhStatus', () => {
  it('reads every account and the active one, never the token', () => {
    const text = [
      'github.com',
      '  ✓ Logged in to github.com account georgevibing (keyring)',
      '  - Active account: true',
      '  - Token: gho_************************************',
      '',
      '  ✓ Logged in to github.com account giotiskl (keyring)',
      '  - Active account: false',
    ].join('\n');
    const state = readGhStatus(out('', text));
    expect(state).toEqual({
      accounts: ['georgevibing', 'giotiskl'],
      active: 'georgevibing',
      signedIn: 'yes',
    });
    expect(JSON.stringify(state)).not.toContain('gho_');
  });

  it('reads the older wording, and other hosts are left out', () => {
    const text =
      '  ✓ Logged in to github.com as octo (oauth_token)\n  ✓ Logged in to ghe.example.com as boss (oauth_token)';
    expect(readGhStatus(out(text)).accounts).toEqual(['octo']);
  });

  it('says signed out', () => {
    expect(readGhStatus(out('', 'You are not logged into any GitHub hosts.', 1)).signedIn).toBe(
      'out',
    );
  });
});

describe('cleanAccount', () => {
  it('keeps names and emails, drops anything key-shaped', () => {
    expect(cleanAccount('me@example.com')).toBe('me@example.com');
    expect(cleanAccount('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBeUndefined();
    expect(cleanAccount('github_pat_11AAA')).toBeUndefined();
    expect(cleanAccount('eyJhbGciOi.payload')).toBeUndefined();
    expect(cleanAccount('a'.repeat(50))).toBeUndefined();
    expect(cleanAccount('two words')).toBeUndefined();
  });
});

describe('Clis', () => {
  const probes = [
    {
      name: 'gh',
      about: 'GitHub',
      find: () => Promise.resolve('/bin/gh'),
      ask: ['auth', 'status'],
      read: readGhStatus,
    },
    {
      name: 'wrangler',
      about: 'Cloudflare',
      find: () => Promise.resolve('/bin/wrangler'),
      ask: ['whoami'],
      read: () => ({ accounts: [], signedIn: 'out' as const }),
    },
    { name: 'docker', about: 'containers', find: () => Promise.resolve('/bin/docker') },
    { name: 'fly', about: 'Fly', find: () => Promise.resolve(undefined) },
  ];

  it('lists what is here and as whom, asking each program once while it is fresh', async () => {
    let asked = 0;
    const clis = new Clis({
      probes,
      run: (file) => {
        asked += 1;
        return Promise.resolve(
          file === '/bin/gh'
            ? out(
                '',
                '✓ Logged in to github.com account georgevibing (keyring)\n- Active account: true',
              )
            : out(''),
        );
      },
    });
    const text = await clis.promptSection();
    expect(text).toContain('`gh` (GitHub) — signed in as georgevibing');
    expect(text).toContain('`wrangler` (Cloudflare) — not signed in');
    expect(text).toContain('`docker` (containers) — installed');
    expect(text).not.toContain('`fly`');
    expect(text).toContain('`secrets` option');
    await clis.promptSection();
    expect(asked).toBe(2);
  });

  it("doesn't hold a turn up for a slow program", async () => {
    const clis = new Clis({
      probes,
      waitMs: 10,
      run: () => new Promise<RunResult>(() => undefined),
    });
    expect(await clis.states()).toEqual([]);
  });

  it('says nothing when nothing is here', () => {
    expect(clisPrompt([])).toBe('');
  });
});
