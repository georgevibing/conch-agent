import type { Meta, StoryObj } from '@storybook/react-vite';
import { RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Heading, Text } from '../../components/Text';
import {
  AccessLevels,
  AccountAccessCard,
  type AccessLevel,
  type AccessService,
} from './AccountAccess';

const meta = {
  title: 'Patterns/Integrations/AccountAccess',
  component: AccountAccessCard,
  parameters: {
    docs: {
      description: {
        component:
          'One connected account and what the assistant may do with it, service by service: Off · Read · Read & write. Who it is and how it’s signed in at the top, its state in words; when it needs the person, one sentence and the one fix come right under it. A service the account can’t reach this way says why, with the button that changes that, instead of a control that would only pretend. `AccessLevels` is the same rows on their own, for choosing before an account exists.',
      },
    },
  },
  args: { email: '', method: '', state: 'ready', services: [] },
} satisfies Meta<typeof AccountAccessCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const GMAIL = {
  id: 'gmail',
  name: 'Gmail',
  brand: 'gmail',
  color: '#EA4335',
  describe: {
    off: 'Not used with this account.',
    read: 'Search and read your mail.',
    write: 'Also save drafts and send email. Shows you each email first.',
  },
} as const;
const CALENDAR = {
  id: 'calendar',
  name: 'Google Calendar',
  brand: 'google-calendar',
  color: '#4285F4',
  describe: {
    off: 'Not used with this account.',
    read: 'See your events.',
    write: 'Also add, move and delete events — it asks you every time.',
  },
} as const;
const DRIVE = {
  id: 'drive',
  name: 'Google Drive',
  brand: 'google-drive',
  color: '#0F9D58',
  describe: {
    off: 'Not used with this account.',
    read: 'Find files and read their details.',
    write: 'Also make new Docs — never changes your other files.',
  },
} as const;

function useLevels(initial: Record<string, AccessLevel>) {
  const [levels, setLevels] = useState(initial);
  return {
    levels,
    onChange: (id: string, level: AccessLevel) => setLevels((s) => ({ ...s, [id]: level })),
  };
}

const actions = (
  <>
    <Button size="sm" variant="ghost" leadingIcon={<RotateCw />}>
      Check now
    </Button>
    <Button size="sm" variant="ghost" tone="danger" leadingIcon={<Trash2 />}>
      Remove
    </Button>
  </>
);

/** A work account signed in with Google: Gmail can write, Calendar reads, Drive is off. */
export const Playground: Story = {
  render: () => {
    const { levels, onChange } = useLevels({ gmail: 'write', calendar: 'read', drive: 'off' });
    const services: AccessService[] = [GMAIL, CALENDAR, DRIVE].map((s) => ({
      ...s,
      level: levels[s.id] ?? 'off',
      ...(s.id === 'calendar' && levels.calendar !== 'write'
        ? { note: 'Read & write asks Google once.' }
        : {}),
    }));
    return (
      <div style={{ maxInlineSize: '40rem' }}>
        <AccountAccessCard
          email="ada@lovelace.dev"
          name="Ada Lovelace"
          method="Google sign-in"
          state="ready"
          services={services}
          onLevelChange={onChange}
          actions={actions}
        />
      </div>
    );
  },
};

/** An app password reaches Gmail only: Calendar and Drive say so, with the button that fixes it. */
export const AppPassword: Story = {
  render: () => {
    const { levels, onChange } = useLevels({ gmail: 'read' });
    return (
      <div style={{ maxInlineSize: '40rem' }}>
        <AccountAccessCard
          email="ada@gmail.com"
          method="App password"
          state="ready"
          onLevelChange={onChange}
          actions={actions}
          services={[
            { ...GMAIL, level: levels.gmail ?? 'off' },
            ...[CALENDAR, DRIVE].map((s) => ({
              ...s,
              level: 'off' as const,
              unavailable: {
                reason: 'Needs Google sign-in: an app password only reaches Gmail.',
                action: { label: 'Use Google sign-in', onClick: () => undefined },
              },
            })),
          ]}
        />
      </div>
    );
  },
};

/** Google stopped taking the sign-in: one sentence, and the one fix under it. */
export const NeedsYou: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <AccountAccessCard
        email="ada@lovelace.dev"
        method="Google sign-in"
        state="needs-auth"
        message="Google access expired or was revoked."
        fix={
          <Button size="sm" style={{ alignSelf: 'flex-start' }}>
            Sign in again
          </Button>
        }
        services={[
          { ...GMAIL, level: 'write' },
          { ...CALENDAR, level: 'read' },
        ]}
        actions={actions}
      />
    </div>
  ),
};

/** Saving a change: the row waits with a spinner. */
export const Saving: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <AccountAccessCard
        email="ada@lovelace.dev"
        method="Google sign-in"
        state="checking"
        services={[
          { ...GMAIL, level: 'read', busy: true },
          { ...CALENDAR, level: 'read' },
        ]}
      />
    </div>
  ),
};

/** Before an account exists: what it should be able to do, chosen first. */
export const ChooseFirst: Story = {
  render: () => {
    const { levels, onChange } = useLevels({ gmail: 'write', calendar: 'read', drive: 'off' });
    return (
      <Stack gap={3} style={{ maxInlineSize: '36rem' }}>
        <Heading level={3} size="sm">
          What should it help with?
        </Heading>
        <Text size="sm" tone="muted">
          You can change this any time.
        </Text>
        <AccessLevels
          label="What it may do with the new account"
          onChange={onChange}
          services={[GMAIL, CALENDAR, DRIVE].map((s) => ({ ...s, level: levels[s.id] ?? 'off' }))}
        />
      </Stack>
    );
  },
};

/** Several accounts, one list. */
export const Many: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: '40rem' }}>
      <AccountAccessCard
        email="ada@lovelace.dev"
        method="Google sign-in"
        state="ready"
        services={[
          { ...GMAIL, level: 'write' },
          { ...CALENDAR, level: 'write' },
          { ...DRIVE, level: 'read' },
        ]}
      />
      <AccountAccessCard
        email="ada.l@gmail.com"
        method="App password"
        state="unavailable"
        message="Gmail could not be reached. Conch keeps trying by itself."
        services={[{ ...GMAIL, level: 'read' }]}
      />
    </Stack>
  ),
};
