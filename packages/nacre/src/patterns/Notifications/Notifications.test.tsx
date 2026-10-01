import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AddToHomeScreen } from './AddToHomeScreen';
import { NotifiedDevices } from './NotifiedDevices';
import { NotifyThisDevice } from './NotifyThisDevice';

describe('NotifyThisDevice', () => {
  it('turns notifications on from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderNacre(<NotifyThisDevice state="off" onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Notifications on this device' });
    expect(toggle).toHaveAccessibleDescription(/Nothing while you’re looking at Conch/);
    toggle.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
    await expectAccessible(container);
  });

  it('offers a test once on', async () => {
    const user = userEvent.setup();
    const onTest = vi.fn();
    renderNacre(<NotifyThisDevice state="on" onChange={() => undefined} onTest={onTest} />);
    await user.click(screen.getByRole('button', { name: 'Send a test' }));
    expect(onTest).toHaveBeenCalled();
  });

  it('has no switch when the device needs something first', async () => {
    const { container, rerender } = renderNacre(
      <NotifyThisDevice state="install" onChange={() => undefined}>
        <AddToHomeScreen />
      </NotifyThisDevice>,
    );
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('list', { name: 'Add Conch to your Home Screen' })).toHaveTextContent(
      'Add to Home Screen',
    );
    await expectAccessible(container);
    rerender(<NotifyThisDevice state="blocked" onChange={() => undefined} />);
    expect(
      screen.getByRole('region', { name: 'Notifications are blocked for Conch' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('NotifiedDevices', () => {
  it('lists each device with a way to stop it', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const { container } = renderNacre(
      <NotifiedDevices
        devices={[
          { id: 'a', name: 'Safari on iPhone', detail: 'Last told today', current: true },
          { id: 'b', name: 'Chrome on Mac', problem: 'The last one didn’t arrive.' },
        ]}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('The last one didn’t arrive.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop notifications on Chrome on Mac' }));
    expect(onRemove).toHaveBeenCalledWith('b');
    await expectAccessible(container);
  });
});
