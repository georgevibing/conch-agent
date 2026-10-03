import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { QuestionCard, type QuestionCardQuestion } from './QuestionCard';
import { dateOf, dayStrip, timeOf, timeSlots } from './when';

const TODAY = '2026-10-05';

const callType: QuestionCardQuestion = {
  questionId: 'q1',
  fields: [
    {
      id: 'type',
      kind: 'choice',
      label: 'How would you like to talk?',
      options: [
        { id: 'video', label: 'Video call', description: 'A Meet link' },
        { id: 'phone', label: 'Phone' },
        { id: 'person', label: 'In person' },
      ],
    },
  ],
};

const card = (question: QuestionCardQuestion, props = {}) => {
  const onAnswer = vi.fn();
  const onSkip = vi.fn();
  const view = renderNacre(
    <QuestionCard
      question={question}
      today={TODAY}
      locale="en-GB"
      onAnswer={onAnswer}
      onSkip={onSkip}
      {...props}
    />,
  );
  return { ...view, onAnswer, onSkip };
};

describe('QuestionCard', () => {
  it('asks in the assistant’s name, and a tap on a single choice is the answer', async () => {
    const { container, onAnswer } = card(callType);
    expect(
      screen.getByRole('group', { name: 'Conch asks: How would you like to talk?' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Phone' }));
    expect(onAnswer).toHaveBeenCalledWith({ type: 'phone' });
    await expectAccessible(container);
  });

  it('picks with number keys, moves with arrows without sending, and sends on Enter', async () => {
    const { onAnswer } = card(callType);
    const video = screen.getByRole('radio', { name: 'Video call' });
    video.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Phone' })).toHaveFocus();
    expect(onAnswer).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(onAnswer).toHaveBeenLastCalledWith({ type: 'phone' });
    await userEvent.keyboard('3');
    expect(onAnswer).toHaveBeenLastCalledWith({ type: 'person' });
  });

  it('“Something else…” opens a line, and its words are the answer', async () => {
    const { onAnswer } = card({
      questionId: 'q2',
      fields: [
        {
          id: 'size',
          kind: 'choice',
          label: 'Which size?',
          other: true,
          options: [
            { id: 's', label: 'Small' },
            { id: 'l', label: 'Large' },
          ],
        },
      ],
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Something else…' }));
    expect(onAnswer).not.toHaveBeenCalled();
    const line = screen.getByRole('textbox', { name: 'Something else' });
    expect(line).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(line, 'As big as the title{Enter}');
    expect(onAnswer).toHaveBeenCalledWith({ size: 'As big as the title' });
  });

  it('several choices: ticked with keys and arrows, then sent', async () => {
    const { onAnswer, container } = card({
      questionId: 'q3',
      fields: [
        {
          id: 'parts',
          kind: 'choice',
          label: 'What should it cover?',
          multiple: true,
          options: [
            { id: 'sales', label: 'Sales' },
            { id: 'support', label: 'Support' },
            { id: 'hiring', label: 'Hiring' },
          ],
        },
      ],
    });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sales' }));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('checkbox', { name: 'Hiring' })).toHaveFocus();
    await userEvent.keyboard('3');
    expect(screen.getByRole('checkbox', { name: 'Hiring' })).toBeChecked();
    await userEvent.keyboard('{Enter}');
    expect(onAnswer).toHaveBeenCalledWith({ parts: ['sales', 'hiring'] });
    await expectAccessible(container);
  });

  it('offers the coming days with the suggested one chosen, and a tap picks another', async () => {
    const { onAnswer, container } = card({
      questionId: 'q4',
      fields: [{ id: 'day', kind: 'date', label: 'Which day?', suggested: '2026-10-08T09:00:00Z' }],
    });
    expect(screen.getByRole('radio', { name: 'Thursday 8 October' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Monday 5 October' })).toHaveTextContent('Today');
    await userEvent.click(screen.getByRole('radio', { name: 'Tuesday 6 October' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith({ day: '2026-10-06' });
    await expectAccessible(container);
  });

  it('a day and a time: a slot and the day make one value', async () => {
    const { onAnswer } = card({
      questionId: 'q5',
      fields: [{ id: 'when', kind: 'datetime', label: 'When?', suggested: '2026-10-08T10:00' }],
    });
    await userEvent.click(screen.getByRole('radio', { name: '11:00' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith({ when: '2026-10-08T11:00' });
  });

  it('any other time is one tap away: Another time… opens the exact time in its place', async () => {
    const { onAnswer, container } = card({
      questionId: 'q5b',
      fields: [{ id: 'when', kind: 'time', label: 'What time?', suggested: '10:00' }],
    });
    // The slots, written as the time picker writes them, and no second control beside them.
    expect(screen.getByRole('radio', { name: '10:00' })).toBeChecked();
    expect(screen.queryByRole('spinbutton', { name: 'Hour' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Another time…' }));
    const hour = await screen.findByRole('spinbutton', { name: 'Hour' });
    await waitFor(() => expect(hour).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Another time…' })).toBeNull();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith({ when: '11:00' });
    await expectAccessible(container);
  });

  it('a short form sends only once what it needs is there, and leaves out the optional', async () => {
    const { onAnswer } = card({
      questionId: 'q6',
      title: 'About the call',
      fields: [
        { id: 'name', kind: 'text', label: 'Who with?' },
        { id: 'length', kind: 'number', label: 'How long?', suggested: 30, unit: 'min' },
        { id: 'agenda', kind: 'text', label: 'Agenda', optional: true },
      ],
    });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Who with?' }), 'Ada');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith({ name: 'Ada', length: 30 });
  });

  it('a number typed in counts when Enter sends it', async () => {
    const { onAnswer } = card({
      questionId: 'q7',
      fields: [{ id: 'n', kind: 'number', label: 'How many?', min: 1, max: 12, suggested: 2 }],
    });
    const field = screen.getByRole('spinbutton', { name: 'How many?' });
    await userEvent.clear(field);
    await userEvent.type(field, '4{Enter}');
    expect(onAnswer).toHaveBeenLastCalledWith({ n: 4 });
  });

  it('Skip is always there', async () => {
    const { onSkip } = card(callType);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('holds still while sending, and says plainly when it couldn’t', () => {
    card(callType, { state: 'sending', error: 'That didn’t reach Conch. Send it again.' });
    expect(screen.getByRole('group', { name: /Conch asks/ })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('radio', { name: 'Phone' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('That didn’t reach Conch.');
  });

  it('folds to one quiet line once answered or skipped', async () => {
    const { container, rerender } = card(callType, { state: 'answered', answer: 'Video call' });
    expect(screen.getByRole('note')).toHaveTextContent('How would you like to talk?Video call');
    expect(screen.queryByRole('radio')).toBeNull();
    await expectAccessible(container);
    rerender(<QuestionCard question={callType} state="answered" answeredInMessage />);
    expect(screen.getByRole('note')).toHaveTextContent('Answered in your message');
    rerender(<QuestionCard question={callType} state="skipped" />);
    expect(screen.getByRole('note')).toHaveTextContent('Skipped');
  });

  it('an open card folds in place when the answer comes, and focus follows it', async () => {
    const { rerender } = card(callType);
    screen.getByRole('radio', { name: 'Phone' }).focus();
    rerender(<QuestionCard question={callType} state="answered" answer="Phone" />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('note')).toHaveFocus();
  });

  it('locked: nothing to press', () => {
    const { onAnswer } = card(callType, { disabled: true });
    expect(screen.getByRole('radio', { name: 'Phone' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe('when', () => {
  it('keeps the wall-clock parts of whatever the assistant sent', () => {
    expect(dateOf('2026-10-08T10:00:00+02:00')).toBe('2026-10-08');
    expect(dateOf('soon')).toBeUndefined();
    expect(timeOf('2026-10-08T10:30:00Z')).toBe('10:30');
    expect(timeOf('08:15')).toBe('08:15');
    expect(timeOf('25:00')).toBeUndefined();
  });

  it('offers a week from today, within limits, with the suggested day added', () => {
    expect(dayStrip(TODAY, {})).toHaveLength(7);
    expect(dayStrip(TODAY, { min: '2026-10-07', max: '2026-10-09' })).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
    expect(dayStrip(TODAY, { suggested: '2026-10-20' }).at(-1)).toBe('2026-10-20');
  });

  it('offers times around the suggested one', () => {
    expect(timeSlots({ suggested: '10:00' })).toEqual(['09:00', '10:00', '11:00', '12:00']);
    expect(timeSlots({ suggested: '23:00' })).toEqual(['22:00', '23:00']);
    expect(timeSlots({ min: '12:00' })).toEqual(['12:00', '14:00', '16:00']);
  });
});
