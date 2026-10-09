import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from '../../components/Switch';
import { expectAccessible, renderNacre } from '../../test/render';
import { SettingsRow, SettingsSubpages } from './SettingsSubpages';

function Place({ startAt = null }: { startAt?: string | null }) {
  const [page, setPage] = useState<string | null>(startAt);
  return (
    <>
      {page && (
        <button type="button" onClick={() => setPage(null)}>
          Back to Health
        </button>
      )}
      <SettingsSubpages page={page} data-testid="pages">
        {page ? (
          <Switch label="Keep this Mac awake" />
        ) : (
          <SettingsRow
            page="always-on"
            label="Always on"
            value="On"
            onClick={() => setPage('always-on')}
          />
        )}
      </SettingsSubpages>
    </>
  );
}

describe('SettingsRow', () => {
  it('is one button: its name, where things stand, and a chevron', async () => {
    const onClick = vi.fn();
    const { container } = renderNacre(
      <SettingsRow
        label="Topics"
        description="What it tells you about"
        value="4 of 6"
        onClick={onClick}
      />,
    );
    const row = screen.getByRole('button', { name: /Topics/ });
    expect(row).toHaveTextContent('What it tells you about');
    expect(row).toHaveTextContent('4 of 6');
    await expectAccessible(container);
    await userEvent.tab();
    expect(row).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe('SettingsSubpages', () => {
  it('slides the page in, and slides the place back with the focus on its row', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<Place />);
    // Arriving, nothing moves.
    expect(screen.getByTestId('pages')).not.toHaveAttribute('data-direction');
    await expectAccessible(container);

    await user.click(screen.getByRole('button', { name: /Always on/ }));
    expect(screen.getByRole('switch', { name: 'Keep this Mac awake' })).toBeVisible();
    expect(screen.getByTestId('pages')).toHaveAttribute('data-direction', 'in');
    expect(screen.getByTestId('pages')).toHaveAttribute('data-page', 'always-on');

    await user.click(screen.getByRole('button', { name: 'Back to Health' }));
    expect(screen.getByTestId('pages')).toHaveAttribute('data-direction', 'out');
    expect(screen.getByRole('button', { name: /Always on/ })).toHaveFocus();
  });

  it('opened at a page by its address, the page is simply there', () => {
    renderNacre(<Place startAt="always-on" />);
    expect(screen.getByRole('switch', { name: 'Keep this Mac awake' })).toBeVisible();
    expect(screen.getByTestId('pages')).not.toHaveAttribute('data-direction');
  });

  it('leaves the focus alone when something else has it', async () => {
    const user = userEvent.setup();
    function Outside() {
      const [page, setPage] = useState<string | null>('always-on');
      return (
        <>
          <button type="button" onClick={() => setPage(null)}>
            Elsewhere
          </button>
          <SettingsSubpages page={page}>
            {page ? 'Inside' : <SettingsRow page="always-on" label="Always on" />}
          </SettingsSubpages>
        </>
      );
    }
    renderNacre(<Outside />);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });
});
