import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { Text } from '../../components/Text';
import { CloudAccountPicker, type CloudAccountItem } from './CloudAccountPicker';

const AWS: CloudAccountItem[] = [
  {
    id: 'dev',
    label: 'dev',
    detail: 'Single sign-on · BedrockDeveloper · account …3333',
    state: 'ready',
  },
  {
    id: 'prod-readonly',
    label: 'prod-readonly',
    detail: 'Single sign-on · ReadOnly · account …9012',
    state: 'expired',
  },
  {
    id: 'default',
    label: 'default',
    detail: 'Access keys on this computer',
    state: 'ready',
    isDefault: true,
  },
  {
    id: 'admin',
    label: 'admin',
    detail: 'Single sign-on · AdministratorAccess · account …3333',
    state: 'ready',
    broad: true,
  },
];

const MODELS = ['Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Opus 4.8', 'Claude Haiku 4.5'];

const meta = {
  title: 'Patterns/Providers/CloudAccountPicker',
  component: CloudAccountPicker,
  parameters: {
    docs: {
      description: {
        component:
          'The cloud sign-ins already on this computer, as a pick list (ADR 0109). One press uses an account; a sign-in that ended signs in again right there. The first signed-in account that isn’t an administrator is recommended. Choosing one lights the row while Conch asks the cloud, then the models it can use arrive one after another.',
      },
    },
  },
  args: {
    label: 'AWS accounts on this computer',
    accounts: AWS,
    onChoose: () => undefined,
    onSignIn: () => undefined,
    signInLabel: 'Sign in to AWS again',
  },
} satisfies Meta<typeof CloudAccountPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Nothing chosen yet: the recommended account leads. */
export const Found: Story = {};

/** Asking the cloud which models this account can use. */
export const Checking: Story = { args: { chosen: 'dev', pending: 'dev' } };

/** The account answered: its models, as it gives them. */
export const Ready: Story = {
  args: { chosen: 'dev', ready: 'eu-west-1 · 4 models', models: MODELS },
};

/** The chosen sign-in ended: one press signs in again. */
export const SignInEnded: Story = {
  args: {
    chosen: 'prod-readonly',
    problem: 'Your AWS sign-in for “prod-readonly” has ended. Sign in to AWS again.',
  },
};

export const Signingin: Story = {
  name: 'Signing in',
  args: {
    chosen: 'prod-readonly',
    signingIn: 'prod-readonly',
    problem: 'Finish signing in on the page that opened.',
  },
};

/** Google Cloud: projects, all under one sign-in. */
export const Projects: Story = {
  args: {
    label: 'Google Cloud projects',
    signInLabel: 'Sign in to Google Cloud',
    accounts: [
      {
        id: 'acme-ml',
        label: 'Acme ML',
        detail: 'Google Cloud project · acme-ml',
        state: 'ready',
        isDefault: true,
      },
      { id: 'acme-billing', label: 'acme-billing', detail: 'Google Cloud project', state: 'ready' },
    ],
  },
};

export const Empty: Story = {
  args: {
    accounts: [],
    empty:
      'There’s no AWS sign-in on this computer yet. Install the AWS CLI to sign in, or add a Bedrock API key.',
  },
};

/** Press one: it checks, then shows what it found. */
export const PressOne: Story = {
  render: (args) => {
    const [chosen, setChosen] = useState<string>();
    const [pending, setPending] = useState<string>();
    return (
      <Stack gap={3} style={{ maxInlineSize: '40rem' }}>
        <Text tone="muted" size="sm">
          Press “Use this” on any account.
        </Text>
        <CloudAccountPicker
          {...args}
          chosen={chosen}
          pending={pending}
          ready={chosen && !pending ? 'eu-west-1 · 4 models' : undefined}
          models={chosen && !pending ? MODELS : []}
          onChoose={(id) => {
            setChosen(id);
            setPending(id);
            setTimeout(() => setPending(undefined), 1400);
          }}
        />
      </Stack>
    );
  },
};
