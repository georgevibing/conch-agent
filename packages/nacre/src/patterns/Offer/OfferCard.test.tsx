import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { OfferAlsoTry, OfferCard, type OfferCardState } from './OfferCard';

const calendar = {
  kind: 'app' as const,
  name: 'Google Calendar',
  brand: 'google-calendar',
  color: '#4285F4',
  description: 'See what’s coming up and find time for things.',
  assistant: 'Ada’s helper',
};

const review = {
  kind: 'skill' as const,
  name: 'Weekly review',
  brand: 'weekly-review',
  description: 'Plans the week from your calendar.',
  permissions: {
    capabilities: ['files' as const],
    words: ['change files in your work folder'],
    declared: true,
  },
  assistant: 'Ada’s helper',
};

describe('OfferCard', () => {
  it('turns on a Conch app you switched off, with its own icon, never Connect', async () => {
    const onTake = vi.fn();
    const { container, rerender } = renderNacre(
      <OfferCard
        kind="app"
        name="Tally"
        app={{ glyph: 'calculator', color: 'teal' }}
        description="Count things for you."
        assistant="Ada’s helper"
        state="suggested"
        onTake={onTake}
        onNotNow={() => {}}
      />,
    );
    expect(screen.getByText('Tally is off')).toBeInTheDocument();
    expect(
      screen.getByText('Turn it on and Ada’s helper can count things for you.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on Tally' }));
    expect(onTake).toHaveBeenCalledOnce();
    await expectAccessible(container);
    rerender(
      <OfferCard
        kind="app"
        name="Tally"
        app={{ glyph: 'calculator', color: 'teal' }}
        description="Count things for you."
        state="accepted"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Turned on Tally.*carrying on/);
  });

  it('offers to connect an app, in the assistant’s words, with every way out', async () => {
    const onTake = vi.fn();
    const onNotNow = vi.fn();
    const onMute = vi.fn();
    const { container } = renderNacre(
      <OfferCard
        {...calendar}
        why="Your week is in your calendar."
        state="suggested"
        onTake={onTake}
        onNotNow={onNotNow}
        onMute={onMute}
      />,
    );
    const card = screen.getByRole('group', { name: 'Google Calendar isn’t connected yet' });
    expect(card).toHaveTextContent('Your week is in your calendar.');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onTake).toHaveBeenCalledOnce();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Not now' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onNotNow).toHaveBeenCalledOnce();
    // “Don’t suggest” is in the overflow, by keyboard too.
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const item = await screen.findByRole('menuitem', { name: 'Don’t suggest Google Calendar' });
    expect(item).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onMute).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('says what it can do in the catalog’s words when nobody gave a reason', () => {
    renderNacre(<OfferCard {...calendar} state="suggested" onTake={() => {}} />);
    expect(screen.getByRole('group')).toHaveTextContent(
      'Connect it and Ada’s helper can see what’s coming up and find time for things.',
    );
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('says where it is while signing in, and lets you pick it up again', async () => {
    const onTake = vi.fn();
    const { container } = renderNacre(
      <OfferCard {...calendar} state="connecting" onTake={onTake} />,
    );
    expect(screen.getByRole('group', { name: 'Connecting Google Calendar…' })).toHaveTextContent(
      'the chat carries on by itself',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onTake).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('carries on with one press when it was turned on elsewhere', async () => {
    const onCarryOn = vi.fn();
    renderNacre(<OfferCard {...calendar} state="ready" onCarryOn={onCarryOn} />);
    expect(screen.getByRole('group', { name: 'Google Calendar is connected' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Carry on' }));
    expect(onCarryOn).toHaveBeenCalledOnce();
  });

  it('shows what a skill may do before it’s turned on', async () => {
    const onTake = vi.fn();
    const onTurnOn = vi.fn();
    function Card() {
      const [state, setState] = useState<OfferCardState>('suggested');
      return (
        <OfferCard
          {...review}
          state={state}
          onTake={() => {
            onTake();
            setState('review');
          }}
          onTurnOn={onTurnOn}
          onNotNow={() => {}}
        />
      );
    }
    const { container } = renderNacre(<Card />);
    expect(screen.getByRole('group', { name: 'The “Weekly review” skill is off' })).toBeVisible();
    // Nothing of the list can be reached until it opens.
    expect(screen.queryByRole('region', { name: 'This skill can:' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on Weekly review' }));
    expect(onTake).toHaveBeenCalledOnce();
    expect(onTurnOn).not.toHaveBeenCalled();
    expect(screen.getByText('change files in your work folder')).toBeVisible();
    const confirm = screen.getByRole('button', { name: 'Turn on Weekly review' });
    expect(confirm).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onTurnOn).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('a skill that waits to be asked is used once, or always', async () => {
    const onUseOnce = vi.fn();
    const onTurnOn = vi.fn();
    const { container } = renderNacre(
      <OfferCard
        {...review}
        skillMode="manual"
        state="review"
        onUseOnce={onUseOnce}
        onTurnOn={onTurnOn}
      />,
    );
    expect(screen.getByRole('group', { name: '“Weekly review” waits to be asked' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Use Weekly review for this' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Always use Weekly review when it fits' }),
    );
    expect(onUseOnce).toHaveBeenCalledOnce();
    expect(onTurnOn).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('folds into a quiet line once taken, and the card leaves the page', async () => {
    const { container, rerender } = renderNacre(
      <OfferCard {...calendar} state="suggested" onTake={() => {}} />,
    );
    rerender(<OfferCard {...calendar} state="accepted" />);
    expect(screen.getByRole('status')).toHaveTextContent('Connected Google Calendar·carrying on');
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-just]')).not.toBeNull();
    await expectAccessible(container);
    rerender(<OfferCard {...review} state="accepted" taken="once" />);
    expect(screen.getByRole('status')).toHaveTextContent('Using Weekly review·carrying on');
  });

  it('read from history, the line is just there', () => {
    const { container } = renderNacre(<OfferCard {...calendar} state="accepted" />);
    expect(container.querySelector('[data-just]')).toBeNull();
  });

  it('overtaken, it shrinks to a small line with nothing to press', async () => {
    const { container } = renderNacre(
      <OfferCard {...calendar} state="expired" onTake={() => {}} />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Offered to connect Google Calendar');
    expect(screen.queryByRole('button')).toBeNull();
    await expectAccessible(container);
  });

  it('muted is one quiet line whose Undo takes focus', async () => {
    function Card() {
      const [state, setState] = useState<OfferCardState>('suggested');
      return (
        <OfferCard
          {...calendar}
          state={state}
          onTake={() => {}}
          onMute={() => setState('muted')}
          onUnmute={() => setState('suggested')}
        />
      );
    }
    const { container } = renderNacre(<Card />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Don’t suggest Google Calendar' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ada’s helper won’t suggest Google Calendar again.',
    );
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    await expectAccessible(container);
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toHaveFocus();
  });

  it('Not now folds it away, then says it’s gone', () => {
    vi.useFakeTimers();
    try {
      const onGone = vi.fn();
      const { container } = renderNacre(
        <OfferCard {...calendar} state="dismissed" onGone={onGone} />,
      );
      expect(container.querySelector('[data-state="dismissed"]')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      act(() => vi.advanceTimersByTime(700));
      expect(onGone).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OfferAlsoTry', () => {
  it('sends exactly the words on the chip, two at most', async () => {
    const onPick = vi.fn();
    const { container } = renderNacre(
      <OfferAlsoTry
        examples={['What’s on tomorrow?', 'When am I free?', 'A third']}
        onPick={onPick}
      />,
    );
    const group = screen.getByRole('group', { name: 'Also try' });
    expect(group.querySelectorAll('button')).toHaveLength(2);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'What’s on tomorrow?' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('What’s on tomorrow?');
    await expectAccessible(container);
  });

  it('draws nothing with nothing to try', () => {
    const { container } = renderNacre(<OfferAlsoTry examples={[]} onPick={() => {}} />);
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});
