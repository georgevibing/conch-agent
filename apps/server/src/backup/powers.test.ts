import { BackupPower, POWER_TEXT_MAX } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { powersOf, previewReads } from './powers';

const reader = (files: Record<string, unknown>) => (path: string) =>
  path in files ? Buffer.from(JSON.stringify(files[path])) : undefined;

describe('what in a backup can act for you', () => {
  it('reads only the few files that can say so', () => {
    expect(
      [
        'integrations.json',
        'settings.json',
        'browser.json',
        'terminal.json',
        'channels.json',
        'channels.secrets.json',
        'routines/r_1.json',
        'routines/r_1.runs.jsonl',
        'memory/m_1.md',
        'integrations.secrets.json',
        'skills.trust.json',
        'skills.signing.json',
      ].filter(previewReads),
    ).toEqual([
      'integrations.json',
      'settings.json',
      'browser.json',
      'terminal.json',
      'channels.json',
      'routines/r_1.json',
      'skills.trust.json',
    ]);
  });

  it('names every model server a backup would send your chats to (ADR 0053)', () => {
    const powers = powersOf(
      ['settings.json'],
      reader({
        'settings.json': {
          servers: [
            { id: 'server-abcdefgh', name: 'The GPU box', url: 'http://10.0.0.5:8000/v1', addedAt: 1 },
            { id: 'server-ijklmnop', name: '', url: 'https://gateway.example.com/v1', addedAt: 2 },
          ],
        },
      }),
    );
    expect(powers).toEqual([
      {
        kind: 'provider-servers',
        servers: ['The GPU box (10.0.0.5:8000)', 'A server (gateway.example.com)'],
        more: 0,
      },
    ]);
    for (const power of powers) expect(BackupPower.safeParse(power).success).toBe(true);
  });

  it('names whose skills it trusts, so a backup can’t quietly vouch for someone (ADR 0031)', () => {
    const powers = powersOf(
      ['skills.trust.json'],
      reader({
        'skills.trust.json': {
          publishers: [
            { fingerprint: 'A', key: 'k', name: 'Me', trustedAt: 1, you: true },
            { fingerprint: 'B', key: 'k', name: 'Ada', trustedAt: 2 },
          ],
        },
      }),
    );
    // Your own key isn't someone else's power.
    expect(powers).toEqual([{ kind: 'trusted-publishers', names: ['Ada'], more: 0 }]);
    for (const power of powers) expect(BackupPower.safeParse(power).success).toBe(true);
  });

  it('names who a bot will talk to, so an old backup can’t quietly let someone back in', () => {
    const powers = powersOf(
      ['channels.json'],
      reader({
        'channels.json': {
          version: 1,
          channels: [
            {
              kind: 'telegram',
              bot: { name: 'Ada’s Conch' },
              people: [{ name: 'Ada' }, { name: 'Sam' }],
            },
            // Turned off, or nobody let in: nothing to say.
            { kind: 'discord', enabled: false, bot: { name: 'Off' }, people: [{ name: 'X' }] },
            { kind: 'slack', bot: { name: 'Empty' }, people: [] },
          ],
        },
      }),
    );
    expect(powers).toEqual([
      { kind: 'channel-people', name: 'Ada’s Conch on Telegram', people: ['Ada', 'Sam'], more: 0 },
    ]);
    for (const power of powers) expect(BackupPower.safeParse(power).success).toBe(true);
  });

  it('cuts names from the file to size, and counts what it doesn’t list', () => {
    const long = 'x'.repeat(5000);
    const powers = powersOf(
      ['integrations.json', 'browser.json'],
      reader({
        'integrations.json': {
          integrations: [
            {
              name: long,
              enabled: true,
              transport: { type: 'stdio', command: long, args: [] },
              tools: Array.from({ length: 25 }, (_, i) => ({ name: `tool_${i}`, policy: 'allow' })),
            },
          ],
        },
        'browser.json': {
          sites: Array.from({ length: 23 }, (_, i) => ({ site: `site${i}.example` })),
        },
      }),
    );
    for (const power of powers) expect(BackupPower.safeParse(power).success).toBe(true);
    const [runs, tools, sites] = powers;
    expect(runs).toMatchObject({ kind: 'runs-program' });
    expect(runs?.kind === 'runs-program' && runs.name.length).toBe(POWER_TEXT_MAX);
    expect(tools).toMatchObject({ kind: 'tools-never-ask', more: 5 });
    expect(sites).toMatchObject({ kind: 'browser-sites', more: 3 });
  });

  it('lists what a store would still load, even with something else off about it', () => {
    // No `enabled`, no name: the store may still load it, so it's listed.
    const powers = powersOf(
      ['integrations.json'],
      reader({
        'integrations.json': {
          integrations: [{ server: 'tool', transport: { type: 'stdio', command: 'run-me' } }],
        },
      }),
    );
    expect(powers).toEqual([{ kind: 'runs-program', name: 'tool', command: 'run-me' }]);
  });

  it('says nothing about a file that won’t read: its store sets it aside', () => {
    const read = (path: string) => (path === 'settings.json' ? Buffer.from('{oops') : undefined);
    expect(powersOf(['settings.json'], read)).toEqual([]);
  });
});
