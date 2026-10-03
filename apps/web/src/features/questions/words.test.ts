import { describe, expect, it } from 'vitest';

import { questionWords } from './words';

const choice = {
  id: 'how',
  label: 'How would you like to talk?',
  kind: 'choice' as const,
  optional: false,
  multiple: false,
  other: true,
  options: [
    { id: 'video', label: 'Video call' },
    { id: 'phone', label: 'Phone call' },
    { id: 'office', label: 'In person' },
  ],
};

describe('a question said aloud', () => {
  it('says the options, so it can be answered by voice', () => {
    expect(questionWords({ fields: [choice] })).toBe(
      'How would you like to talk? Video call, Phone call or In person.',
    );
  });

  it('starts with the title when there are several things to answer', () => {
    expect(
      questionWords({
        title: 'Your call with Ada',
        fields: [{ id: 'when', label: 'When suits you', kind: 'date', optional: false }, choice],
      }),
    ).toBe(
      'Your call with Ada. When suits you? How would you like to talk? Video call, Phone call or In person.',
    );
  });
});
