import { describe, expect, it } from 'vitest';

import { AcceptOfferBody, Offer, Question, QuestionField, ToolView } from './chat-cards';
import { ConversationEvent, UpdateSettingsBody } from './index';

const at = { conversationId: 'c1', seq: 1, at: 0 };

describe('chat cards (ADR 0060)', () => {
  it('reads an offer to connect an app, and one to turn on a skill', () => {
    expect(
      Offer.parse({
        offerId: 'o1',
        kind: 'app',
        target: 'google-calendar',
        name: 'Google Calendar',
        description: 'See and plan your events.',
        why: 'Your week is in your calendar.',
        by: 'assistant',
        resume: { request: 'what’s on this week?' },
      }).kind,
    ).toBe('app');
    expect(
      Offer.safeParse({
        offerId: 'o2',
        kind: 'skill',
        target: 'pdf',
        name: 'PDF tools',
        description: 'Fill in and merge PDFs.',
        by: 'assistant',
        skillMode: 'off',
      }).success,
    ).toBe(true);
  });

  it('keeps questions short: two to six options, at most four fields', () => {
    const one = { id: 'a', label: 'Which?', kind: 'choice' as const };
    expect(QuestionField.safeParse({ ...one, options: [{ id: 'x', label: 'X' }] }).success).toBe(
      false,
    );
    const choice = QuestionField.parse({
      ...one,
      options: [
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
      ],
    });
    expect(choice).toMatchObject({ multiple: false, other: true, optional: false });
    expect(
      Question.safeParse({
        questionId: 'q',
        fields: Array.from({ length: 5 }, (_, i) => ({ ...choice, id: `f${i}` })),
      }).success,
    ).toBe(false);
  });

  it('only lets web links out of a tool view', () => {
    const mail = (url: string) =>
      ToolView.safeParse({
        kind: 'mail',
        items: [{ from: 'Ada', subject: 'Hi', date: '2026-10-03', url }],
      }).success;
    expect(mail('https://mail.google.com/x')).toBe(true);
    expect(mail('javascript:alert(1)')).toBe(false);
  });

  it('logs offers, questions, replies, plans and views', () => {
    for (const event of [
      {
        type: 'offer.resolved',
        offerId: 'o1',
        outcome: 'accepted',
      },
      { type: 'question.answered', questionId: 'q', answer: null },
      { type: 'replies', replies: [{ text: 'Show it as a chart' }], by: 'conch' },
      { type: 'plan', steps: [{ title: 'Read the folder', status: 'active' }] },
      {
        type: 'tool.finished',
        toolUseId: 't',
        status: 'success',
        view: { kind: 'files', items: [{ name: 'Budget.xlsx' }] },
      },
    ])
      expect(ConversationEvent.safeParse({ ...at, ...event }).success).toBe(true);
    expect(
      ConversationEvent.safeParse({ ...at, type: 'replies', replies: [], by: 'assistant' }).success,
    ).toBe(false);
  });

  it('takes an offer with nothing to say for an app, and on or once for a skill', () => {
    expect(AcceptOfferBody.safeParse({}).success).toBe(true);
    expect(AcceptOfferBody.parse({ skill: 'once' }).skill).toBe('once');
    expect(AcceptOfferBody.safeParse({ skill: 'always' }).success).toBe(false);
    expect(AcceptOfferBody.safeParse({ skill: 'on', extra: 1 }).success).toBe(false);
  });

  it('mutes skills beside apps, and nothing that looks like a path', () => {
    const muted = (ids: string[]) =>
      UpdateSettingsBody.safeParse({ preferences: { mutedSuggestions: ids } });
    expect(muted(['linear', 'skill:weekly-review', 'skill:claude_pdf']).success).toBe(true);
    expect(muted(['skill:../etc']).success).toBe(false);
    expect(muted(['skill:']).success).toBe(false);
    expect(muted(['tool:linear']).success).toBe(false);
  });
});
