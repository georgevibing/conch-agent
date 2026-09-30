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
        'routines/r_1.json',
        'routines/r_1.runs.jsonl',
        'memory/m_1.md',
        'integrations.secrets.json',
      ].filter(previewReads),
    ).toEqual([
      'integrations.json',
      'settings.json',
      'browser.json',
      'terminal.json',
      'routines/r_1.json',
    ]);
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
