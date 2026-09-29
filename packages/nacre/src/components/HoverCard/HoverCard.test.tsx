import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { HoverCard } from './HoverCard';

describe('HoverCard', () => {
  it('renders the trigger as a normal, focusable link', async () => {
    const { container } = renderNacre(
      <HoverCard.Root>
        <HoverCard.Trigger href="#file">session.ts</HoverCard.Trigger>
        <HoverCard.Content>Preview</HoverCard.Content>
      </HoverCard.Root>,
    );
    const link = screen.getByRole('link', { name: 'session.ts' });
    link.focus();
    expect(link).toHaveFocus();
    await expectAccessible(container);
  });

  it('shows content when open', async () => {
    renderNacre(
      <HoverCard.Root defaultOpen>
        <HoverCard.Trigger href="#file">session.ts</HoverCard.Trigger>
        <HoverCard.Content>+42 −17</HoverCard.Content>
      </HoverCard.Root>,
    );
    expect(await screen.findByText('+42 −17')).toBeInTheDocument();
  });
});
