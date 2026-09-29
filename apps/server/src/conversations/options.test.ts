import { describe, expect, it } from 'vitest';

import { resolveOptions } from './manager';

describe('resolveOptions', () => {
  const defaults = {
    model: 'sonnet',
    effort: 'auto' as const,
    fastMode: false,
    permissionMode: 'default' as const,
  };

  it('uses defaults when the conversation has no overrides', () => {
    expect(resolveOptions({}, defaults)).toEqual(defaults);
  });

  it('lets conversation choices win, key by key', () => {
    expect(resolveOptions({ effort: 'high', fastMode: true }, defaults)).toEqual({
      model: 'sonnet',
      effort: 'high',
      fastMode: true,
      permissionMode: 'default',
    });
  });
});
