import { describe, expect, it } from 'vitest';

import { consented, named, names } from './consent';

describe('the person naming a saved item', () => {
  it('reads every word of the title, in any case and order', () => {
    expect(names('I added a gh pat giotiskl, use it', 'Gh pat giotiskl')).toBe(true);
    expect(names('use the PAT for giotiskl on gh', 'Gh pat giotiskl')).toBe(true);
    expect(names('use the gh pat', 'Gh pat giotiskl')).toBe(false);
  });

  it('wants a word for a secret beside a one-word title', () => {
    expect(names('check github for the repo', 'GitHub')).toBe(false);
    expect(names('use my github token', 'GitHub')).toBe(true);
  });

  it('never matches an empty title', () => {
    expect(names('use the password', '—')).toBe(false);
  });
});

describe('no card for a saved item', () => {
  const said = () => ['read the PIN of Travel Visa'];
  it('in Auto when named, but not for a grave value read into the model', () => {
    expect(consented({ permissionMode: 'auto', said }, 'Travel Visa')).toBe(true);
    expect(consented({ permissionMode: 'auto', said }, 'Travel Visa', { grave: true })).toBe(false);
  });

  it('in Full trust, grave or not', () => {
    const trust = { permissionMode: 'bypassPermissions' as const, fullTrust: () => true };
    expect(consented(trust, 'Travel Visa', { grave: true })).toBe(true);
  });
});

describe('naming a key for a command, unseen', () => {
  it('takes a word of the title beside a word for a secret', () => {
    expect(named('use my saved Stripe key to list charges', 'Stripe live key')).toBe(true);
    expect(named('query it with the cloudflare token', 'CLOUDFLARE_API_TOKEN')).toBe(true);
  });

  it('takes a secret word of the title beside one saying they keep it', () => {
    expect(named('clone the private repo with the PAT I saved', 'Gh pat giotiskl')).toBe(true);
    expect(named('use the token in Passwords', 'Vercel token')).toBe(true);
  });

  it('needs more than a passing word', () => {
    expect(named('check stripe for last week', 'Stripe live key')).toBe(false);
    expect(named('use a key', 'Stripe live key')).toBe(false);
    // Reading a value into the model keeps the strict rule.
    expect(names('use my saved Stripe key', 'Stripe live key')).toBe(false);
  });

  it('names an item by its site, and not by a secret word another item shares', () => {
    expect(named('use my github token', 'Gh pat giotiskl', { sites: ['github.com'] })).toBe(true);
    expect(named('use my github token', 'Gh pat giotiskl')).toBe(false);
    const saved = { others: ['Stripe live key'] };
    expect(named('use my saved key for the API', 'House key code', saved)).toBe(false);
    // The only item whose title has "pat": "the PAT I saved" is that one.
    expect(named('the PAT I saved', 'Gh pat giotiskl', saved)).toBe(true);
    expect(named('the PAT I saved', 'Gh pat giotiskl', { others: ['Old PAT'] })).toBe(false);
  });

  it('weighs the item’s sites and the other items when asked for a command', () => {
    const said = () => ['use my saved key for the API'];
    const ctx = { permissionMode: 'auto' as const, said };
    expect(consented(ctx, 'House key code', { loose: { others: ['Stripe live key'] } })).toBe(
      false,
    );
  });

  it('a task from a watched chat counts as answered, a routine doesn’t', () => {
    const said = () => ['use the gh pat giotiskl'];
    const task = { permissionMode: 'auto' as const, unattended: true, attended: true, said };
    expect(consented(task, 'Gh pat giotiskl')).toBe(true);
    expect(consented({ ...task, attended: false }, 'Gh pat giotiskl')).toBe(false);
  });
});
