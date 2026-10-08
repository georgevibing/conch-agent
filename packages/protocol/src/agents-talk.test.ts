import { describe, expect, it } from 'vitest';

import { mentionTyped, mentionsIn, OutsideAgentId, ROUND_END_WORDS, RoundEnd } from './agents-talk';
import { McpScope } from './mcp';

const roster = [
  { id: 'ag_research', name: 'Researcher' },
  { id: 'ag_writer', name: 'Writer' },
  { id: 'oa_travel1', name: 'Travel Agent' },
  { id: 'oa_travel2', name: 'Travel' },
];
const names = (text: string) => mentionsIn(text, roster).map((r) => r.name);

describe('mentionsIn', () => {
  it('finds who a message addresses, in the order it names them', () => {
    expect(names('@Researcher find options, @Writer draft it')).toEqual(['Researcher', 'Writer']);
    expect(names('@writer first, then @RESEARCHER')).toEqual(['Writer', 'Researcher']);
  });

  it('prefers the longest name, and needs the whole name', () => {
    expect(names('@Travel Agent book it')).toEqual(['Travel Agent']);
    expect(names('@Travel, check the dates')).toEqual(['Travel']);
    expect(names('@Writers unite')).toEqual([]);
  });

  it('names each once', () => {
    expect(names('@Writer, @Writer and @writer again')).toEqual(['Writer']);
  });

  it('ignores email addresses, code and lone @s', () => {
    expect(names('mail ana@writer.com')).toEqual([]);
    expect(names('run `@Writer` or\n```\n@Researcher\n```')).toEqual([]);
    expect(names('@ nobody @@Writer')).toEqual([]);
  });

  it('counts a mention after punctuation or at the start of a line', () => {
    expect(names('(@Writer) and\n@Researcher')).toEqual(['Writer', 'Researcher']);
  });

  it('works with names in any script', () => {
    expect(mentionsIn('@Élodie ça va', [{ id: 'ag_elodie', name: 'Élodie' }])).toHaveLength(1);
    expect(mentionsIn('@Élodiea', [{ id: 'ag_elodie', name: 'Élodie' }])).toHaveLength(0);
  });
});

describe('mentionTyped', () => {
  it('reads the @ being typed at the end of a draft', () => {
    expect(mentionTyped('ask @Wri')).toEqual({ query: 'Wri', at: 4 });
    expect(mentionTyped('@')).toEqual({ query: '', at: 0 });
    expect(mentionTyped('mail ana@wri')).toBeUndefined();
    expect(mentionTyped('@Writer draft it')).toBeUndefined();
  });
});

describe('the words and the shapes', () => {
  it('says why every round ended, except when it simply finished', () => {
    for (const reason of RoundEnd.options)
      expect(Boolean(ROUND_END_WORDS[reason])).toBe(reason !== 'done');
  });

  it('keeps ids and scopes to what they say', () => {
    expect(OutsideAgentId.safeParse('oa_abcd').success).toBe(true);
    expect(OutsideAgentId.safeParse('../oa_abcd').success).toBe(false);
    expect(McpScope.safeParse('agent:ag_conch').success).toBe(true);
    expect(McpScope.safeParse('agent:../x').success).toBe(false);
  });
});
