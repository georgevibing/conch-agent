import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Page } from './Page';

describe('Page', () => {
  it('puts its column inside a pane that scrolls on its own', async () => {
    const { container } = renderNacre(
      <Page data-testid="page" gap={8} className="mine">
        <h1>Apps</h1>
      </Page>,
    );
    const column = screen.getByTestId('page');
    expect(column).toHaveClass('mine');
    expect(column.style.gap).toBe('var(--nc-space-8)');
    expect(column.style.flexDirection).toBe('column');
    // The scroller is the column's parent, not the column, so the scrollbar
    // sits at the pane's edge.
    expect(column.parentElement).not.toBe(container);
    expect(column.parentElement).toContainElement(column);
    await expectAccessible(container);
  });
});
