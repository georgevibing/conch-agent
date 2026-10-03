import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AddressStatus } from './AddressStatus';
import { MakeItYours, type MakeItYoursProps, type PasswordVerdict } from './MakeItYours';

/** The unseen copy that holds the card's size isn't what anyone reads. */
const UNSEEN = '[inert], [inert] *';

const checkPassword = (password: string): PasswordVerdict =>
  password.length >= 15
    ? { ok: true, score: 4, label: 'Strong', message: 'Strong password.' }
    : { ok: false, score: 0, label: 'Too short', message: 'Use at least 15 characters.' };

function setup(props: Partial<MakeItYoursProps> = {}) {
  const onPasskey = vi.fn();
  const onPassword = vi.fn();
  const view = renderNacre(
    <MakeItYours
      state="ready"
      address="conch.example.com"
      platform="mac"
      username="george"
      checkPassword={checkPassword}
      suggestPassword={() => 'k7mbqe-x3tnzr-wd8pha'}
      onPasskey={onPasskey}
      onPassword={onPassword}
      {...props}
    />,
  );
  return { ...view, onPasskey, onPassword, user: userEvent.setup() };
}

describe('MakeItYours', () => {
  it('leads with the device’s own passkey, and says whose it is', async () => {
    const { container, user, onPasskey } = setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Make Conch yours' })).toBeInTheDocument();
    expect(
      screen.getByText(/Whoever opens this link first owns this Conch/, { ignore: UNSEEN }),
    ).toBeInTheDocument();
    expect(screen.getByText('conch.example.com', { ignore: UNSEEN })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use Touch ID' }));
    expect(onPasskey).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('keeps a password one press away, and back again', async () => {
    const { user } = setup({ platform: 'windows' });
    await user.click(screen.getByRole('button', { name: 'Choose a password instead' }));
    expect(screen.getByRole('form', { name: 'Choose a password' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use Windows Hello instead' }));
    expect(screen.getByRole('button', { name: 'Use Windows Hello' })).toBeInTheDocument();
  });

  it('sets a password only once it’s good enough', async () => {
    const { user, onPassword, container } = setup({ platform: undefined });
    const password = container.querySelector<HTMLInputElement>('input[name="new-password"]');
    if (!password) throw new Error('No password field');
    const submit = screen.getByRole('button', { name: 'Make it mine' });
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('george');
    expect(submit).toBeDisabled();
    expect(password).toHaveAccessibleName('Password');
    await user.type(password, 'short');
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Suggest a strong one' }));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onPassword).toHaveBeenCalledWith('george', 'k7mbqe-x3tnzr-wd8pha');
    await expectAccessible(container);
  });

  it('leads with the password where nothing is built in, the phone a link away', async () => {
    const { user, onPasskey } = setup({ platform: 'phone' });
    expect(screen.getByRole('form', { name: 'Choose a password' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use your phone instead' }));
    await user.click(screen.getByRole('button', { name: 'Use your phone' }));
    expect(onPasskey).toHaveBeenCalledOnce();
  });

  it('shows the press it’s waiting on, and keeps the other way still', async () => {
    const { user, rerender, onPasskey } = setup();
    await user.click(screen.getByRole('button', { name: 'Use Touch ID' }));
    rerender(
      <MakeItYours
        state="working"
        address="conch.example.com"
        platform="mac"
        username="george"
        checkPassword={checkPassword}
        onPasskey={onPasskey}
      />,
    );
    expect(screen.getByRole('button', { name: 'Use Touch ID' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Choose a password instead' })).toBeDisabled();
  });

  it('says what went wrong, and lets you try again', async () => {
    const { container } = setup({ state: 'error', error: 'Touch ID was cancelled.' });
    expect(screen.getByText('Touch ID was cancelled.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Touch ID' })).toBeEnabled();
    await expectAccessible(container);
  });

  it('celebrates, then opens Conch', async () => {
    const onContinue = vi.fn();
    const { user, container } = setup({ state: 'done', onContinue });
    expect(screen.getByRole('heading', { level: 1, name: 'It’s yours' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Conch' }));
    expect(onContinue).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('explains a spent link and how to get a fresh one', async () => {
    const onSignIn = vi.fn();
    const { user, container } = setup({ state: 'expired', onSignIn, command: 'conch hello' });
    expect(screen.getByText('conch hello')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Already set it up? Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('holds its size with an unseen copy nobody can reach', () => {
    const { container } = setup();
    const hold = container.querySelector('[inert]');
    expect(hold).not.toBeNull();
    expect(hold?.querySelector('input[name]')).toBeNull();
  });
});

describe('AddressStatus', () => {
  it('is one quiet line when all is well', async () => {
    const onTurnOff = vi.fn();
    const user = userEvent.setup();
    const { container } = renderNacre(
      <AddressStatus
        state="ready"
        address="conch.example.com"
        until="2 January 2027"
        onTurnOff={onTurnOff}
      />,
    );
    expect(screen.getByText('https://conch.example.com')).toBeInTheDocument();
    expect(screen.getByText(/Secure · renews by itself/)).toBeInTheDocument();
    expect(screen.getByText(/good until 2 January 2027/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(onTurnOff).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('says what it’s doing while it gets a certificate', () => {
    renderNacre(<AddressStatus state="getting" address="conch.example.com" />);
    expect(screen.getByText(/Getting a certificate/)).toBeInTheDocument();
  });

  it('gives a problem its one fix', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { container } = renderNacre(
      <AddressStatus
        state="problem"
        address="conch.example.com"
        problem={{
          message: 'Renewing didn’t work yet.',
          action: { label: 'Try renewing now', onClick },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Try renewing now' }));
    expect(onClick).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('or the one line only a person can run', () => {
    renderNacre(
      <AddressStatus
        state="problem"
        address="conch.example.com"
        problem={{ message: 'Ports.', command: 'sudo setcap cap_net_bind_service=+ep node' }}
      />,
    );
    expect(screen.getByText('sudo setcap cap_net_bind_service=+ep node')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
  });

  it('pitches itself when off', async () => {
    const onSetUp = vi.fn();
    const user = userEvent.setup();
    const { container } = renderNacre(<AddressStatus state="off" onSetUp={onSetUp} />);
    expect(screen.getByText('Open Conch from anywhere')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up' }));
    expect(onSetUp).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});
