import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ComputerUseAccess, ComputerUseLive } from './ComputerUse';
import { notesScreen } from './fixtures';

describe('ComputerUseLive', () => {
  it('says what it’s doing, shows the screen and stops with one press', async () => {
    const onStop = vi.fn();
    const { container } = renderNacre(
      <ComputerUseLive
        label="Typing in Notes"
        steps={4}
        maxSteps={60}
        shot={notesScreen}
        stopKeys="⌘⎋"
        onStop={onStop}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Conch is using your computer' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Typing in Notes')).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 60')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'The screen as Conch last saw it' }),
    ).toBeInTheDocument();
    const stop = screen.getByRole('button', { name: /Stop/ });
    expect(stop).toHaveAttribute('aria-keyshortcuts', 'Meta+Escape');
    await userEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('works by keyboard, and without the desktop app’s keys', async () => {
    const onStop = vi.fn();
    renderNacre(<ComputerUseLive label="Looking" steps={1} maxSteps={60} onStop={onStop} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).not.toHaveAttribute('aria-keyshortcuts');
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('says it’s letting go once Stop is pressed', () => {
    renderNacre(
      <ComputerUseLive label="Typing" steps={2} maxSteps={60} onStop={() => undefined} stopping />,
    );
    expect(screen.getByText('Letting go…')).toBeInTheDocument();
  });
});

describe('ComputerUseAccess', () => {
  it('opens the right switch with one press, on the computer itself', async () => {
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <ComputerUseAccess screen="granted" control="missing" grantTo="Conch" here onOpen={onOpen} />,
    );
    expect(screen.getByText('Screen Recording is on for Conch.')).toBeInTheDocument();
    expect(screen.getByText('Turn on Conch in Accessibility.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Accessibility' }));
    expect(onOpen).toHaveBeenCalledWith('control');
    expect(screen.queryByRole('button', { name: 'Open Screen Recording' })).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('offers no button from another device, and says where instead', () => {
    renderNacre(
      <ComputerUseAccess
        screen="missing"
        control="missing"
        grantTo="Terminal"
        here={false}
        onOpen={() => undefined}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText('On the computer itself, turn on Terminal in Screen Recording.'),
    ).toBeInTheDocument();
  });

  it('glints once when a switch turns on', () => {
    const { rerender } = renderNacre(
      <ComputerUseAccess
        screen="granted"
        control="missing"
        grantTo="Conch"
        here
        onOpen={() => undefined}
      />,
    );
    rerender(
      <ComputerUseAccess
        screen="granted"
        control="granted"
        grantTo="Conch"
        here
        onOpen={() => undefined}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[1]).toHaveAttribute('data-glint');
    expect(rows[0]).not.toHaveAttribute('data-glint');
  });
});
