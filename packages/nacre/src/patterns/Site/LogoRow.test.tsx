import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { LogoRow } from './LogoRow';

const items = Array.from({ length: 8 }, (_, index) => ({ id: `${index}`, name: `App ${index}` }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function layout(width: number) {
  let available = width;
  let counter = 52;
  let resize: ResizeObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width =
      this.getAttribute('role') === 'img' ? available : this.dataset.size === 'xs' ? 20 : counter;
    return { width } as DOMRect;
  });
  return {
    disconnect,
    resize(width: number, more = counter) {
      available = width;
      counter = more;
      act(() => resize([], {} as ResizeObserver));
    },
  };
}

function row(current = items) {
  return <LogoRow items={current} style={{ columnGap: '8px' }} />;
}

function marks() {
  return screen.getByRole('img').querySelectorAll(':scope > [data-size="xs"]');
}

describe('LogoRow', () => {
  it('reserves room for the count, then restores marks when the card grows', async () => {
    const space = layout(200);
    const { container, unmount } = renderNacre(row());
    expect(marks()).toHaveLength(5);
    expect(screen.getByText('+3 more')).toBeVisible();
    expect(screen.getByRole('img')).toHaveAccessibleName(items.map((item) => item.name).join(', '));

    space.resize(108);
    expect(marks()).toHaveLength(2);
    expect(screen.getByText('+6 more')).toBeVisible();

    // Exactly enough room for all marks: no count or extra gap is needed.
    space.resize(216);
    expect(marks()).toHaveLength(8);
    expect(screen.queryByText('+1 more')).not.toBeInTheDocument();
    expect(screen.getByText('+8 more').closest('[inert]')).toHaveAttribute('aria-hidden', 'true');
    await expectAccessible(container);
    unmount();
    expect(space.disconnect).toHaveBeenCalledOnce();
  });

  it('remeasures the count when text grows, and can show only the count', () => {
    const space = layout(200);
    renderNacre(row());
    space.resize(200, 80);
    expect(marks()).toHaveLength(4);
    expect(screen.getByText('+4 more')).toBeVisible();
    space.resize(80);
    expect(marks()).toHaveLength(0);
    expect(screen.getAllByText('+8 more').filter((node) => !node.closest('[inert]'))).toHaveLength(
      1,
    );
  });

  it('recounts when the catalog changes and leaves no row for an empty catalog', () => {
    layout(108);
    const { rerender } = renderNacre(row());
    rerender(row(items.slice(0, 1)));
    expect(marks()).toHaveLength(1);
    rerender(row([]));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(row());
    expect(marks()).toHaveLength(2);
    expect(screen.getByText('+6 more')).toBeVisible();
  });
});
