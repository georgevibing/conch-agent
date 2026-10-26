import { describe, expect, it } from 'vitest';

import { allMissing, missingAppsNote } from './missing';

describe('missingAppsNote', () => {
  it('says nothing when every app’s tools came', () => {
    expect(missingAppsNote([])).toBeUndefined();
  });

  it('names the apps whose tools didn’t load, and what to try first', () => {
    const note = missingAppsNote([{ name: 'github', error: 'Connection closed' }]) ?? '';
    expect(note).toContain('`github` (Connection closed)');
    expect(note).toMatch(/another way first/);
    expect(note).toMatch(/Only if none can/);
  });

  it('counts every server as missing when the bridge couldn’t open at all', () => {
    expect(allMissing(['github', 'supabase'], new Error('boom'))).toEqual([
      { name: 'github', error: 'boom' },
      { name: 'supabase', error: 'boom' },
    ]);
  });
});
