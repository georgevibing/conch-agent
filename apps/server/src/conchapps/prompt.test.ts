import { describe, expect, it } from 'vitest';

import { MAKING_APPS } from './prompt';

describe('making apps, beside what Conch can turn on', () => {
  // Asked about Todoist, the assistant offered to build a Todoist app instead
  // of the card that connects the one in the catalog (ADR 0060, ADR 0061).
  it('makes an app only for what nothing they have or could turn on does', () => {
    expect(MAKING_APPS).toMatch(/What Conch can turn on/);
    expect(MAKING_APPS).toMatch(/offer that instead/);
  });
});
