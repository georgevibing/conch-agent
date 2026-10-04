import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { PasskeyButton } from './PasskeyButton';
import { PasskeyList, type PasskeyItem } from './PasskeyList';
import { passkeyLabel, passkeyPlatform } from './passkeyPlatform';

const UA = {
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iPadOld:
    'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
};

describe('passkeyPlatform', () => {
  it('names what each device has', () => {
    expect(passkeyPlatform(UA.macSafari, true, true)).toBe('mac');
    expect(passkeyPlatform(UA.macChrome, true, true)).toBe('mac');
    expect(passkeyPlatform(UA.windowsEdge, true, true)).toBe('windows');
    expect(passkeyPlatform(UA.windowsChrome, true, true)).toBe('windows');
    expect(passkeyPlatform(UA.iPhone, true, true)).toBe('ios');
    expect(passkeyPlatform(UA.iPadOld, true, true)).toBe('ios');
    expect(passkeyPlatform(UA.androidChrome, true, true)).toBe('android');
  });

  it('sees through iPadOS dressing up as a Mac', () => {
    expect(passkeyPlatform(UA.macSafari, true, true, 5)).toBe('ios');
    expect(passkeyPlatform(UA.macSafari, true, true, 0)).toBe('mac');
  });

  it('offers a phone where nothing is built in', () => {
    expect(passkeyPlatform(UA.linuxFirefox, false, true)).toBe('phone');
    // A Mac without Touch ID in Chrome says no built-in authenticator.
    expect(passkeyPlatform(UA.macChrome, false, true)).toBe('phone');
    expect(passkeyPlatform(UA.windowsChrome, false, true)).toBe('phone');
  });

  it('offers nothing where passkeys can’t work', () => {
    expect(passkeyPlatform(UA.macSafari, true, false)).toBeUndefined();
    expect(passkeyPlatform(UA.linuxFirefox, false, false)).toBeUndefined();
  });

  it('puts the words together', () => {
    expect(passkeyLabel('mac', 'create')).toBe('Use Touch ID');
    expect(passkeyLabel('windows', 'sign-in')).toBe('Sign in with Windows Hello');
    expect(passkeyLabel('ios', 'confirm')).toBe('Confirm with Face ID');
    expect(passkeyLabel('android', 'create')).toBe('Use your fingerprint');
    expect(passkeyLabel('phone', 'create')).toBe('Use your phone');
  });
});

describe('PasskeyButton', () => {
  it('is named for the platform and pressable', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = renderNacre(<PasskeyButton platform="windows" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Use Windows Hello' });
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('takes other words but keeps its icon', () => {
    renderNacre(<PasskeyButton platform="mac">Add Touch ID</PasskeyButton>);
    const button = screen.getByRole('button', { name: 'Add Touch ID' });
    expect(button).toHaveAttribute('data-platform', 'mac');
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('holds its place while the browser asks', () => {
    renderNacre(<PasskeyButton platform="ios" action="sign-in" loading />);
    expect(screen.getByRole('button', { name: 'Sign in with Face ID' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });
});

const icloud: PasskeyItem = {
  id: 'pk_1',
  name: 'iCloud Keychain',
  site: 'conch.example.com',
  meta: 'Added 3 Oct',
  here: true,
};

const passkeys: PasskeyItem[] = [
  icloud,
  {
    id: 'pk_2',
    name: 'Google Password Manager',
    site: 'mac.tail1234.ts.net',
    meta: 'Added 28 Sept',
    here: false,
  },
];

describe('PasskeyList', () => {
  it('lists passkeys, marks the ones for another address, and adds another', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { container } = renderNacre(
      <PasskeyList passkeys={passkeys} platform="mac" onAdd={onAdd} onRemove={() => undefined} />,
    );
    const list = screen.getByRole('list', { name: 'Passkeys' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('conch.example.com · Added 3 Oct')).toBeInTheDocument();
    expect(screen.getByText('For mac.tail1234.ts.net')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Touch ID' }));
    expect(onAdd).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('renames with Enter, and Escape leaves it as it was', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    renderNacre(<PasskeyList passkeys={passkeys.slice(0, 1)} onRename={onRename} />);
    await user.click(screen.getByRole('button', { name: 'Rename iCloud Keychain' }));
    const input = screen.getByRole('textbox', { name: 'New name for iCloud Keychain' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'My MacBook{Enter}');
    expect(onRename).toHaveBeenCalledWith(passkeys[0], 'My MacBook');

    await user.click(screen.getByRole('button', { name: 'Rename iCloud Keychain' }));
    await user.type(screen.getByRole('textbox'), ' nope{Escape}');
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('won’t remove the only way in, and says why', async () => {
    const onRemove = vi.fn();
    const { container } = renderNacre(
      <PasskeyList
        passkeys={[{ ...icloud, keep: 'Your only way in. Add a password first.' }]}
        onRemove={onRemove}
      />,
    );
    const remove = screen.getByRole('button', { name: 'Remove iCloud Keychain' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAccessibleDescription('Your only way in. Add a password first.');
    await expectAccessible(container);
  });

  it('removes one that isn’t the last', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderNacre(<PasskeyList passkeys={passkeys} onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Remove Google Password Manager' }));
    expect(onRemove).toHaveBeenCalledWith(passkeys[1]);
  });

  it('sells it in one line when there are none', () => {
    renderNacre(<PasskeyList passkeys={[]} platform="phone" onAdd={() => undefined} />);
    expect(screen.getByText(/Sign in with a touch instead of typing/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add a passkey from your phone' }),
    ).toBeInTheDocument();
  });
});
