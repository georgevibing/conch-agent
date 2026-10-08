import { removedWords } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { luhn, Redaction } from './redact';

const key = 'sk-' + 'proj-abcdefghijklmnopqrstuvwxyz123456';
const github = 'ghp_' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';

describe('taking things out of a trajectory', () => {
  it('takes out keys, addresses, numbers, the home folder and your names', () => {
    const r = new Redaction({ home: '/Users/ada', names: ['Ada Lovelace', 'Lina'] });
    const out = r.text(
      [
        `export OPENAI_API_KEY=${key}`,
        `git remote set-url origin https://${github}@github.com/ada/x`,
        'Mail ada@example.com or call +49 151 2345 6789',
        'Card 4111 1111 1111 1111, server 52.14.88.3',
        'Opened /Users/ada/Projects/notes.md',
        'Ada asked Lina to look.', // and "ada" in the address above
      ].join('\n'),
    );
    for (const secret of [
      key,
      github,
      'ada@example.com',
      '2345 6789',
      '4111 1111',
      '52.14.88.3',
      '/Users/ada',
      'Lina',
    ])
      expect(out).not.toContain(secret);
    expect(out).toContain('OPENAI_API_KEY=[key]');
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[card]');
    expect(out).toContain('[address]');
    expect(out).toContain('~/Projects/notes.md');
    expect(out).toContain('[name] asked [name] to look.');

    const removed = r.removed();
    expect(Object.fromEntries(removed.map((x) => [x.kind, x.count]))).toMatchObject({
      key: 2,
      email: 1,
      phone: 1,
      card: 1,
      address: 1,
      home: 1,
      name: 3,
    });
    // Where it was, never what it was.
    for (const item of removed)
      for (const example of item.examples)
        for (const secret of [key, github, 'ada@example.com', '52.14.88.3', 'Lina'])
          expect(example).not.toContain(secret);
    expect(removed.find((x) => x.kind === 'key')?.examples[0]).toContain('OPENAI_API_KEY=[key]');
    expect(removedWords(removed)).toMatch(/^2 keys and tokens, 1 email address, .* and 3 names$/);
  });

  it('leaves dates, versions, ids, times and home networks alone', () => {
    const r = new Redaction({ home: '/Users/ada' });
    const text =
      'On 2026-10-08 at 12:30:45 v1.24.3 built #1234567 in 4.2s; port 4317 on 192.168.1.20 and 127.0.0.1; ' +
      'order 1234567890123 (not a card); uuid 550e8400-e29b-41d4-a716-446655440000';
    expect(r.text(text)).toBe(text);
    expect(r.removed()).toEqual([]);
  });

  it('takes out every secret Conch knows, as the vault knows them', () => {
    const r = new Redaction({ known: (t) => t.split('hunter2-secret').join('•••') });
    expect(r.text('the password is hunter2-secret')).toBe('the password is [password]');
    expect(r.removed()).toEqual([
      { kind: 'password', count: 1, examples: ['the password is [password]'] },
    ]);
  });

  it('goes through every string in a tool’s arguments', () => {
    const r = new Redaction({ home: '/home/ada' });
    expect(r.value({ path: '/home/ada/a.txt', n: 3, list: ['ada@example.com'] })).toEqual({
      path: '~/a.txt',
      n: 3,
      list: ['[email]'],
    });
  });

  it('knows a card number from any long number', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
  });
});
