import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { WatchStatus } from './WatchStatus';

const NOW = Date.UTC(2026, 9, 3, 12);

describe('WatchStatus', () => {
  it('says it’s watching, for what, and what it did', async () => {
    const { container } = renderNacre(
      <WatchStatus
        state="watching"
        text="When Anna Smith emails you"
        onlyIf="it’s about the invoice"
        noticed={5}
        woke={1}
        passed={4}
        now={NOW}
      />,
    );
    expect(screen.getByRole('region', { name: 'Watching' })).toBeInTheDocument();
    expect(screen.getByText(/only if it’s about the invoice/)).toBeInTheDocument();
    expect(
      screen.getByText('5 things noticed · 1 run started · 4 passed over by “only if”'),
    ).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('gives one thing to do when only a person can fix it', async () => {
    const onClick = vi.fn();
    renderNacre(
      <WatchStatus
        state="needs-you"
        text="When Anna Smith emails you"
        message="Gmail needs you to sign in again."
        action={{ label: 'Open Apps', onClick }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Gmail needs you to sign in again.');
    await userEvent.click(screen.getByRole('button', { name: 'Open Apps' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('shows another app’s address to copy, and a secret exactly once', async () => {
    const make = vi.fn(async () => 'whsec_' + 'abc123');
    const { container } = renderNacre(
      <WatchStatus
        state="watching"
        text="When another app sends a message"
        address="https://pc.ts.net/conch/hooks/xyz"
        signed={false}
        onNewSecret={make}
      />,
    );
    expect(screen.getByText('https://pc.ts.net/conch/hooks/xyz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy the address' })).toBeInTheDocument();
    expect(screen.getByText(/Anyone with this address can start it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add a secret' }));
    expect(make).toHaveBeenCalledOnce();
    expect(screen.getByText('whsec_abc123')).toBeInTheDocument();
    expect(screen.getByText(/won’t show it again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a secret' })).toBeNull();
    await expectAccessible(container);
  });

  it('says why a secret couldn’t be made', async () => {
    renderNacre(
      <WatchStatus
        state="watching"
        text="When another app sends a message"
        signed
        onNewSecret={async () => {
          throw new Error('That routine no longer exists.');
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Make a new secret' }));
    expect(screen.getByText('That routine no longer exists.')).toBeInTheDocument();
  });
});
