import { describe, expect, it } from 'vitest';

import { interestsIn, startersFor } from './welcome';

describe('the welcome’s words', () => {
  it('reads back what an earlier welcome kept in About you, and nothing from other words', () => {
    expect(
      interestsIn(
        'I’d mostly like a hand with coding, research and email and my calendar.\nI build compilers.',
      ),
    ).toEqual(['coding', 'research', 'email']);
    expect(interestsIn('I build compilers.')).toEqual([]);
    expect(interestsIn('')).toEqual([]);
  });

  it('offers three things to ask first, from earlier picks and then for anyone', () => {
    expect(startersFor(['email'])).toEqual([
      'What needs my attention in my inbox today?',
      'Help me plan my week',
      'Teach me something new in five minutes',
    ]);
    expect(startersFor([])).toEqual([
      'Help me plan my week',
      'Teach me something new in five minutes',
      'Brainstorm ten ideas for a weekend project',
    ]);
  });
});
