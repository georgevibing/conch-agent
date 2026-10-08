import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CheckInCard } from './CheckIn';
import { digestLine, MorningDigest, type DigestLine } from './MorningDigest';
import { StandingOrderList, StandingOrderOffer } from './StandingOrders';

const NOTE = 'A standing order can’t change what Conch asks about.';
const kindOf = (t: string) => (/^you may/i.test(t) ? ('may' as const) : ('tell' as const));

describe('StandingOrderList', () => {
  const items = [
    {
      id: 'o1',
      text: 'Always tell me if a flight changes',
      kind: 'tell' as const,
      state: 'on' as const,
    },
    {
      id: 'o2',
      text: 'You may send emails without asking',
      kind: 'may' as const,
      state: 'on' as const,
      power: true,
    },
    { id: 'o3', text: 'Tell me when Anna writes', kind: 'tell' as const, state: 'draft' as const },
  ];

  it('adds one in your words, saying what kind it reads as while you type', async () => {
    const onAdd = vi.fn();
    const { container } = renderNacre(
      <StandingOrderList items={items} onAdd={onAdd} kindOf={kindOf} powerNote={NOTE} />,
    );
    const field = screen.getByRole('textbox', { name: 'A new standing order, in your words' });
    await userEvent.type(field, 'You may archive newsletters');
    expect(screen.getByText(/something you welcome/)).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledWith('You may archive newsletters');
    await expectAccessible(container);
  });

  it('says beside one that reaches for a power that it can’t give one', () => {
    renderNacre(<StandingOrderList items={items} powerNote={NOTE} />);
    expect(screen.getByText('You may send emails without asking')).toHaveAccessibleDescription(
      NOTE,
    );
  });

  it('changes words with Enter, leaves them with Escape, and keeps or removes by name', async () => {
    const onSave = vi.fn();
    const onRemove = vi.fn();
    const onKeep = vi.fn();
    renderNacre(
      <StandingOrderList
        items={items}
        onSave={onSave}
        onRemove={onRemove}
        onKeep={onKeep}
        powerNote={NOTE}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Change “Always tell me if a flight changes”' }),
    );
    const edit = screen.getByRole('textbox', { name: 'Standing order' });
    expect(edit).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Standing order' })).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Change “Always tell me if a flight changes”' }),
    );
    await userEvent.clear(screen.getByRole('textbox', { name: 'Standing order' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Standing order' }),
      'Tell me if a train changes{Enter}',
    );
    expect(onSave).toHaveBeenCalledWith('o1', 'Tell me if a train changes');
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onKeep).toHaveBeenCalledWith('o3');
    await userEvent.click(
      screen.getByRole('button', { name: 'Not now: “Tell me when Anna writes”' }),
    );
    expect(onRemove).toHaveBeenCalledWith('o3');
  });
});

describe('StandingOrderOffer', () => {
  it('asks once, with the words in front of you, and settles into a quiet line', async () => {
    const onKeep = vi.fn();
    const { container, rerender } = renderNacre(
      <StandingOrderOffer
        text="Always tell me if a flight changes"
        kind="tell"
        powerNote={NOTE}
        state="offered"
        onKeep={onKeep}
        onDismiss={() => undefined}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Keep this as a standing order?' }),
    ).toHaveTextContent('Always tell me if a flight changes');
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onKeep).toHaveBeenCalled();
    await expectAccessible(container);
    rerender(
      <StandingOrderOffer
        text="Always tell me if a flight changes"
        kind="tell"
        powerNote={NOTE}
        state="kept"
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByRole('region', { name: 'Standing order' })).toHaveTextContent(
      'Kept as a standing order',
    );
    expect(screen.queryByRole('button', { name: 'Keep it' })).toBeNull();
  });
});

describe('CheckInCard', () => {
  const told = [
    {
      id: 't1',
      source: 'mail' as const,
      title: 'Lufthansa’s email',
      note: 'Departure moved to 18:40',
      why: 'You asked: “Always tell me if a flight changes”',
      when: '12 minutes ago',
      href: 'https://mail.google.com/',
    },
  ];

  it('says why you heard about each thing, behind Why?', async () => {
    const { container } = renderNacre(
      <CheckInCard
        state="watching"
        line="Looked 12 minutes ago"
        told={told}
        onToggle={() => undefined}
      />,
    );
    const why = screen.getByRole('button', { name: 'Why?' });
    expect(why).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('You asked: “Always tell me if a flight changes”')).not.toBeVisible();
    await userEvent.click(why);
    expect(why).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('You asked: “Always tell me if a flight changes”')).toBeVisible();
    await expectAccessible(container);
  });

  it('turns off and on with its switch, and offers one button when it needs you', async () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    renderNacre(
      <CheckInCard
        state="needs-you"
        onToggle={onToggle}
        problem={{ message: 'Gmail needs you to sign in again.', action: 'Open Apps', onAction }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Can’t look right now' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Check in on things' }));
    expect(onToggle).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Open Apps' }));
    expect(onAction).toHaveBeenCalled();
  });

  it('has no Look now while there is nothing to look for', () => {
    renderNacre(
      <CheckInCard state="resting" onLookNow={() => undefined} quiet="Quiet 10 PM – 7 AM" />,
    );
    expect(screen.queryByRole('button', { name: 'Look now' })).toBeNull();
  });
});

describe('MorningDigest', () => {
  const items: DigestLine[] = [
    { id: 'd1', kind: 'learned', text: 'Prefers TypeScript', state: 'applied' },
    {
      id: 'd2',
      kind: 'replaced',
      text: 'Lives in Lisbon',
      was: 'Lives in Berlin',
      state: 'applied',
    },
    { id: 'd3', kind: 'merged', text: 'Has a daughter, Mia', state: 'undone' },
  ];

  it('counts only what still stands', () => {
    expect(digestLine(items)).toBe('Learned 2 things');
    expect(digestLine([{ id: 'x', kind: 'merged', text: 'x', state: 'applied' }])).toBe('Tidied 1');
    expect(digestLine([])).toBe('Nothing left to show');
  });

  it('undoes one line by name and folds away with Got it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderNacre(
      <MorningDigest items={items} onUndo={onUndo} onDismiss={onDismiss} />,
    );
    expect(screen.getByRole('region', { name: 'While you slept' })).toHaveTextContent(
      'Was: Lives in Berlin',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo “Lives in Lisbon”' }));
    expect(onUndo).toHaveBeenCalledWith('d2');
    // An undone line says so, and has no second Undo.
    expect(screen.queryByRole('button', { name: 'Undo “Has a daughter, Mia”' })).toBeNull();
    expect(screen.getByText('Undone')).toBeInTheDocument();
    await expectAccessible(container);
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
