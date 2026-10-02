import { describe, expect, it } from 'vitest';

import { isAtLeast, MIN_VERSION, parseVersion } from './detect';

describe('Codex discovery compatibility', () => {
  it('accepts the app-server minimum but not an older exec-only runtime', () => {
    expect(isAtLeast('0.159.0', MIN_VERSION)).toBe(true);
    expect(isAtLeast('0.52.1', MIN_VERSION)).toBe(false);
    expect(isAtLeast('1.0.0', MIN_VERSION)).toBe(true);
  });
  it('does not invent a supported version for an unknown build', () => {
    expect(parseVersion('codex 0.159.0')).toBe('0.159.0');
    expect(parseVersion('codex development')).toBeUndefined();
  });
});
