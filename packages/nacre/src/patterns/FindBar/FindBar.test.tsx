import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { FindBar } from './FindBar';
import { findAll, fold } from './match';
import { useFind } from './useFind';

describe('find matching', () => {
  it('ignores case, accents and whitespace differences', () => {
    const text = fold('Crème brûlée,\n  then CREME   Brulee again');
    expect(findAll(text, 'creme brulee')).toEqual([
      [0, 12],
      [21, 35],
    ]);
    expect(findAll(text, '   ')).toEqual([]);
    expect(findAll(fold('a.b a+b'), 'a+b')).toEqual([[4, 7]]);
  });
});

function Harness({ initial = '', target }: { initial?: string; target?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initial);
  const find = useFind(root, { query, target });
  return (
    <>
      <FindBar
        query={query}
        onQueryChange={setQuery}
        count={find.count}
        current={find.current}
        onNext={find.next}
        onPrev={find.prev}
        onClose={() => setQuery('')}
      />
      <div ref={root}>
        <p>
          The <strong>quick</strong> brown fox.
        </p>
        <p data-anchor="two">A quick reply.</p>
        <p aria-hidden="true">quick (hidden)</p>
        <p>
          Split qu<em>ick</em>ly.
        </p>
      </div>
    </>
  );
}

describe('FindBar + useFind', () => {
  it('counts matches across nodes, skips hidden text and cycles', async () => {
    const user = userEvent.setup();
    renderNacre(<Harness />);
    const field = screen.getByRole('searchbox', { name: 'Find in this conversation' });
    expect(field).toHaveFocus();
    await user.type(field, 'quick');
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3');
    await user.keyboard('{Shift>}{Enter}{/Shift}{ArrowUp}');
    expect(screen.getByRole('status')).toHaveTextContent('3 of 3');
    await user.click(screen.getByRole('button', { name: 'Next match' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3');
    await user.clear(field);
    await user.type(field, 'zebra');
    expect(screen.getByRole('status')).toHaveTextContent('No matches');
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
  });

  it('lands on the first match inside a target', () => {
    renderNacre(<Harness initial="quick" target='[data-anchor="two"]' />);
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3');
    expect(document.querySelector('[data-anchor="two"]')).toHaveAttribute('data-nc-flash');
  });

  it('re-scans when content changes', async () => {
    vi.useFakeTimers();
    renderNacre(<Harness initial="fox" />);
    expect(screen.getByRole('status')).toHaveTextContent('1 of 1');
    const extra = document.createElement('p');
    extra.textContent = 'another fox';
    act(() => {
      document.querySelector('[data-anchor="two"]')?.after(extra);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2');
    vi.useRealTimers();
  });

  it('closes on Escape and is accessible', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = renderNacre(
      <FindBar
        query="x"
        onQueryChange={() => {}}
        count={0}
        current={-1}
        onNext={() => {}}
        onPrev={() => {}}
        onClose={onClose}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    await expectAccessible(container);
  });
});
