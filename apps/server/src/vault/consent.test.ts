import { describe, expect, it } from 'vitest';

import { consented, names } from './consent';

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
