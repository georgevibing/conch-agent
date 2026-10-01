import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AlwaysOn } from './AlwaysOn';

describe('AlwaysOn', () => {
  it('says how Conch runs, and the switch turns it on from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderNacre(
      <AlwaysOn
        on={false}
        onOnChange={onChange}
        running="window"
        since="9:14 AM"
        needed="Your 2 routines only run while Conch is running."
      />,
    );
    const region = screen.getByRole('region', { name: 'Runs while its window is open' });
    expect(region).toHaveTextContent('Running in a Terminal window since 9:14 AM');
    expect(region).toHaveTextContent('Your 2 routines only run while Conch is running.');
    const toggle = screen.getByRole('switch', {
      name: 'Start Conch when I log in and keep it running',
    });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/Closing the Terminal window/);
    toggle.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
    await expectAccessible(container);
  });

  it('when on and in the background, says where the computer lists it, with its actions', async () => {
    const { container } = renderNacre(
      <AlwaysOn
        on
        onOnChange={() => undefined}
        running="background"
        since="yesterday"
        place="System Settings → General → Login Items"
        needed="Not shown when it’s on."
      >
        <button type="button">Quit Conch</button>
      </AlwaysOn>,
    );
    const region = screen.getByRole('region', { name: 'Starts when you log in' });
    expect(region).toHaveTextContent('Running in the background since yesterday');
    expect(region).toHaveTextContent('listed in System Settings → General → Login Items');
    expect(region).not.toHaveTextContent('Not shown');
    expect(within(region).getByRole('button', { name: 'Quit Conch' })).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
    await expectAccessible(container);
  });

  it('turned off while in the background: keeps running until you quit', () => {
    renderNacre(<AlwaysOn on={false} onOnChange={() => undefined} running="background" />);
    expect(screen.getByRole('region', { name: 'Running until you quit it' })).toHaveTextContent(
      'won’t start by itself',
    );
  });

  it('shows a problem with the command to copy, calmly', async () => {
    const { container } = renderNacre(
      <AlwaysOn
        on
        onOnChange={() => undefined}
        running="window"
        problem={{
          message: 'Conch couldn’t start in the background just now.',
          command: 'tail -n 40 ~/.conch/logs/conch.log',
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('couldn’t start in the background');
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    expect(container.querySelector('[data-state="problem"]')).toBeTruthy();
    await expectAccessible(container);
  });

  it('while switching, the switch rests and the page says it comes back', () => {
    renderNacre(<AlwaysOn on={false} onOnChange={() => undefined} running="window" busy />);
    expect(
      screen.getByRole('region', { name: 'Moving Conch to the background…' }),
    ).toHaveTextContent('comes back by itself');
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('where it can’t be turned on, says why and offers no switch', () => {
    renderNacre(
      <AlwaysOn
        on={false}
        onOnChange={() => undefined}
        running="dev"
        unsupported="Always on is for Conch itself (pnpm start), not a development server."
      />,
    );
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('region', { name: 'Not available here' })).toHaveTextContent(
      'not a development server',
    );
  });
});

describe('AlwaysOn options', () => {
  it('shows how it runs under the status, and not while it’s changing', () => {
    const { rerender } = renderNacre(
      <AlwaysOn
        on
        onOnChange={() => undefined}
        running="background"
        options={<p>Menu bar row</p>}
      />,
    );
    expect(screen.getByText('Menu bar row')).toBeInTheDocument();
    rerender(
      <AlwaysOn
        on
        onOnChange={() => undefined}
        running="background"
        busy
        options={<p>Menu bar row</p>}
      />,
    );
    expect(screen.queryByText('Menu bar row')).toBeNull();
  });
});
