import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { PasskeyButton } from './PasskeyButton';
import { PasskeyList, type PasskeyItem } from './PasskeyList';
import type { PasskeyAction, PasskeyPlatform } from './passkeyPlatform';

const meta = {
  title: 'Patterns/Security/Passkeys',
  component: PasskeyButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Passkeys, named for what the device has (ADR 0065): “Use Touch ID” on a Mac, “Use Windows Hello” on a PC, “Use Face ID” on an iPhone, “Use your fingerprint” on Android, and “Use your phone” where there’s nothing built in. Nobody needs to know the word “passkey” to use one. `passkeyPlatform()` picks the platform from the browser; when it returns nothing, passkeys aren’t offered at all.',
      },
    },
  },
  args: { platform: 'mac', action: 'create' },
  argTypes: {
    platform: { control: 'inline-radio', options: ['mac', 'windows', 'ios', 'android', 'phone'] },
    action: { control: 'inline-radio', options: ['create', 'sign-in', 'confirm'] },
  },
} satisfies Meta<typeof PasskeyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const platforms: PasskeyPlatform[] = ['mac', 'windows', 'ios', 'android', 'phone'];
const actions: PasskeyAction[] = ['create', 'sign-in', 'confirm'];

/** Every platform, for each thing a passkey does. */
export const EveryPlatform: Story = {
  render: () => (
    <Stack gap={4}>
      {actions.map((action) => (
        <div key={action} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {platforms.map((platform) => (
            <PasskeyButton
              key={platform}
              platform={platform}
              action={action}
              size="md"
              variant={action === 'create' ? 'solid' : 'surface'}
            />
          ))}
        </div>
      ))}
    </Stack>
  ),
};

export const Loading: Story = { args: { loading: true } };

const icloud: PasskeyItem = {
  id: 'pk_1',
  name: 'iCloud Keychain',
  site: 'conch.example.com',
  meta: 'Added 3 Oct · used 2 minutes ago',
  here: true,
};

const passkeys: PasskeyItem[] = [
  {
    id: 'pk_1',
    name: 'iCloud Keychain',
    site: 'conch.example.com',
    meta: 'Added 3 Oct · used 2 minutes ago',
    here: true,
  },
  {
    id: 'pk_2',
    name: 'Windows Hello',
    site: 'conch.example.com',
    meta: 'Added 3 Oct · never used',
    here: true,
  },
  {
    id: 'pk_3',
    name: 'Google Password Manager',
    site: 'macbook.tail1234.ts.net',
    meta: 'Added 28 Sept · used last week',
    here: false,
  },
];

function Interactive({ initial }: { initial: PasskeyItem[] }) {
  const [list, setList] = useState(initial);
  const [adding, setAdding] = useState(false);
  const only = list.filter((p) => p.here !== false).length === 1;
  return (
    <div style={{ maxInlineSize: 560 }}>
      <PasskeyList
        passkeys={list.map((p) =>
          only && p.here !== false
            ? { ...p, keep: 'Your only way in here. Add a password or another passkey first.' }
            : p,
        )}
        platform="mac"
        adding={adding}
        onAdd={() => {
          setAdding(true);
          setTimeout(() => {
            setAdding(false);
            setList((l) => [
              ...l,
              {
                id: `pk_${l.length + 10}`,
                name: 'iCloud Keychain',
                site: 'conch.example.com',
                meta: 'Added just now',
                here: true,
              },
            ]);
          }, 1200);
        }}
        onRename={(p, name) => setList((l) => l.map((x) => (x.id === p.id ? { ...x, name } : x)))}
        onRemove={(p) => setList((l) => l.filter((x) => x.id !== p.id))}
      />
    </div>
  );
}

/** Settings → Security → Passkeys: rename, remove, add another. */
export const List: Story = { render: () => <Interactive initial={passkeys} /> };

/** None yet: one line that says why, and the button. */
export const ListEmpty: Story = { render: () => <Interactive initial={[]} /> };

/** The only way in can’t be removed, and says so beside it. */
export const ListLastWayIn: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <PasskeyList
        passkeys={[
          {
            ...icloud,
            keep: 'Your only way in here. Add a password or another passkey first.',
          },
        ]}
        platform="windows"
        onAdd={() => undefined}
        onRename={() => undefined}
        onRemove={() => undefined}
      />
    </div>
  ),
};

/** A computer with nothing built in adds one from a phone. */
export const ListFromPhone: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <PasskeyList passkeys={passkeys.slice(0, 1)} platform="phone" onAdd={() => undefined} />
    </div>
  ),
};
