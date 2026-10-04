import { describe, expect, it } from 'vitest';

import type { Engine } from '../engines/types';
import { offerTools } from './tools';

describe('offer', () => {
  const [offer] = offerTools(
    { propose: async () => ({ dropped: 'not-in-map' as const }) },
    { conversationId: 'c1', engine: {} as Engine, append: () => undefined },
  );

  // Claude Code defers tools until searched for, by their full name
  // (`mcp__conch__offer`). The map tells the model to call `offer`, so it must
  // already be there: deferred, the model called `offer` and got "No such tool".
  it('is loaded up front, and found by what a person asks for', () => {
    expect(offer?.name).toBe('offer');
    expect(offer?.alwaysLoad).toBe(true);
    expect(offer?.searchHint).toMatch(/connect/);
    expect(offer?.searchHint).toMatch(/skill/);
  });
});
