import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Collapsible } from './Collapsible';

describe('Collapsible', () => {
  it('toggles with the keyboard and wires aria-expanded', async () => {
    const { container } = renderNacre(
      <Collapsible>
        <Collapsible.Trigger>Details</Collapsible.Trigger>
        <Collapsible.Content>Hidden body</Collapsible.Content>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: 'Details' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Hidden body')).toBeNull();

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hidden body')).toBeVisible();
    await expectAccessible(container);

    await userEvent.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
