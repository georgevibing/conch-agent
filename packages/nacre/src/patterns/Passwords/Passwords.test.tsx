import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  PasswordGenerator,
  TotpCode,
  VaultApproval,
  VaultConnectedSources,
  VaultFieldRow,
  VaultFieldsSkeleton,
  VaultHealth,
  VaultItemHeader,
  VaultItemIcon,
  VaultListHeading,
  VaultRequestCard,
  VaultPasskeyRow,
  VaultRow,
  VaultRowSkeleton,
  VaultSelectionBar,
  VaultSignInRow,
  VaultSourceFilter,
  VaultSourceRow,
  VaultSourceStrip,
  vaultSignInWords,
  siteName,
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

  it('marks the part of the title that matched a search, and still reads as the whole title', () => {
    const { container } = renderNacre(
      <VaultRow kind="login" title="Amazon Prime" subtitle="ada" titleRanges={[[0, 3]]} />,
    );
    expect(container.querySelector('mark')).toHaveTextContent('Ama');
    expect(screen.getByRole('button', { name: 'Amazon Prime, ada' })).toBeInTheDocument();
  });

  it('can leave out its manager’s mark when every row would wear the same one', () => {
    const { container, rerender } = renderNacre(
      <VaultRow kind="login" title="Bank" source="1password" />,
    );
    expect(container.querySelector('[title="1Password"]')).not.toBeNull();
    rerender(<VaultRow kind="login" title="Bank" source="1password" sourceMark={false} />);
    expect(container.querySelector('[title="1Password"]')).toBeNull();
    // Where it's from is still in its name.
    expect(screen.getByRole('button', { name: 'Bank, from 1Password' })).toBeInTheDocument();
  });
});

describe('while Passwords loads', () => {
  it('holds the place of rows and fields, out of the way of a screen reader', async () => {
    const { container } = renderNacre(
      <div aria-busy="true">
        <VaultRowSkeleton />
        <VaultRowSkeleton />
        <VaultFieldsSkeleton rows={3} />
      </div>,
    );
    expect(container.querySelectorAll('[data-vault-skeleton="row"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-vault-skeleton="field"]')).toHaveLength(3);
    for (const part of container.querySelectorAll('[data-vault-skeleton]'))
      expect(part.closest('[aria-hidden="true"]')).not.toBeNull();
    await expectAccessible(container);
  });
});

describe('VaultListHeading', () => {
  it('names a group for the eye only: the rows already say it', () => {
    renderNacre(<VaultListHeading>Favourites</VaultListHeading>);
    expect(screen.getByText('Favourites')).toHaveAttribute('aria-hidden', 'true');
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

  it('puts what to do on its own line, apart from the state and the button', async () => {
    const hint =
      'Turn on Settings › Developer › Integrate with 1Password CLI in the 1Password app.';
    const { container } = renderNacre(
      <VaultSourceRow
        source="1password"
        state="locked"
        message={hint}
        action={<button type="button">Turn off</button>}
      />,
    );
    // The state's word stands alone, whole; the hint is a line of its own.
    expect(screen.getByText('Locked').textContent).toBe('Locked');
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.getByText(hint).closest('[class*="sourceState"]')).toBeNull();
    await expectAccessible(container);
  });

  it('says how Conch reaches it, beside the count', async () => {
    const { container } = renderNacre(
      <VaultSourceRow
        source="1password"
        state="ready"
        count={12}
        via="Service account · 2 vaults"
      />,
    );
    expect(screen.getByText('12 items')).toBeInTheDocument();
    expect(screen.getByText('· Service account · 2 vaults')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows no hint when it is connected', () => {
    renderNacre(<VaultSourceRow source="bitwarden" state="ready" count={2} message="Old news" />);
    expect(screen.getByText('2 items')).toBeInTheDocument();
    expect(screen.queryByText('Old news')).toBeNull();
  });
});

describe('connected managers and dates', () => {
  it('lists the managers that are on, with their state in words, each opening its settings', async () => {
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <VaultConnectedSources
        sources={[
          { source: 'keepassxc', state: 'ready', count: 4 },
          { source: 'bitwarden', state: 'locked' },
        ]}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bitwarden: Locked' }));
    expect(onOpen).toHaveBeenCalledWith('bitwarden');
    expect(screen.getByRole('button', { name: 'KeePassXC: 4 items' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows the date a list is sorted by beside the account', () => {
    renderNacre(<VaultRow kind="login" title="Forum" subtitle="ada" meta="Used 5 min ago" />);
    expect(screen.getByText(/· Used 5 min ago/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Forum, ada, used 5 min ago/ })).toBeInTheDocument();
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

  it('asks to use a key in a command, naming the variable and the command, unseen', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    const { container } = renderNacre(
      <VaultApproval
        itemTitle="GitHub token"
        itemKind="apiKey"
        fieldLabel="Key"
        reason="Clone the private repository"
        sensitive
        use={{ envName: 'GH_TOKEN', command: 'git clone https://github.com/ada/private' }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Let this command use the key of “GitHub token”?')).toBeInTheDocument();
    expect(screen.getByText('git clone https://github.com/ada/private')).toBeInTheDocument();
    expect(screen.getByText(/as GH_TOKEN\. Conch doesn’t see it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow in this chat' }));
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

describe('where items live, and choosing several', () => {
  it('names a site by whose it is, not by its first label', () => {
    expect(siteName('app.yazio.com')).toBe('yazio');
    expect(siteName('www.bbc.co.uk')).toBe('bbc');
    expect(siteName('accounts.google.com')).toBe('google');
    expect(siteName('github.com')).toBe('github');
    expect(siteName('192.168.1.1')).toBe('192.168.1.1');
    expect(siteName('localhost')).toBe('localhost');
  });

  it('says where an item lives in its name, with its vault, and Conch’s own when asked', async () => {
    const { container } = renderNacre(
      <div role="list">
        <div role="listitem">
          <VaultRow
            kind="login"
            title="Mail"
            subtitle="ada"
            source="1password"
            container="Private"
          />
        </div>
        <div role="listitem">
          <VaultRow kind="login" title="Bank" subtitle="ada" source="conch" sourceMark />
        </div>
      </div>,
    );
    expect(
      screen.getByRole('button', { name: 'Mail, ada, from 1Password, Private' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bank, ada, in Conch' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('turns a row into a toggle while choosing several', async () => {
    const onClick = vi.fn();
    renderNacre(<VaultRow kind="note" title="Safe" selecting checked onClick={onClick} />);
    const row = screen.getByRole('button', { name: 'Safe' });
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(row).not.toHaveAttribute('aria-current');
    await userEvent.click(row);
    expect(onClick).toHaveBeenCalled();
  });

  it('chooses one place with a press or the arrow keys, and says how many are there', async () => {
    const onValueChange = vi.fn();
    const { container } = renderNacre(
      <VaultSourceFilter
        value="all"
        onValueChange={onValueChange}
        total={4}
        sources={[
          { source: 'conch', count: 3 },
          { source: '1password', count: 1 },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: '1Password, 1 item' }));
    expect(onValueChange).toHaveBeenLastCalledWith('1password');
    expect(screen.getByRole('radio', { name: 'All, 4 items' })).toBeChecked();
    await expectAccessible(container);
  });

  it('says how many are chosen, offers Select all until they all are, and Done', async () => {
    const onSelectAll = vi.fn();
    const onDone = vi.fn();
    const { container, rerender } = renderNacre(
      <VaultSelectionBar count={2} total={5} onSelectAll={onSelectAll} onDone={onDone} />,
    );
    expect(screen.getByRole('group', { name: 'Chosen items' })).toHaveTextContent('2 chosen');
    await userEvent.click(screen.getByRole('button', { name: 'Select all 5' }));
    expect(onSelectAll).toHaveBeenCalled();
    rerender(<VaultSelectionBar count={5} total={5} onSelectAll={onSelectAll} onDone={onDone} />);
    expect(screen.queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('how an item signs in', () => {
  it('says “Signs in with Google” with the account, and offers the Google login', async () => {
    const onOpen = vi.fn();
    const onCopy = vi.fn();
    const { container } = renderNacre(
      <VaultSignInRow
        signIn={{ via: 'provider', provider: 'google', name: 'Google', account: 'james@claw.dev' }}
        onCopyAccount={onCopy}
        action={
          <button type="button" onClick={onOpen}>
            Open
          </button>
        }
      />,
    );
    const row = screen.getByRole('group', { name: 'Signs in with Google' });
    expect(row).toHaveTextContent('james@claw.dev');
    // The provider's own mark, bundled: never a picture from the web.
    expect(row.querySelector('svg path')).not.toBeNull();
    expect(row.querySelector('img')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Copy account' }));
    expect(onCopy).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('says where a passkey Conch can’t use is kept, and a quiet hint otherwise', async () => {
    const { container } = renderNacre(
      <div>
        <VaultSignInRow signIn={{ via: 'passkey', usable: false }} keptIn="1Password" />
        <VaultSignInRow
          signIn={{ via: 'provider', provider: 'apple', name: 'Apple' }}
          hint="No Apple login saved"
        />
        <VaultSignInRow signIn={{ via: 'sso', name: 'Okta' }} />
        <VaultSignInRow signIn={{ via: 'link' }} />
      </div>,
    );
    expect(screen.getByRole('group', { name: 'Signs in with a passkey' })).toHaveTextContent(
      'Only in 1Password, out of Conch’s reach',
    );
    expect(screen.getByRole('group', { name: 'Signs in with Apple' })).toHaveTextContent(
      'No Apple login saved',
    );
    expect(screen.getByRole('group', { name: 'Signs in with Okta' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Signs in with an emailed link or code' }),
    ).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('names it on a list row, with a small mark at its end', async () => {
    const { container } = renderNacre(
      <VaultRow
        kind="login"
        title="Product Hunt"
        subtitle="james@claw.dev"
        domain="producthunt.com"
        signIn={{ via: 'provider', provider: 'google', name: 'Google' }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Product Hunt, james@claw.dev, signs in with Google' }),
    ).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('words every method', () => {
    expect(vaultSignInWords({ via: 'provider', name: 'GitHub' })).toBe('Signs in with GitHub');
    expect(vaultSignInWords({ via: 'provider' })).toBe('Signs in with another account');
    expect(vaultSignInWords({ via: 'sso' })).toBe('Signs in with single sign-on');
    expect(vaultSignInWords({ via: 'passkey', name: 'x' })).toBe('Signs in with a passkey');
  });
});

describe('an item’s page', () => {
  it('heads it with its name and one line of facts, its buttons beside', async () => {
    const { container } = renderNacre(
      <VaultItemHeader
        icon={<VaultItemIcon kind="login" title="GitHub" domain="github.com" size="lg" />}
        title="GitHub"
        meta={['Login', '', 'Edited 3 days ago', undefined]}
        actions={<button type="button">Edit</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'GitHub' })).toBeInTheDocument();
    expect(container).toHaveTextContent(/Login\s·\sEdited 3 days ago/);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says where it lives in one line, with its one button', async () => {
    const onCopy = vi.fn();
    const { container } = renderNacre(
      <VaultSourceStrip
        source="1password"
        label="Stored in 1Password"
        detail="James Claw"
        action={
          <button type="button" onClick={onCopy}>
            Copy into Conch
          </button>
        }
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(/Stored in 1Password\s·\sJames Claw/);
    await userEvent.click(screen.getByRole('button', { name: 'Copy into Conch' }));
    expect(onCopy).toHaveBeenCalled();
    await expectAccessible(container);
  });
});
