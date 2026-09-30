import { describe, expect, it } from 'vitest';

import { honouredMode } from './engine';

describe('honouredMode', () => {
  it('keeps a mode the provider honours', () => {
    expect(honouredMode('acceptEdits', ['plan', 'acceptEdits', 'bypassPermissions'])).toBe(
      'acceptEdits',
    );
  });

  it('falls back to the provider’s first, safest mode for one it can’t honour', () => {
    // Codex can't ask first or judge risk, so those read as "plan only", never as licence to write.
    expect(honouredMode('auto', ['plan', 'acceptEdits', 'bypassPermissions'])).toBe('plan');
    expect(honouredMode('default', ['plan', 'acceptEdits', 'bypassPermissions'])).toBe('plan');
    expect(honouredMode('auto', ['default', 'acceptEdits', 'plan'])).toBe('default');
  });

  it('keeps the wish when the provider hasn’t said what it honours', () => {
    expect(honouredMode('acceptEdits', [])).toBe('acceptEdits');
    expect(honouredMode('acceptEdits', undefined)).toBe('acceptEdits');
  });
});
