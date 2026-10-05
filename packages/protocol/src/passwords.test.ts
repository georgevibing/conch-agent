import { describe, expect, it } from 'vitest';

import { passwordScore } from './passwords';

describe('password scoring', () => {
  it.each(['Password123!', '__123PASSWORD!__', '🔒password🔒', 'welcome', '12345', 'aaaaaa'])(
    'recognises common passwords with surrounding adornments: %s',
    (password) => expect(passwordScore(password)).toBe(0),
  );

  it('does not retry long digit or symbol runs before a common password', () => {
    const began = Date.now();
    // Both fit the vault's 20,000-character field limit.
    expect(passwordScore(`${'0'.repeat(19_992)}password`)).toBe(0);
    expect(passwordScore(`${'_!'.repeat(9_000)}password${'0'.repeat(1_992)}`)).toBe(0);
    expect(Date.now() - began).toBeLessThan(1000);
  });

  it('preserves uncommon and empty password scores', () => {
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('Cobalt!River7Juniper#Cloud42')).toBe(4);
  });
});
