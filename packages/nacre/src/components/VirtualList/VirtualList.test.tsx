import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { VirtualList, type VirtualListHandle } from './VirtualList';

// jsdom has no layout: say how tall the list's box is (560px = ten 3.5rem rows at 16px).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(560);
});
afterEach(() => vi.restoreAllMocks());

const names = Array.from({ length: 1000 }, (_, i) => `Row ${i}`);

function Rows({ handle }: { handle?: React.Ref<VirtualListHandle> }) {
  return (
    <VirtualList
      role="list"
      aria-label="Rows"
      items={names}
      rowHeight={3.5}
      getKey={(name) => name}
      rowProps={(_, i) => ({
        role: 'listitem',
        'aria-setsize': names.length,
        'aria-posinset': i + 1,
      })}
      handle={handle}
    >
      {(name) => <button type="button">{name}</button>}
    </VirtualList>
  );
}

const scrollTo = (top: number) => {
  const list = screen.getByRole('list');
  list.scrollTop = top;
  fireEvent.scroll(list);
};

describe('VirtualList', () => {
  it('draws only the rows near what is in view, and is as tall as all of them', async () => {
    const { container } = renderNacre(<Rows />);
    expect(screen.getByRole('button', { name: 'Row 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Row 9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Row 500' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeLessThan(40);
    // The scrollbar still speaks for every row.
    expect(container.querySelector('[data-vl-size]')).toHaveAttribute('data-vl-size', '3500');
    await expectAccessible(container);
  });

  it('draws the rows that were scrolled to, and lets go of the ones left behind', () => {
    renderNacre(<Rows />);
    scrollTo(500 * 56);
    expect(screen.getByRole('button', { name: 'Row 500' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Row 509' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Row 0' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeLessThan(40);
  });

  it('tells each row its place among all of them', () => {
    renderNacre(<Rows />);
    scrollTo(500 * 56);
    const item = screen.getByRole('button', { name: 'Row 500' }).closest('[role="listitem"]');
    expect(item).toHaveAttribute('aria-posinset', '501');
    expect(item).toHaveAttribute('aria-setsize', '1000');
  });

  it('brings a row into view when asked, scrolling no further than it must', () => {
    const handle = createRef<VirtualListHandle>();
    renderNacre(<Rows handle={handle} />);
    act(() => handle.current?.scrollToIndex(700));
    expect(screen.getByRole('button', { name: 'Row 700' })).toBeInTheDocument();
    // Row 700 ends at 701 × 56px; the box shows 560px.
    expect(screen.getByRole('list').scrollTop).toBe(701 * 56 - 560);
    // Already in view: nothing moves.
    act(() => handle.current?.scrollToIndex(695));
    expect(screen.getByRole('list').scrollTop).toBe(701 * 56 - 560);
    act(() => handle.current?.scrollToIndex(2));
    expect(screen.getByRole('list').scrollTop).toBe(2 * 56);
  });

  it('keeps the row that has the keyboard while it scrolls out of view', async () => {
    renderNacre(<Rows />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Row 3' }));
    scrollTo(500 * 56);
    expect(screen.getByRole('button', { name: 'Row 3' })).toHaveFocus();
    // Once the keyboard is elsewhere, it goes like any other row.
    act(() => screen.getByRole('button', { name: 'Row 3' }).blur());
    expect(screen.queryByRole('button', { name: 'Row 3' })).not.toBeInTheDocument();
  });

  it('gives rows of different heights their own places, and keeps a heading up while its rows pass', () => {
    interface Row {
      id: string;
      heading?: true;
    }
    const rows: Row[] = Array.from({ length: 30 }, (_, group) => [
      { id: `Group ${group}`, heading: true as const },
      ...Array.from({ length: 9 }, (__, i) => ({ id: `Item ${group}.${i}` })),
    ]).flat();
    renderNacre(
      <VirtualList
        role="list"
        aria-label="Groups"
        items={rows}
        rowHeight={(row) => (row.heading ? 2 : 3.5)}
        getKey={(row) => row.id}
        sticky={(row) => Boolean(row.heading)}
      >
        {(row) => <span>{row.id}</span>}
      </VirtualList>,
    );
    const place = (text: string) =>
      (screen.getAllByText(text).at(-1)?.parentElement as HTMLElement).style.getPropertyValue(
        '--vl-at',
      );
    expect(place('Group 0')).toBe('0');
    expect(place('Item 0.0')).toBe('2');
    expect(place('Item 0.1')).toBe('5.5');

    // A group is 2 + 9 × 3.5 = 33.5rem. Halfway down group 5:
    scrollTo((5 * 33.5 + 16) * 16);
    const held = document.querySelector('[data-vl-sticky]');
    expect(held).toHaveTextContent('Group 5');
    // The copy held at the top is for the eye; the heading itself is still in the list.
    expect(held).toHaveAttribute('aria-hidden', 'true');
  });
});
