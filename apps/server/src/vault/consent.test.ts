import { describe, expect, it } from 'vitest';

import { names } from './consent';

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
