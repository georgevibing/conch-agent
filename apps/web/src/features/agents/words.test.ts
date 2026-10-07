import { AGENT_AVATAR_PRESETS, AGENT_LIMITS, TONES, Tone } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { NAME_IDEAS, STARTERS, TONE_CHOICES, agentHello, nextIdea } from './words';

describe('how an agent says hello', () => {
  it('says its name, and yours, in every tone', () => {
    for (const tone of Tone.options) {
      const line = agentHello(tone, 'Atlas', 'Ada');
      expect(line, tone).toContain('Atlas');
      expect(line, tone).toContain('Ada');
    }
  });

  it('reads well without your name or its own', () => {
    for (const tone of Tone.options) {
      const line = agentHello(tone, '  ', '');
      expect(line, tone).toContain('your new agent');
      expect(line, tone).not.toMatch(/,\s*[.!,]|\s{2}|\s[.!,]/);
    }
  });

  it('offers every tone, in the protocol’s own words', () => {
    expect(TONE_CHOICES.map((t) => t.value)).toEqual(Object.keys(TONES));
    for (const t of TONE_CHOICES) expect(t.label).toBe(TONES[t.value].label);
  });
});

describe('names to start from', () => {
  it('pairs each name with a face Conch draws', () => {
    for (const idea of NAME_IDEAS) expect(AGENT_AVATAR_PRESETS).toContain(idea.face);
    expect(new Set(NAME_IDEAS.map((i) => i.name)).size).toBe(NAME_IDEAS.length);
  });

  it('walks through them, never offering a name already taken', () => {
    const first = nextIdea([]);
    expect(first).toEqual(NAME_IDEAS[0]);
    expect(nextIdea([first.name])).toEqual(NAME_IDEAS[1]);
    expect(nextIdea(['juniper'], first.name)).toEqual(NAME_IDEAS[2]);
    // At the end it comes round again.
    const last = NAME_IDEAS.at(-1)?.name;
    expect(nextIdea([], last)).toEqual(NAME_IDEAS[0]);
    // All taken: still a name, never nothing.
    expect(nextIdea(NAME_IDEAS.map((i) => i.name)).name).toBeTruthy();
  });
});

describe('instructions to start from', () => {
  it('say who it is, its goals, its boundaries and its style, briefly', () => {
    for (const starter of STARTERS) {
      for (const part of ['Goals', 'Boundaries', 'Style'])
        expect(starter.text, starter.id).toContain(part);
      expect(starter.text.length).toBeLessThan(AGENT_LIMITS.instructions / 8);
      expect(starter.role.length).toBeLessThanOrEqual(AGENT_LIMITS.role);
    }
  });
});
