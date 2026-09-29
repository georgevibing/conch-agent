import type { Capabilities, SkillDraft } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { CompletionInput } from '../engines/types';
import {
  cleanSkillDescription,
  cleanSkillTitle,
  composeDescription,
  draftSkill,
  fallbackDraft,
  humanize,
  parseDraftReply,
  slugify,
} from './draft';

function engine(reply: string | Error, models: string[] = ['claude-haiku-4-5', 'claude-opus-5-5']) {
  const calls: CompletionInput[] = [];
  return {
    calls,
    smallModel: undefined,
    async capabilities(): Promise<Capabilities> {
      return {
        engine: 'anthropic-api',
        label: 'Anthropic API',
        models: models.map((id) => ({
          id,
          label: id,
          description: '',
          efforts: [],
          supportsFastMode: false,
          supportsAutoMode: false,
        })),
        commands: [],
        permissionModes: ['default'],
      };
    },
    async complete(input: CompletionInput) {
      calls.push(input);
      if (reply instanceof Error) throw reply;
      return { text: reply, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

const INSTRUCTIONS =
  'Every Friday, look at my calendar and notes from the week and write a short review: what went well, what slipped, and three priorities for next week.';

describe('drafting a skill’s title and description', () => {
  it('asks the cheapest model for both, in the house style', async () => {
    const e = engine(
      '{"title": "Weekly review", "does": "drafts a weekly review from calendar and notes", "when": "Use when asked to review or plan the week."}',
    );
    const { draft, usage } = await draftSkill(e, INSTRUCTIONS);
    expect(draft).toEqual<Omit<SkillDraft, 'name'>>({
      title: 'Weekly review',
      description:
        'Drafts a weekly review from calendar and notes. Use when asked to review or plan the week.',
      generated: true,
    });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(e.calls[0]?.model).toBe('claude-haiku-4-5');
    expect(e.calls[0]?.prompt).toContain(INSTRUCTIONS);
  });

  it('forgives a code fence and cleans what comes back', async () => {
    const e = engine(
      '```json\n{"title": "\\"weekly review.\\"", "description": "drafts a weekly review"}\n```',
    );
    const { draft } = await draftSkill(e, INSTRUCTIONS);
    expect(draft.title).toBe('Weekly review');
    expect(draft.description).toBe('Drafts a weekly review.');
  });

  it('falls back to the text itself when there is no model, or it fails', async () => {
    for (const e of [undefined, engine(new Error('offline')), engine("I'm sorry, I can't help")]) {
      const { draft } = await draftSkill(e, INSTRUCTIONS);
      expect(draft.generated).toBe(false);
      expect(draft.title).toBe('Every Friday');
      expect(draft.description.startsWith('Every Friday, look at my calendar')).toBe(true);
    }
  });
});

describe('the house shape', () => {
  it('joins the halves as “Does X. Use when Y.”, dropping the second if it won’t fit', () => {
    expect(composeDescription('Drafts release notes', 'use when cutting a release.')).toBe(
      'Drafts release notes. Use when cutting a release.',
    );
    expect(composeDescription('Drafts release notes', 'Use when ' + 'x'.repeat(200))).toBe(
      'Drafts release notes.',
    );
    expect(composeDescription(undefined, 'Use when asked')).toBeUndefined();
  });

  it('still takes a whole description from a model that ignores the halves', async () => {
    const { draft } = await draftSkill(
      engine('{"title": "Tidy downloads", "description": "Sorts downloads. Use when asked."}'),
      INSTRUCTIONS,
    );
    expect(draft.description).toBe('Sorts downloads. Use when asked.');
  });
});

describe('cleaning', () => {
  it('keeps titles short and in sentence case', () => {
    expect(cleanSkillTitle('Title: release notes!')).toBe('Release notes');
    expect(cleanSkillTitle('A title that is far too many words long')).toBeUndefined();
    expect(cleanSkillTitle('')).toBeUndefined();
  });

  it('keeps descriptions to one line under 160, by whole sentences', () => {
    const long = `Drafts ${'very '.repeat(30)}long reviews. Use when asked.`;
    expect(cleanSkillDescription(long)).toBeUndefined();
    const two = `Drafts a weekly review from calendar and notes. ${'Use when '.repeat(20)}asked.`;
    expect(cleanSkillDescription(two)).toBe('Drafts a weekly review from calendar and notes.');
    expect(cleanSkillDescription('Description: sorts\nfiles')).toBe('Sorts files.');
  });

  it('parses line-based replies too', () => {
    expect(
      parseDraftReply('Title: Tidy downloads\nDescription: Sorts the Downloads folder.'),
    ).toEqual({
      title: 'Tidy downloads',
      description: 'Sorts the Downloads folder.',
    });
  });
});

describe('names', () => {
  it('turns a title into a valid Agent Skills name, and back', () => {
    expect(slugify('Weekly review')).toBe('weekly-review');
    expect(slugify('  Résumé — Tailor!! ')).toBe('resume-tailor');
    expect(slugify('日本語')).toBe('skill');
    expect(slugify('x'.repeat(100))).toHaveLength(48);
    expect(humanize('weekly-review')).toBe('Weekly review');
  });

  it('uses a heading as the fallback title', () => {
    expect(fallbackDraft('# Release notes\n\nWrite them from merged PRs. Keep it short.')).toEqual({
      title: 'Release notes',
      description: 'Write them from merged PRs.',
    });
  });
});
