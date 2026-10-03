import { describe, expect, it } from 'vitest';

import { Question } from './chat-cards';
import { answerText, checkAnswer, normaliseWhen } from './questions';

const call = Question.parse({
  questionId: 'q1',
  title: 'Your call with Ada',
  fields: [
    {
      id: 'when',
      label: 'When suits you?',
      kind: 'datetime',
      min: '2026-10-05',
      max: '2026-10-16T18:00:00Z',
      suggested: '2026-10-09T10:00:00+02:00',
    },
    {
      id: 'how',
      label: 'How should we talk?',
      kind: 'choice',
      options: [
        { id: 'video', label: 'Video call' },
        { id: 'phone', label: 'Phone' },
      ],
    },
    { id: 'people', label: 'How many?', kind: 'number', min: 1, max: 8, unit: 'people' },
    { id: 'note', label: 'Anything to add?', kind: 'text', optional: true },
  ],
});
const now = new Date(2026, 9, 3);

describe('answers to a question (ADR 0055)', () => {
  it('reads as one sentence, in the question’s order', () => {
    const values = { how: 'video', when: '2026-10-09T10:00', people: 3 };
    expect(checkAnswer(call, values)).toEqual({ ok: true, values });
    expect(answerText(call, values, now)).toBe('Friday 9 Oct, 10:00 · Video call · 3 people');
  });

  it('names the year only when it isn’t this one, and quotes something else as typed', () => {
    const field = Question.parse({
      questionId: 'q2',
      fields: [
        {
          id: 'day',
          label: 'Which day?',
          kind: 'date',
        },
        {
          id: 'what',
          label: 'What?',
          kind: 'choice',
          multiple: true,
          options: [
            { id: 'a', label: 'Apples' },
            { id: 'b', label: 'Bread' },
          ],
        },
      ],
    });
    const values = { day: '2027-01-04', what: ['b', 'Cheese'] };
    expect(checkAnswer(field, values).ok).toBe(true);
    expect(answerText(field, values, now)).toBe('Monday 4 Jan 2027 · Bread, Cheese');
  });

  it('refuses what doesn’t fit the field', () => {
    const base = { when: '2026-10-09T10:00', how: 'video', people: 2 };
    const refused = (values: Record<string, unknown>) =>
      checkAnswer(call, values as never).ok === false;
    expect(refused({ ...base, how: 'carrier pigeon' })).toBe(false); // other is on by default
    expect(refused({ ...base, how: ['video', 'phone'] })).toBe(true); // one only
    expect(refused({ ...base, when: '2026-02-30T10:00' })).toBe(true); // no such day
    expect(refused({ ...base, when: '2026-10-01T10:00' })).toBe(true); // before min
    expect(refused({ ...base, when: '2026-10-17T10:00' })).toBe(true); // after max
    expect(refused({ ...base, people: 9 })).toBe(true);
    expect(refused({ ...base, people: '2' })).toBe(true);
    expect(refused({ ...base, extra: 'x' })).toBe(true);
    expect(refused({ how: 'video', people: 2 })).toBe(true); // required missing
    expect(refused(base)).toBe(false); // the optional note can be left out
    const strict = Question.parse({
      questionId: 'q3',
      fields: [
        {
          id: 'c',
          label: 'Pick',
          kind: 'choice',
          other: false,
          options: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
          ],
        },
      ],
    });
    expect(checkAnswer(strict, { c: 'z' }).ok).toBe(false);
    expect(checkAnswer(strict, { c: 'y' }).ok).toBe(true);
  });

  it('tidies text and keeps one choice as a string', () => {
    const result = checkAnswer(call, {
      when: '2026-10-09T10:00',
      how: ['phone'],
      people: 1,
      note: '  bring   the deck \n ',
    });
    expect(result).toEqual({
      ok: true,
      values: { when: '2026-10-09T10:00', how: 'phone', people: 1, note: 'bring the deck' },
    });
  });

  it('takes the wall-clock parts of whatever the assistant wrote', () => {
    expect(normaliseWhen('date', '2026-10-09T10:00:00Z')).toBe('2026-10-09');
    expect(normaliseWhen('time', '2026-10-09T10:30:00+02:00')).toBe('10:30');
    expect(normaliseWhen('time', '14:05')).toBe('14:05');
    expect(normaliseWhen('datetime', '2026-10-09')).toBe('2026-10-09T09:00');
    expect(normaliseWhen('datetime', '2026-10-09 16:45')).toBe('2026-10-09T16:45');
    expect(normaliseWhen('date', 'next tuesday')).toBeUndefined();
    expect(normaliseWhen('time', '25:00')).toBeUndefined();
  });
});
