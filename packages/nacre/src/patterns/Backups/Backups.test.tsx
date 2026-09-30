import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { BackupContents } from './BackupContents';
import { BackupList } from './BackupList';
import { BackupOptions } from './BackupOptions';
import { BackupOverview } from './BackupOverview';
import { backups, daily, everything, light } from './fixtures';
import { describeBackup, formatBackupDate } from './format';
import { RestorePreview } from './RestorePreview';

describe('BackupOverview', () => {
  it('says where backups stand, and the switch turns them off from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderNacre(
      <BackupOverview automatic onAutomaticChange={onChange} detail="Last backup today at 3:12 AM">
        <button type="button">Back up now</button>
      </BackupOverview>,
    );
    const region = screen.getByRole('region', { name: 'Backed up automatically' });
    expect(region).toHaveTextContent('Last backup today at 3:12 AM');
    expect(within(region).getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Back up automatically every day' });
    expect(toggle).toBeChecked();
    toggle.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(false);
    await expectAccessible(container);
  });

  it('reads as off when off, and shows a problem calmly', async () => {
    const { container, rerender } = renderNacre(
      <BackupOverview automatic={false} onAutomaticChange={() => undefined} />,
    );
    expect(screen.getByRole('region', { name: 'Automatic backups are off' })).toHaveAttribute(
      'data-state',
      'off',
    );
    rerender(<BackupOverview automatic state="problem" detail="There isn’t enough free space." />);
    expect(screen.getByRole('region')).toHaveAttribute('data-state', 'problem');
    expect(screen.getByText('There isn’t enough free space.')).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('BackupList', () => {
  it('lists backups with Restore… and a download for automatic ones only', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const onDownload = vi.fn();
    const { container } = renderNacre(
      <BackupList backups={backups} onRestore={onRestore} onDownload={onDownload} />,
    );
    const list = screen.getByRole('list', { name: 'Backups on this computer' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(backups.length);
    expect(screen.getByText('Before a restore')).toBeInTheDocument();
    // The Undo copy never leaves this computer.
    expect(
      screen.queryByRole('button', { name: 'Download the backup from Yesterday at 2:02 PM' }),
    ).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Restore the backup from Today at 3:12 AM' }),
    );
    expect(onRestore).toHaveBeenCalledWith(backups[0]);
    await user.click(
      screen.getByRole('button', { name: 'Download the backup from Today at 3:12 AM' }),
    );
    expect(onDownload).toHaveBeenCalledWith(backups[0]);
    await expectAccessible(container);
  });

  it('says so when there are none yet', () => {
    renderNacre(<BackupList backups={[]} />);
    expect(screen.getByText(/first one is made soon/)).toBeInTheDocument();
  });
});

describe('BackupContents', () => {
  it('says what comes back in plain words', async () => {
    const { container } = renderNacre(<BackupContents contents={everything} />);
    const list = screen.getByRole('list', { name: 'What this backup brings back' });
    expect(list).toHaveTextContent('12 memories');
    expect(list).toHaveTextContent('3 routines');
    expect(list).toHaveTextContent('240 chats · with 18 files sent in them');
    expect(list).toHaveTextContent('Your keys and sign-ins · with your passphrase');
    // With the keys, nobody signs in again.
    expect(list).not.toHaveTextContent('sign in to them again');
    await expectAccessible(container);
  });

  it('says what stays as it is, and which integrations ask again', () => {
    renderNacre(<BackupContents contents={light} />);
    const list = screen.getByRole('list');
    expect(list).toHaveTextContent('Chats aren’t in it · yours stay as they are');
    expect(list).toHaveTextContent('Keys and sign-ins aren’t in it · yours stay as they are');
    expect(list).toHaveTextContent('5 integrations · you’ll sign in to 3 of them again');
  });

  it('counts one of each without an s', () => {
    renderNacre(
      <BackupContents
        contents={{ ...daily, memories: 1, routines: 1, integrations: 1, integrationsSigningIn: 1 }}
      />,
    );
    const list = screen.getByRole('list');
    expect(list).toHaveTextContent('1 memory');
    expect(list).toHaveTextContent('1 routine');
    expect(list).toHaveTextContent('1 integration · you’ll sign in to it again');
  });
});

describe('RestorePreview', () => {
  function Preview() {
    const [passphrase, setPassphrase] = useState('');
    const [skip, setSkip] = useState(false);
    return (
      <RestorePreview
        contents={everything}
        passphrase={passphrase}
        onPassphraseChange={setPassphrase}
        skipSecrets={skip}
        onSkipSecretsChange={setSkip}
      />
    );
  }

  it('asks for the passphrase, and goes on without it when it’s forgotten', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<Preview />);
    await user.type(screen.getByLabelText('Passphrase'), 'seven lemons');
    expect(screen.getByLabelText('Passphrase')).toHaveValue('seven lemons');
    expect(screen.getByText(/you can undo this/)).toBeInTheDocument();
    await expectAccessible(container);
    await user.click(screen.getByRole('button', { name: /Forgot it\?/ }));
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    expect(screen.getByRole('list')).toHaveTextContent('Keys and sign-ins left out');
    expect(screen.getByRole('list')).toHaveTextContent('you’ll sign in to them again');
    await user.click(screen.getByRole('button', { name: /passphrase after all/ }));
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });

  it('says when the passphrase is wrong, tied to the field', async () => {
    const { container } = renderNacre(
      <RestorePreview
        contents={everything}
        passphraseError="That passphrase doesn’t open this backup."
      />,
    );
    expect(screen.getByLabelText('Passphrase')).toHaveAccessibleDescription(
      /doesn’t open this backup/,
    );
    await expectAccessible(container);
  });

  it('asks for nothing when there are no locked keys', () => {
    renderNacre(<RestorePreview contents={daily} />);
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
  });
});

describe('BackupOptions', () => {
  function Options() {
    const [secrets, setSecrets] = useState(false);
    const [passphrase, setPassphrase] = useState('');
    const [confirm, setConfirm] = useState('');
    return (
      <BackupOptions
        chats
        chatsDetail="240 chats and the files sent in them · 48 MB"
        secrets={secrets}
        onSecretsChange={setSecrets}
        passphrase={passphrase}
        onPassphraseChange={setPassphrase}
        confirm={confirm}
        onConfirmChange={setConfirm}
        strength={{ score: 4, label: 'Strong', message: 'Strong password.' }}
      />
    );
  }

  it('asks for a passphrase twice when keys go in, with its strength', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<Options />);
    expect(screen.getByRole('switch', { name: 'Include chats' })).toBeChecked();
    expect(screen.getByText('240 chats and the files sent in them · 48 MB')).toBeInTheDocument();
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Include keys and sign-ins' }));
    await user.type(screen.getByLabelText('Passphrase'), 'seven lemons sail past');
    expect(screen.getByRole('meter', { name: 'Passphrase strength' })).toHaveAttribute(
      'aria-valuetext',
      'Strong',
    );
    await user.type(screen.getByLabelText('Passphrase again'), 'seven lemons sail');
    expect(screen.getByText('The two don’t match yet.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passphrase again'), ' past');
    expect(screen.queryByText('The two don’t match yet.')).toBeNull();
    expect(screen.getByText(/can’t recover a forgotten passphrase/)).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('format', () => {
  it('describes a backup in one short line', () => {
    expect(describeBackup(everything, 48 * 1024 * 1024)).toBe(
      '12 memories · 3 routines · 2 skills · 5 integrations · 240 chats · 48 MB',
    );
    expect(describeBackup({ ...light, memories: 0, routines: 0, skills: 0, integrations: 0 })).toBe(
      'Settings only',
    );
  });

  it('says when a backup was made the way a person would', () => {
    const at = new Date(2026, 8, 29, 14, 2).getTime();
    const now = new Date(2026, 8, 30, 9, 0).getTime();
    expect(formatBackupDate(at, { now, locale: 'en-GB' })).toBe('Tuesday 29 Sept, 14:02');
    expect(formatBackupDate(at, { now: new Date(2027, 0, 2).getTime(), locale: 'en-GB' })).toBe(
      'Tuesday, 29 Sept 2026, 14:02',
    );
  });
});
