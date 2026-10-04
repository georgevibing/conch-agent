import { describe, expect, it } from 'vitest';

import type { CompletionInput } from '../engines/types';
import { cleanInstructions, WRITE_SYSTEM, writeSkill } from './write';

const STEPS = [
  'Look back over the week and write a short review the person can read in a minute.',
  '',
  '## Steps',
  '1. Read this week’s calendar.',
  '2. Read the notes from the week.',
  '3. Write what went well, what slipped, and three priorities for next week.',
  '',
  '## Good to know',
  'Keep it under 200 words. Plain, warm, no jargon.',
].join('\n');

/** An engine that answers with `replies` in turn, and remembers what it was asked. */
function engine(replies: (string | Error)[], smallModel?: string) {
  const asked: CompletionInput[] = [];
  return {
    asked,
    smallModel,
    complete: async (input: CompletionInput) => {
      asked.push(input);
      const next = replies.shift() ?? new Error('no more');
      if (next instanceof Error) throw next;
      return { text: next, usage: { inputTokens: 10, outputTokens: 20 } };
    },
  };
}

const reply = (fields: Record<string, string>) => JSON.stringify(fields);

describe('writing a whole skill from an idea', () => {
  it('writes the steps, a title and a description in the house style', async () => {
    const e = engine([
      reply({
        title: 'Weekly review',
        does: 'drafts a weekly review from your calendar and notes',
        when: 'use when asked to review or plan the week',
        instructions: STEPS,
      }),
    ]);
    const { skill, usage } = await writeSkill(e, 'every friday review my week from my calendar');
    expect(skill).toEqual({
      instructions: STEPS,
      title: 'Weekly review',
      description:
        'Drafts a weekly review from your calendar and notes. Use when asked to review or plan the week.',
      generated: true,
    });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    // Asked with the house style, the idea fenced off, and the default model first.
    expect(e.asked[0]?.system).toBe(WRITE_SYSTEM);
    expect(e.asked[0]?.prompt).toContain(
      '<idea>\nevery friday review my week from my calendar\n</idea>',
    );
    expect(e.asked[0]?.model).toBeUndefined();
  });

  it('keeps your words, as they were, when nothing can write', async () => {
    const { skill } = await writeSkill(undefined, 'Tidy my downloads folder every Sunday.');
    expect(skill.generated).toBe(false);
    expect(skill.instructions).toBe('Tidy my downloads folder every Sunday.');
    expect(skill.title).toBeTruthy();
  });

  it('tries the small model when the default fails, and keeps your words if both do', async () => {
    const e = engine(
      [new Error('overloaded'), reply({ title: 'Tidy', instructions: STEPS })],
      'small',
    );
    expect((await writeSkill(e, 'tidy my downloads')).skill.generated).toBe(true);
    expect(e.asked.map((a) => a.model)).toEqual([undefined, 'small']);

    const refuses = engine(["I'm sorry, I can't help with that.", 'nope'], 'small');
    const { skill } = await writeSkill(refuses, 'tidy my downloads');
    expect(skill).toMatchObject({ generated: false, instructions: 'tidy my downloads' });
  });

  it('cleans what a model wraps around the steps: a fence, front matter, a title heading', () => {
    const wrapped = [
      '```markdown',
      '---',
      'name: weekly-review',
      'description: sneaky',
      '---',
      '# Weekly review',
      '',
      STEPS,
      '```',
    ].join('\n');
    expect(cleanInstructions(wrapped)).toBe(STEPS);
    expect(cleanInstructions('Too short.')).toBeUndefined();
    expect(
      cleanInstructions("I can't help with that request, sorry about it all."),
    ).toBeUndefined();
    expect(cleanInstructions('x'.repeat(20_000))?.length).toBe(12_000);
  });
});
