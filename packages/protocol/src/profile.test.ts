import { describe, expect, it } from 'vitest';

import { describeProfile } from './profile';

describe('what every chat starts with about you', () => {
  it('your name, each card in a line, then your own words', () => {
    expect(
      describeProfile({
        name: 'George',
        about: 'Indie hacker by night.',
        facts: [
          { id: 'f1', kind: 'person', text: 'Lina', detail: 'daughter · born 8 June 2025' },
          { id: 'f2', kind: 'work', text: 'SDM at Amazon' },
          { id: 'f3', kind: 'person', text: 'Jouda', detail: 'wife' },
        ],
      }),
    ).toEqual([
      'Their name is George.',
      'Work: SDM at Amazon.',
      'People in their life: Lina (daughter · born 8 June 2025); Jouda (wife).',
      'In their own words: Indie hacker by night.',
    ]);
  });

  it('is just your words when that’s all there is, and nothing when there’s nothing', () => {
    expect(describeProfile({ name: '', about: 'Hi.' })).toEqual(['Hi.']);
    expect(describeProfile({ name: ' ', about: ' ', facts: [] })).toEqual([]);
  });
});
