import { describe, expect, it } from 'vitest';

import { modelLabel } from './catalog';

describe('modelLabel', () => {
  it('moves an engine’s “(recommended)” into a badge', () => {
    expect(modelLabel('Default (recommended)')).toEqual({
      label: 'Default',
      badge: 'Recommended',
    });
    expect(modelLabel('Sonnet (Recommended) ')).toEqual({
      label: 'Sonnet',
      badge: 'Recommended',
    });
  });

  it('leaves other names alone, including other parentheses', () => {
    expect(modelLabel('Opus 5.5')).toEqual({ label: 'Opus 5.5' });
    expect(modelLabel('Opus 5.5 (1M context)')).toEqual({ label: 'Opus 5.5 (1M context)' });
  });
});
