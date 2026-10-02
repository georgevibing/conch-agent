import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { DeviceLinkCard } from './DeviceLinkCard';
import { LinkedDevicesSketch } from './LinkedDevicesSketch';

const QR = 'https://wa.me/settings/linked_devices#2@abc,def,ghi,jkl,7';

describe('DeviceLinkCard', () => {
  it('while showing: the code, named for screen readers, and what it waits for', async () => {
    const { container } = renderNacre(
      <DeviceLinkCard
        state="showing"
        qr={QR}
        title="Scan this with WhatsApp"
        qrLabel="Scan with WhatsApp on your phone"
      >
        <ol>
          <li>Open WhatsApp.</li>
        </ol>
      </DeviceLinkCard>,
    );
    expect(
      screen.getByRole('img', { name: 'Scan with WhatsApp on your phone' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/The code changes by itself/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scan this with WhatsApp' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('before and after the code, shows no code at all, and says it’s busy', async () => {
    const { container, rerender } = renderNacre(
      <DeviceLinkCard state="starting" qr={QR} title="Getting a code" />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    rerender(<DeviceLinkCard state="finishing" qr={QR} title="Scanned" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Finishing on your phone…')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('a code that ran out offers a new one; linked offers what’s next', async () => {
    const onRetry = vi.fn();
    const { container, rerender } = renderNacre(
      <DeviceLinkCard
        state="expired"
        title="The code ran out"
        message="Nobody scanned it in time."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Nobody scanned it in time.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show a new code' }));
    expect(onRetry).toHaveBeenCalled();
    await expectAccessible(container);
    rerender(
      <DeviceLinkCard
        state="linked"
        title="You’re connected"
        actions={<button type="button">Send a test</button>}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Show a new code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a test' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('LinkedDevicesSketch', () => {
  it('is one labelled picture: the button to press, and the devices linked', async () => {
    const { container } = renderNacre(
      <LinkedDevicesSketch
        label="Linked devices in WhatsApp"
        action="Link a device"
        devices={[{ name: 'Conch', meta: 'Active now', isNew: true }]}
        note="Your messages are end-to-end encrypted."
        alive
      />,
    );
    const figure = screen.getByRole('figure', { name: 'Linked devices in WhatsApp' });
    expect(figure).toHaveTextContent('Link a device');
    expect(figure).toHaveTextContent('Conch');
    // A picture, not controls: nothing in it can be pressed.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await expectAccessible(container);
  });
});
