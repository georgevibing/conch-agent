import type { Meta, StoryObj } from '@storybook/react-vite';
import { FilePen, KeyRound, MessageCircle, Search, Send, SquareTerminal } from 'lucide-react';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { Heading, Text } from '../../components/Text';
import { AppAbilities, type AppAbility } from './AppAbilities';
import { IntegrationLogo } from './IntegrationLogo';

const meta = {
  title: 'Patterns/Integrations/AppAbilities',
  component: AppAbilities,
  parameters: {
    docs: {
      description: {
        component:
          'What one app does, as plain switches — one app, one card (ADR 0052). An app that can both be used by the assistant and talk to you (Slack, Gmail) has one page with a row for each: “Read & search”, “Send (asks first)”, “Talk to me here”. A half that isn’t set up yet shows the one button that sets it up instead of a switch, so nothing ever looks on when it isn’t. Notes say who it acts as, and what it can’t do, in a person’s words.',
      },
    },
  },
  args: { label: 'What it does', abilities: [] },
} satisfies Meta<typeof AppAbilities>;

export default meta;
type Story = StoryObj<typeof meta>;

function useAbilities(initial: AppAbility[]) {
  const [on, setOn] = useState(() => Object.fromEntries(initial.map((a) => [a.id, a.on])));
  return initial.map((a) => ({
    ...a,
    on: on[a.id] ?? false,
    onChange: (next: boolean) => setOn((s) => ({ ...s, [a.id]: next })),
  }));
}

function Page({
  brand,
  name,
  color,
  abilities,
}: {
  brand: string;
  name: string;
  color: string;
  abilities: AppAbility[];
}) {
  const rows = useAbilities(abilities);
  return (
    <Stack gap={4} style={{ maxInlineSize: '40rem' }}>
      <Stack direction="row" gap={3} align="center">
        <IntegrationLogo brand={brand} name={name} color={color} size="lg" decorative />
        <Heading level={2} size="lg">
          {name}
        </Heading>
      </Stack>
      <AppAbilities label={`What ${name} does`} abilities={rows} />
    </Stack>
  );
}

/** Slack, set up as an app; talking to you there takes two more keys from the same Slack app. */
export const Slack: Story = {
  render: () => (
    <Page
      brand="slack"
      name="Slack"
      color="#4A154B"
      abilities={[
        {
          id: 'read',
          title: 'Read & search',
          description: 'See your channels, catch up on them and search your messages.',
          icon: <Search />,
          on: true,
          note: 'As ada, in Acme.',
        },
        {
          id: 'send',
          title: 'Send (asks first)',
          description: 'Post a message as you. You see the exact words and say yes each time.',
          icon: <Send />,
          on: true,
        },
        {
          id: 'talk',
          title: 'Talk to me here',
          description: 'Message Ada’s Conch privately in Slack, from your phone or any computer.',
          icon: <MessageCircle />,
          on: false,
          setup: { label: 'Set up', onClick: () => undefined },
          note: 'Uses the same Slack app. It needs two more keys from it: about two minutes.',
        },
      ]}
    />
  ),
};

/** Gmail with both halves on: the email channel shares Gmail's app password, asked for once. */
export const Gmail: Story = {
  render: () => (
    <Page
      brand="gmail"
      name="Gmail"
      color="#EA4335"
      abilities={[
        {
          id: 'read',
          title: 'Read & search',
          description: 'Find emails with Gmail’s own search, and read them.',
          icon: <Search />,
          on: true,
        },
        {
          id: 'draft',
          title: 'Draft',
          description: 'Save a new email or a reply in your Drafts, for you to send.',
          icon: <FilePen />,
          on: true,
          note: 'Asks every time. Never sends.',
        },
        {
          id: 'talk',
          title: 'Talk to me here',
          description: 'Write to ada+conch@gmail.com from any mail app, and the answer comes back.',
          icon: <MessageCircle />,
          on: true,
          action: { label: 'Who can write to it', onClick: () => undefined },
        },
      ]}
    />
  ),
};

/** 1Password: two different features of one app, each with its own switch. */
export const OnePassword: Story = {
  name: '1Password',
  render: () => (
    <Page
      brand="1password"
      name="1Password"
      color="#145FE4"
      abilities={[
        {
          id: 'fill',
          title: 'Fill sign-ins from 1Password',
          description: 'Your 1Password logins show in Passwords, ready to fill when you say OK.',
          icon: <KeyRound />,
          on: true,
          note: 'Locked. Unlock 1Password to use it.',
          attention: true,
        },
        {
          id: 'environments',
          title: 'Manage Environments',
          description: 'For developers: the names of your Environments and their variables.',
          icon: <SquareTerminal />,
          on: false,
          setup: { label: 'Set up', onClick: () => undefined },
        },
      ]}
    />
  ),
};

/** Changing, and off while the whole app is off. */
export const States: Story = {
  render: () => (
    <Stack gap={5} style={{ maxInlineSize: '40rem' }}>
      <Text size="sm" tone="muted">
        Busy, then with the app turned off.
      </Text>
      <AppAbilities
        label="Busy"
        abilities={[
          { id: 'a', title: 'Talk to me here', on: true, busy: true, icon: <MessageCircle /> },
          {
            id: 'b',
            title: 'Set up, loading',
            on: false,
            setup: { label: 'Turn on', onClick: () => undefined, loading: true },
          },
        ]}
      />
      <AppAbilities
        label="App off"
        abilities={[
          { id: 'a', title: 'Read & search', on: true, disabled: true, icon: <Search /> },
          { id: 'b', title: 'Send (asks first)', on: false, disabled: true, icon: <Send /> },
        ]}
      />
    </Stack>
  ),
};
