import type { Meta, StoryObj } from '@storybook/react-vite';

import { AddressStatus } from './AddressStatus';

const meta = {
  title: 'Patterns/Security/AddressStatus',
  component: AddressStatus,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Settings → Security → Your address (ADR 0064). A healthy address is one quiet line: the URL to copy, “Secure · renews by itself” and when the certificate runs out. Getting a certificate wears the orbiting rim, as anything alive does. A problem is one sentence with the one thing that fixes it: a button when Conch can, a line to copy when only a person can.',
      },
    },
  },
  args: {
    state: 'ready',
    address: 'conch.example.com',
    until: '2 January 2027',
    onTurnOff: () => undefined,
  },
  argTypes: {
    state: { control: 'inline-radio', options: ['off', 'ready', 'getting', 'problem'] },
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 560 }}>{Story()}</div>],
} satisfies Meta<typeof AddressStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Ready: Story = {};

export const Getting: Story = { args: { state: 'getting' } };

/** Conch can fix it: one button. */
export const ProblemWithFix: Story = {
  args: {
    state: 'problem',
    problem: {
      message:
        'The certificate runs out in 5 days and renewing didn’t work yet: Let’s Encrypt couldn’t reach this server on port 80.',
      action: { label: 'Try renewing now', onClick: () => undefined },
    },
  },
};

/** Only a person can fix it: one line to copy. */
export const ProblemWithCommand: Story = {
  args: {
    state: 'problem',
    problem: {
      message:
        'Conch can’t answer on ports 80 and 443 since Node was updated. Run this once on the server:',
      command: 'sudo setcap cap_net_bind_service=+ep ~/.conch/runtime/node/bin/node',
    },
  },
};

/** Not set up: what it is, in a line, and the way to start. */
export const Off: Story = { args: { state: 'off', address: undefined, onSetUp: () => undefined } };
