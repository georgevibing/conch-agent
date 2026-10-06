import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { MeaningHint, MemoryAdd, MemoryCell, MemoryCells, MemoryGlance } from './Knows';

describe('What Conch knows', () => {
  it('sums it up in one number and one bar, and the kinds are the filter', async () => {
    const onFilterChange = vi.fn();
    const { container } = renderNacre(
      <MemoryGlance
        counts={{ preference: 3, person: 1, fact: 2 }}
        status="Learning quietly"
        onFilterChange={onFilterChange}
      />,
    );
    expect(screen.getByRole('region')).toHaveAccessibleName('6 memories');
    expect(screen.getByRole('img')).toHaveAccessibleName('3 preferences, 1 person, 2 facts');
    expect(screen.getByText('Learning quietly')).toBeInTheDocument();
    // A kind with nothing in it can't be chosen.
    expect(screen.getByRole('button', { name: /Projects/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /People/ }));
    expect(onFilterChange).toHaveBeenCalledWith('person');
    await expectAccessible(container);
  });

  it('pressing the chosen kind again shows everything', async () => {
    const onFilterChange = vi.fn();
    renderNacre(
      <MemoryGlance counts={{ person: 2 }} filter="person" onFilterChange={onFilterChange} />,
    );
    const people = screen.getByRole('button', { name: /People/ });
    expect(people).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(people);
    expect(onFilterChange).toHaveBeenCalledWith(null);
  });

  it('says when nothing is remembered yet, without a filter', () => {
    renderNacre(<MemoryGlance counts={{}} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Nothing remembered yet');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('a cell edits from its words, and forgets after folding away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onEdit = vi.fn();
    const onForget = vi.fn();
    const { container } = renderNacre(
      <MemoryCells aria-label="Memories">
        <MemoryCell
          kind="person"
          label="Sister Ana"
          meta="You added"
          onEdit={onEdit}
          onForget={onForget}
        >
          Sister Ana
        </MemoryCell>
      </MemoryCells>,
    );
    const cell = screen.getByRole('listitem');
    expect(cell).toHaveTextContent('person: Sister Ana');
    await userEvent.click(screen.getByText('Sister Ana'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    await expectAccessible(container);
    await userEvent.click(screen.getByRole('button', { name: 'Forget: Sister Ana' }));
    expect(cell).toHaveAttribute('data-leaving');
    expect(onForget).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onForget).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a swipe to the start forgets, on touch only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onForget = vi.fn();
    renderNacre(
      <MemoryCells aria-label="Memories">
        <MemoryCell kind="fact" label="Lives in Lisbon" onForget={onForget}>
          Lives in Lisbon
        </MemoryCell>
      </MemoryCells>,
    );
    const cell = screen.getByRole('listitem');
    cell.getBoundingClientRect = () => ({ width: 300, height: 48 }) as DOMRect;
    const at = (type: string, x: number, t: number, pointerType = 'touch') =>
      fireEvent[type as 'pointerDown'](cell, {
        pointerId: 1,
        pointerType,
        clientX: x,
        clientY: 10,
        timeStamp: t,
      });
    // A mouse drag is not a swipe.
    at('pointerDown', 280, 0, 'mouse');
    at('pointerMove', 100, 50, 'mouse');
    at('pointerUp', 100, 60, 'mouse');
    expect(cell).not.toHaveAttribute('data-leaving');
    at('pointerDown', 280, 100);
    at('pointerMove', 240, 120);
    at('pointerMove', 120, 160);
    at('pointerUp', 120, 170);
    expect(cell).toHaveAttribute('data-leaving');
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onForget).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('remembers what you typed in one press', async () => {
    const onAdd = vi.fn();
    const { container } = renderNacre(
      <MemoryCells aria-label="Memories">
        <MemoryAdd text="Allergic to peanuts" onAdd={onAdd} />
      </MemoryCells>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Remember.*Allergic to peanuts/ }));
    expect(onAdd).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('offers search by meaning in one line, with its action', async () => {
    const { container } = renderNacre(
      <MeaningHint state="offer" size="23 MB" action={<button type="button">Get it</button>} />,
    );
    expect(screen.getByText(/Search by meaning, too · 23 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get it' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
