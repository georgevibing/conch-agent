import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  PasswordGenerator,
  TotpCode,
  VaultApproval,
  VaultFieldRow,
  VaultHealth,
  VaultRequestCard,
  VaultPasskeyRow,
  VaultRow,
  VaultSourceRow,
  VaultTransferProgress,
  VaultUnlockCard,
} from './Passwords';

describe('VaultRow', () => {
  it('says what an item is, whose it is and what’s wrong, in its name', async () => {
    const { container } = renderNacre(
      <div role="list">
        <div role="listitem">
          <VaultRow
            kind="login"
            title="Forum"
            subtitle="ada"
            domain="forum.example"
            source="bitwarden"
            issues={['compromised']}
            favorite
          />
        </div>
      </div>,
    );
    expect(
      screen.getByRole('button', {
        name: 'Forum, ada, from Bitwarden, favourite, in a data breach',
      }),
    ).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('VaultFieldRow', () => {
  it('keeps a secret as dots until asked, then hides it again by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onReveal = vi.fn().mockResolvedValue('k7mbqe-x3tnzr');
    const onCopy = vi.fn();
    const { container } = renderNacre(
      <VaultFieldRow
        label="Password"
        concealed
        onReveal={onReveal}
        onCopy={onCopy}
        strength={3}
        hideAfter={1000}
      />,
    );
    expect(screen.queryByText('k7mbqe-x3tnzr')).toBeNull();
    expect(screen.getByText('Strong')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(await screen.findByText('k7mbqe-x3tnzr')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(screen.queryByText('k7mbqe-x3tnzr')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Copy password' }));
    expect(onCopy).toHaveBeenCalled();
    await expectAccessible(container);
    vi.useRealTimers();
  });
});

describe('TotpCode', () => {
  it('shows the code split in two and fetches it', async () => {
    const onFetch = vi
      .fn()
      .mockResolvedValue({ code: '123456', period: 30, expiresAt: Date.now() + 20_000 });
    const { container } = renderNacre(<TotpCode period={30} onFetch={onFetch} onCopy={vi.fn()} />);
    expect(await screen.findByText('123 456')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /seconds left/ })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('PasswordGenerator', () => {
  it('makes a new password when a setting changes, and hands it over', async () => {
    const user = userEvent.setup();
    const generate = vi.fn((s: { length: number }) => 'x'.repeat(s.length));
    const onUse = vi.fn();
    const settings = {
      style: 'random' as const,
      length: 20,
      symbols: true,
      digits: true,
      unambiguous: true,
    };
    const { container } = renderNacre(
      <PasswordGenerator
        settings={settings}
        onSettingsChange={vi.fn()}
        generate={generate}
        onUse={onUse}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Make another' }));
    expect(generate).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Use this password' }));
    expect(onUse).toHaveBeenCalledWith('x'.repeat(20));
    await expectAccessible(container);
  });
});

describe('VaultHealth', () => {
  it('lists what needs attention as filters, and says so warmly when nothing does', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container, rerender } = renderNacre(
      <VaultHealth compromised={1} reused={2} weak={0} total={10} onSelect={onSelect} />,
    );
    expect(screen.getByText('3 things need attention')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /In a data breach/ }));
    expect(onSelect).toHaveBeenCalledWith('compromised');
    await expectAccessible(container);
    rerender(<VaultHealth compromised={0} reused={0} weak={0} total={10} />);
    expect(screen.getByText('Your passwords look good')).toBeInTheDocument();
  });
});

describe('VaultSourceRow', () => {
  it('names the state in words', async () => {
    const { container } = renderNacre(
      <VaultSourceRow source="bitwarden" state="locked" message="Unlock it" />,
    );
    expect(screen.getByText('Locked')).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('moving in and passkeys', () => {
  it('says how a copy goes in words, names what couldn’t be read, and keeps sync on the source', async () => {
    const { container } = renderNacre(
      <div>
        <VaultSourceRow
          source="protonpass"
          state="ready"
          count={3}
          sync={{ enabled: true, copies: 3, when: 'up to date just now' }}
        />
        <VaultTransferProgress
          source="dashlane"
          state="running"
          total={10}
          done={4}
          copied={3}
          updated={0}
          skipped={1}
        />
        <VaultTransferProgress
          source="keeper"
          state="done"
          total={2}
          done={2}
          copied={1}
          updated={0}
          skipped={0}
          failed={[{ title: 'Router', message: 'Keeper didn’t answer.' }]}
        />
        <VaultPasskeyRow site="github.com" userName="ada" when="Used yesterday" />
      </div>,
    );
    expect(
      screen.getByText(/3 copies in Conch, kept up to date · up to date just now/),
    ).toBeInTheDocument();
    expect(screen.getByText('Copying from Dashlane…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
    expect(screen.getByText('Copied from Keeper')).toBeInTheDocument();
    expect(screen.getByText(/1 copied · 1 couldn’t be read/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Couldn’t be read' })).toHaveTextContent('Router');
    expect(screen.getByText('Passkey for github.com')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says a row has a passkey', () => {
    renderNacre(<VaultRow kind="login" title="GitHub" passkey />);
    expect(screen.getByRole('button', { name: /GitHub, has a passkey/ })).toBeInTheDocument();
  });
});

describe('in the chat', () => {
  it('asks for a credential with masked fields, and hands back only what was typed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = renderNacre(
      <VaultRequestCard
        state="waiting"
        title="GitHub"
        itemKind="login"
        site="github.com"
        reason="To open your pull requests"
        fields={[
          { label: 'Username', kind: 'text' },
          { label: 'Password', kind: 'secret' },
        ]}
        onSave={onSave}
      />,
    );
    expect(screen.getByText('Conch needs your sign-in for github.com')).toBeInTheDocument();
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await user.type(screen.getByLabelText('Username'), 'ada');
    await user.type(password, 's3cret!');
    await user.click(screen.getByRole('button', { name: 'Save to Passwords' }));
    expect(onSave).toHaveBeenCalledWith({ title: 'GitHub', values: ['ada', 's3cret!'] });
    await expectAccessible(container);
  });

  it('asks to read, saying a secret will be seen, and keeps “PIN” as it is', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    const { container } = renderNacre(
      <VaultApproval
        itemTitle="Visa"
        itemKind="card"
        fieldLabel="PIN"
        reason="Phone menu"
        sensitive
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Let Conch read the PIN of “Visa”?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(onDecide).toHaveBeenCalledWith('allow');
    await expectAccessible(container);
  });

  it('unlocks in place, and says so when the password is wrong', async () => {
    const user = userEvent.setup();
    const onUnlock = vi.fn().mockRejectedValue(new Error('That isn’t the password for Passwords.'));
    const { container } = renderNacre(<VaultUnlockCard state="waiting" onUnlock={onUnlock} />);
    await user.type(screen.getByLabelText('Password for Passwords'), 'nope nope');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t the password');
    await expectAccessible(container);
  });
});
