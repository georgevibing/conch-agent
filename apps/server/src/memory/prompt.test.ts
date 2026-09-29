import { Persona, Profile } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { buildSystemAppend } from './prompt';

describe('buildSystemAppend', () => {
  it('includes persona, profile, memories and tool guidance', () => {
    const text = buildSystemAppend({
      persona: Persona.parse({
        name: 'Shelly',
        tone: 'concise',
        instructions: 'Use British English.',
      }),
      profile: Profile.parse({ name: 'Ada', about: 'Builds compilers.' }),
      memories: [
        {
          id: 'm_1',
          content: 'Prefers tea',
          kind: 'preference',
          source: 'agent',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      autoMemory: true,
    });
    expect(text).toContain('You are Shelly');
    expect(text).toContain('Brief and direct');
    expect(text).toContain('Use British English.');
    expect(text).toContain('Their name is Ada.');
    expect(text).toContain('[m_1] (preference) Prefers tea');
    expect(text).toContain('Use the remember tool');
  });

  it('stays within the memory budget and points to recall', () => {
    const memories = Array.from({ length: 400 }, (_, i) => ({
      id: `m_${i}`,
      content: `A reasonably long memory number ${i} about something the user cares about`,
      kind: 'fact' as const,
      source: 'agent' as const,
      createdAt: i,
      updatedAt: i,
    }));
    const text = buildSystemAppend({
      persona: Persona.parse({}),
      profile: Profile.parse({}),
      memories,
      autoMemory: false,
    });
    expect(text.length).toBeLessThan(9000);
    expect(text).toMatch(/older memories — use the recall tool/);
    expect(text).toContain('Only use the remember tool when the user explicitly asks');
  });
});
