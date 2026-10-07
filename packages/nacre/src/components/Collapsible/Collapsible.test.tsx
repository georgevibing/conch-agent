import { screen, waitFor } from '@testing-library/react';
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

  it('open from the start, it arrives open; only a later opening plays the reveal', async () => {
    const { rerender } = renderNacre(
      <Collapsible open>
        <Collapsible.Content data-testid="body">Choices</Collapsible.Content>
      </Collapsible>,
    );
    // The first frame holds it still: nothing fades or slides in as the page opens.
    expect(screen.getByTestId('body')).toHaveAttribute('data-arriving');
    await waitFor(() => expect(screen.getByTestId('body')).not.toHaveAttribute('data-arriving'));
    rerender(
      <Collapsible open={false}>
        <Collapsible.Content data-testid="body">Choices</Collapsible.Content>
      </Collapsible>,
    );
    rerender(
      <Collapsible open>
        <Collapsible.Content data-testid="body">Choices</Collapsible.Content>
      </Collapsible>,
    );
    expect(screen.getByTestId('body')).not.toHaveAttribute('data-arriving');
    expect(screen.getByText('Choices')).toBeVisible();
  });
});
