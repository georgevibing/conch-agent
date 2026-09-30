import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('uses label as the accessible name', async () => {
    const { container } = renderNacre(
      <IconButton label="Settings">
        <Settings />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows the label as a tooltip on keyboard focus', async () => {
    renderNacre(
      <IconButton label="Settings" shortcut="mod+,">
        <Settings />
      </IconButton>,
    );
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Settings');
  });

  it('can opt out of the tooltip', async () => {
    renderNacre(
      <IconButton label="Settings" tooltip={false}>
        <Settings />
      </IconButton>,
    );
    await userEvent.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('says what waits behind its dot, to everyone', async () => {
    const { container } = renderNacre(
      <IconButton label="Settings" dot="Update available">
        <Settings />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Settings, Update available' });
    expect(button).toHaveAttribute('data-dot');
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Settings · Update available');
    await expectAccessible(container);
  });
});
