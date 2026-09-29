import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ScrollArea } from './ScrollArea';

describe('ScrollArea', () => {
  it('renders a keyboard-focusable named region when labelled', async () => {
    const { container } = renderNacre(
      <ScrollArea label="Transcript" style={{ height: 100 }}>
        <p>Content</p>
      </ScrollArea>,
    );
    const region = screen.getByRole('region', { name: 'Transcript' });
    await userEvent.tab();
    expect(region).toHaveFocus();
    await expectAccessible(container);
  });

  it('forwards the viewport ref and sets fade state', () => {
    const ref = createRef<HTMLDivElement>();
    renderNacre(
      <ScrollArea viewportRef={ref}>
        <p>Content</p>
      </ScrollArea>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveAttribute('data-fade-top', 'false');
  });
});
