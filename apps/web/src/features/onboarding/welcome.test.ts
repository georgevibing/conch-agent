import { describe, expect, it } from 'vitest';

import { aboutWith, appsFor, hello, interestsIn, startersFor } from './welcome';

describe('the welcome’s words', () => {
  it('writes what was picked into About you as one sentence, and reads it back', () => {
    const about = aboutWith('', ['coding', 'research', 'email']);
    expect(about).toBe('I’d mostly like a hand with coding, research and email and my calendar.');
    expect(interestsIn(about)).toEqual(['coding', 'research', 'email']);
  });

  it('keeps what the person wrote, and replaces an earlier welcome’s sentence', () => {
    const first = aboutWith('I build compilers.', ['coding']);
    expect(first).toBe('I’d mostly like a hand with coding.\nI build compilers.');
    const again = aboutWith(first, ['writing']);
    expect(again).toBe('I’d mostly like a hand with writing.\nI build compilers.');
    expect(aboutWith(again, [])).toBe('I build compilers.');
  });

  it('greets by name in every voice, and without one', () => {
    for (const tone of ['warm', 'concise', 'playful', 'precise'] as const) {
      expect(hello(tone, 'Ada')).toContain('Ada');
      expect(hello(tone, '  ')).not.toMatch(/,\s*\.|!\s*Finally|\s{2}/);
    }
  });

  it('puts the apps a pick calls for first, only ones the catalog has, nine at most', () => {
    const all = new Set([
      'gmail',
      'notion',
      'slack',
      'github',
      'linear',
      'todoist',
      'dropbox',
      'canva',
      'calendly',
      'vercel',
      'sentry',
      'miro',
    ]);
    const apps = appsFor(['coding'], all);
    expect(apps.slice(0, 4)).toEqual(['github', 'linear', 'vercel', 'sentry']);
    expect(apps).toHaveLength(9);
    // Several picks take turns: each one's first app comes before anyone's second.
    expect(appsFor(['coding', 'email', 'writing'], all).slice(0, 3)).toEqual([
      'github',
      'gmail',
      'notion',
    ]);
    expect(appsFor([], new Set(['gmail', 'google-calendar']))).toEqual(['gmail']);
  });

  it('offers three things to ask first, from the picks and then for anyone', () => {
    expect(startersFor(['email'])).toEqual([
      'What needs my attention in my inbox today?',
      'Help me plan my week',
      'Teach me something new in five minutes',
    ]);
    expect(startersFor([])).toHaveLength(3);
  });
});
