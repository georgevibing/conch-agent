import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { DeviceApproval } from './DeviceApproval';
import { DeviceList } from './DeviceList';
import { DeviceRequests } from './DeviceRequests';
import { SecretReveal } from './SecretReveal';
import { SecurityCheckup } from './SecurityCheckup';
import { approvedDevices, checkupItems, checkupWithFixes, devices, requests } from './fixtures';

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

describe('DeviceList with remembered devices', () => {
  it('signs out what is signed in, and removes anything but this device', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const onRemove = vi.fn();
    const { container } = renderNacre(
      <DeviceList
        label="Devices"
        devices={approvedDevices}
        onSignOut={onSignOut}
        onRemove={onRemove}
      />,
    );
    const list = screen.getByRole('list', { name: 'Devices' });
    expect(list.querySelectorAll('li')).toHaveLength(4);
    // A signed-out device has nothing to sign out of; this device can't remove itself.
    expect(screen.queryByRole('button', { name: 'Sign out Safari on iPad' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Chrome on Mac' })).toBeNull();
    expect(screen.getByText('Not used in 90 days')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Safari on iPad' }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'dev_ipad' }));
    await user.click(screen.getByRole('button', { name: 'Sign out Ada’s iPhone' }));
    expect(onSignOut).toHaveBeenCalledWith(expect.objectContaining({ id: 'dev_phone' }));
    await expectAccessible(container);
  });
});

describe('DeviceList with notifications', () => {
  it('says which devices get them, and stops them without signing out', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const onSignOut = vi.fn();
    const { container } = renderNacre(
      <DeviceList
        label="Devices"
        devices={approvedDevices.map((d) => ({ ...d, notified: d.id === 'dev_phone' }))}
        onSignOut={onSignOut}
        onStopNotifications={onStop}
      />,
    );
    expect(screen.getAllByText('Gets notifications')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Stop notifications/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Stop notifications on Ada’s iPhone' }));
    expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ id: 'dev_phone' }));
    expect(onSignOut).not.toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('DeviceRequests', () => {
  it('approves and turns down on the computer running Conch', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const { container } = renderNacre(
      <DeviceRequests requests={requests} canApprove onApprove={onApprove} onReject={onReject} />,
    );
    await user.click(screen.getByRole('button', { name: 'Approve Safari on iPhone (K7M-Q2X)' }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ code: 'K7M-Q2X' }));
    await user.click(screen.getByRole('button', { name: 'Turn down Safari on iPhone (K7M-Q2X)' }));
    expect(onReject).toHaveBeenCalled();
    // One turned down can still be approved, and can't be turned down twice.
    expect(screen.getByRole('button', { name: /Approve Scripts using/ })).toHaveTextContent(
      'Approve anyway',
    );
    expect(screen.queryByRole('button', { name: /Turn down Scripts using/ })).toBeNull();
    await expectAccessible(container);
  });

  it('elsewhere, shows the command to run there instead of approving', async () => {
    const { container } = renderNacre(
      <DeviceRequests requests={requests} canApprove={false} onReject={() => undefined} />,
    );
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(screen.getByText('pnpm conch devices approve K7M-Q2X')).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('DeviceApproval', () => {
  it('shows the code and the command, and counts down while it waits', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = renderNacre(
      <DeviceApproval
        state="waiting"
        code="K7M-Q2X"
        device="Safari on iPhone"
        expiresAt={Date.now() + 5 * 60 * 1000}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Approve this device' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Approval code K 7 M - Q 2 X' })).toBeInTheDocument();
    expect(screen.getByText('pnpm conch devices approve K7M-Q2X')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for approval/)).toHaveTextContent(/[45]:\d\d left/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('says plainly when it was turned down, and offers to ask again', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { container } = renderNacre(
      <DeviceApproval
        state="rejected"
        code="K7M-Q2X"
        device="Safari on iPhone"
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'This device wasn’t approved' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/pnpm conch devices approve/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(onRetry).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('DeviceApproval from your devices (ADR 0065)', () => {
  it('says any of your devices can let it in, with the terminal second', async () => {
    const { container } = renderNacre(
      <DeviceApproval
        state="waiting"
        code="K7M-Q2X"
        device="Chrome on Windows"
        command="conch devices approve K7M-Q2X"
        fromDevices
      />,
    );
    expect(screen.getByText(/a device you’re already signed in on/)).toBeInTheDocument();
    expect(screen.getByText(/Open Conch on your laptop or phone/)).toBeInTheDocument();
    expect(screen.getByText('conch devices approve K7M-Q2X')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('offers this device’s passkey instead of waiting', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    const { container } = renderNacre(
      <DeviceApproval
        state="waiting"
        code="K7M-Q2X"
        device="Safari on Mac"
        fromDevices
        passkey={{ platform: 'mac', onUse }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Use Touch ID to let yourself in' }));
    expect(onUse).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('doesn’t offer a passkey once it was turned down', () => {
    renderNacre(
      <DeviceApproval
        state="rejected"
        code="K7M-Q2X"
        device="Safari on Mac"
        fromDevices
        passkey={{ platform: 'mac', onUse: () => undefined }}
      />,
    );
    expect(screen.getByText(/It was turned down\. If that was a mistake/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Touch ID/ })).toBeNull();
  });
});

describe('DeviceRequests hint', () => {
  it('says where to approve, in the app’s words', () => {
    renderNacre(
      <DeviceRequests
        requests={requests.slice(0, 1)}
        canApprove={false}
        hint="Approve it from a device you’ve signed in on:"
        commandFor={(code) => `conch devices approve ${code}`}
      />,
    );
    expect(screen.getByText('Approve it from a device you’ve signed in on:')).toBeInTheDocument();
    const [first] = requests;
    expect(screen.getByText(`conch devices approve ${first?.code ?? ''}`)).toBeInTheDocument();
  });
});
