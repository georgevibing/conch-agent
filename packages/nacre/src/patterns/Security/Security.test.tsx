import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { DeviceList } from './DeviceList';
import { SecretReveal } from './SecretReveal';
import { SecurityCheckup } from './SecurityCheckup';
import { checkupItems, checkupWithFixes, devices } from './fixtures';

describe('SecretReveal', () => {
  it('shows the secret with a copy button', async () => {
    const onCopied = vi.fn();
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { container } = renderNacre(<SecretReveal secret="conch_abc123" onCopied={onCopied} />);
    expect(screen.getByText('conch_abc123')).toBeInTheDocument();
    expect(screen.getByText(/won’t be shown again/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopied).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('SecurityCheckup', () => {
  it('headlines problems, spells out levels and offers commands', async () => {
    const { container } = renderNacre(<SecurityCheckup items={checkupItems} />);
    expect(screen.getByText('2 things need your attention')).toBeInTheDocument();
    expect(screen.getByText(/Needs attention:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says so when everything passed', () => {
    renderNacre(<SecurityCheckup items={checkupItems.filter((i) => i.level === 'ok')} />);
    expect(screen.getByText('Looking good')).toBeInTheDocument();
  });

  it('gives each finding its one fix, named by what it fixes', async () => {
    const { container } = renderNacre(<SecurityCheckup items={checkupWithFixes} />);
    const turnOff = screen.getByRole('button', { name: 'Turn off' });
    expect(turnOff).toHaveAccessibleDescription(/The browser can open local apps/);
    expect(screen.getByRole('button', { name: 'Review keys' })).toHaveAccessibleDescription(
      /hasn’t been used in 90 days/,
    );
    // Only a person can change their environment: that one is a line to copy.
    const token = screen.getByText('An access key is set in CONCH_TOKEN').closest('li');
    expect(token?.querySelectorAll('button')).toHaveLength(1);
    await expectAccessible(container);
  });

  it('shows progress while a fix runs, and is ready again if the finding stays', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const onFix = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderNacre(
      <SecurityCheckup
        items={[
          {
            id: 'full-trust',
            level: 'warn',
            title: 'New chats never ask before acting',
            detail: 'Full trust.',
            fix: { label: 'Ask first', onFix },
          },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Ask first' });
    await user.click(button);
    expect(onFix).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('aria-busy', 'true');
    // A second press while it runs does nothing.
    await user.click(button);
    expect(onFix).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
  });

  it('offers nothing to fix on a check that passed', () => {
    renderNacre(
      <SecurityCheckup
        items={[
          {
            id: 'sign-in',
            level: 'ok',
            title: 'Protected by your password',
            detail: 'Every device has to sign in.',
            fix: { label: 'Change', onFix: () => undefined },
          },
        ]}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DeviceList', () => {
  it('lists this device first and signs others out', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const { container } = renderNacre(<DeviceList devices={devices} onSignOut={onSignOut} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('This device');
    await user.click(screen.getByRole('button', { name: 'Sign out Safari on iPhone' }));
    expect(onSignOut).toHaveBeenCalledWith(expect.objectContaining({ id: 's_phone' }));
    await expectAccessible(container);
  });
});
