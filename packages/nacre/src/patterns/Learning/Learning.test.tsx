import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  LearnedEntry,
  LearnedLine,
  LearningTimeline,
  NeverList,
  WeeklyRecap,
  type LearnedThing,
} from './Learning';

const preference: LearnedThing = {
  id: 'le_1',
  text: 'Prefers TypeScript over Python',
  state: 'applied',
  why: {
    chat: 'Rename my photos',
    quotes: ['No, I meant TypeScript.'],
    signals: ['correction'],
    model: 'Claude Haiku 4.5',
  },
};
const moved: LearnedThing = {
  id: 'le_2',
  text: 'Lives in Lisbon',
  was: 'Lives in Berlin',
  state: 'applied',
};
const waiting: LearnedThing = {
  id: 'le_3',
  text: 'Prefers trains',
  state: 'waiting',
  waits: 'Learned in a chat that read trains.example.',
};

describe('LearnedLine', () => {
  it('is one folded line that opens to Undo and Why?, by keyboard', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const { container } = renderNacre(<LearnedLine items={[preference, moved]} onUndo={onUndo} />);
    const line = screen.getByRole('group', { name: 'What Conch learned from this chat' });
    expect(line).toHaveTextContent('Learned 2 things');
    expect(screen.queryByText('Prefers TypeScript over Python')).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('button', { name: /Learned 2 things/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Prefers TypeScript over Python')).toBeVisible();
    // A move shows what it replaced (and says so to a screen reader).
    expect(line).toHaveTextContent('Now: Lives in Lisbon');
    expect(line).toHaveTextContent('it was: Lives in Berlin');
    await user.click(screen.getAllByRole('button', { name: 'Undo' })[0] as HTMLElement);
    expect(onUndo).toHaveBeenCalledWith('le_1');
    await expectAccessible(container);
  });

  it('Why? shows the chat, your words, what Conch noticed and the model', async () => {
    const user = userEvent.setup();
    renderNacre(<LearnedLine defaultOpen items={[preference]} />);
    await user.click(screen.getByRole('button', { name: 'Why?' }));
    const panel = await screen.findByRole('dialog');
    expect(panel).toHaveTextContent('Learned in “Rename my photos”');
    expect(panel).toHaveTextContent('No, I meant TypeScript.');
    expect(panel).toHaveTextContent('You corrected it');
    expect(panel).toHaveTextContent('Read by Claude Haiku 4.5.');
  });

  it('opens by itself when something waits, with Keep and Forget', async () => {
    const user = userEvent.setup();
    const onKeep = vi.fn();
    const onForget = vi.fn();
    const { container } = renderNacre(
      <LearnedLine items={[preference, waiting]} onKeep={onKeep} onForget={onForget} />,
    );
    expect(screen.getByRole('group')).toHaveTextContent('Learned 2 things · 1 waits for your OK');
    expect(screen.getByText('Learned in a chat that read trains.example.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    await user.click(screen.getByRole('button', { name: 'Forget' }));
    expect(onKeep).toHaveBeenCalledWith('le_3');
    expect(onForget).toHaveBeenCalledWith('le_3');
    await expectAccessible(container);
  });

  it('says what you decided, and offers nothing more', () => {
    renderNacre(
      <LearnedLine
        defaultOpen
        onUndo={() => {}}
        items={[
          { ...preference, state: 'undone' },
          { ...moved, state: 'kept' },
        ]}
      />,
    );
    expect(screen.getByText('Undone · won’t learn this again')).toBeInTheDocument();
    expect(screen.getByText('Kept')).toBeInTheDocument();
    // Kept can still be undone; undone can't be undone again.
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    expect(screen.getByRole('group')).toHaveTextContent('Learned 2 things');
  });

  it('speaks of one thing as one', () => {
    renderNacre(<LearnedLine items={[preference]} />);
    expect(screen.getByRole('group')).toHaveTextContent('Learned 1 thing');
  });
});

describe('the Memory page parts', () => {
  it('the record, the week, and what won’t be learned again', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderNacre(
      <>
        <WeeklyRecap
          count={6}
          items={['Prefers TypeScript']}
          onDismiss={onDismiss}
          onSeeAll={() => {}}
        />
        <LearningTimeline>
          <LearnedEntry thing={moved} meta="From “Weekend ideas” · yesterday" onUndo={() => {}} />
          <LearnedEntry thing={waiting} onKeep={() => {}} onForget={() => {}} />
        </LearningTimeline>
        <NeverList
          items={[{ id: 'nv_1', text: 'Prefers dark mode', when: '3 days ago' }]}
          onRemove={onRemove}
        />
      </>,
    );
    expect(
      screen.getByRole('region', { name: 'This week Conch learned 6 things' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What Conch learned' })).toHaveTextContent(
      'From “Weekend ideas” · yesterday',
    );
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    await user.click(
      screen.getByRole('button', { name: 'Let Conch learn “Prefers dark mode” again' }),
    );
    expect(onRemove).toHaveBeenCalledWith('nv_1');
    await expectAccessible(container);
  });

  it('a week of one says so', () => {
    renderNacre(<WeeklyRecap count={1} items={[]} />);
    expect(
      screen.getByRole('region', { name: 'This week Conch learned one thing' }),
    ).toBeInTheDocument();
  });
});
