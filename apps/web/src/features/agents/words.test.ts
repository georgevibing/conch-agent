import {
  AGENT_AVATAR_PRESETS,
  AGENT_LIMITS,
  OLDER_INSTRUCTIONS,
  TONES,
  Tone,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import {
  NAME_IDEAS,
  STARTERS,
  TONE_CHOICES,
  agentHello,
  instructionsNote,
  nextIdea,
} from './words';

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
      expect(starter.text.length).toBeLessThan(OLDER_INSTRUCTIONS / 8);
      expect(instructionsNote(starter.text)).toBeUndefined();
      expect(starter.role.length).toBeLessThanOrEqual(AGENT_LIMITS.role);
    }
  });
});

describe('a word on long instructions', () => {
  const words = (n: number) => 'Keep every reply short. '.repeat(n);
  it('says nothing for a few lines, whatever the model', () => {
    expect(instructionsNote('Use British spelling.')).toBeUndefined();
    expect(instructionsNote(words(100), { label: 'Opus', context: 200_000 })).toBeUndefined();
  });
  it('says long ones cost on every reply, with their size', () => {
    // ≈36,000 characters: ≈9k tokens.
    expect(instructionsNote(words(1_500))).toBe(
      'These instructions are long (≈9k tokens). Every reply carries them, so small models may struggle.',
    );
  });
  it('speaks of the model when they crowd its window', () => {
    // ≈2k tokens of an 8k window.
    expect(instructionsNote(words(330), { label: 'Llama 3.2', context: 8_192 })).toBe(
      'These instructions are long for Llama 3.2 (≈2k tokens of the ≈8k it reads at once). Every reply carries them, so it may read only their start.',
    );
    // The same words beside a big window say nothing: they're not long by themselves.
    expect(instructionsNote(words(330), { label: 'Opus', context: 200_000 })).toBeUndefined();
  });
});
