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
          'Settings → Security → Your address (ADR 0064). A healthy address is one quiet line: the URL to copy, “Secure · renews by itself” and when the certificate runs out (or, through a tunnel of your own, who keeps it secure). Getting a certificate wears the orbiting rim, as anything alive does. A problem is one sentence with the one thing that fixes it: a button when Conch can, a line to copy when only a person can.',
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
    via: { control: 'inline-radio', options: ['conch', 'proxy'] },
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 560 }}>{Story()}</div>],
} satisfies Meta<typeof AddressStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Ready: Story = {};

export const Getting: Story = { args: { state: 'getting' } };

/** Through a tunnel or web server the person runs (Cloudflare Tunnel, nginx, Caddy): no certificate of Conch's. */
export const ThroughATunnel: Story = { args: { via: 'proxy', until: undefined } };

/** Through a tunnel that asks for its own sign-in first (Cloudflare Access, say). */
export const BehindItsOwnSignIn: Story = {
  args: { via: 'proxy', guarded: true, until: undefined },
};

/** The tunnel answers, but it can't reach Conch: where to point it. */
export const TunnelNotPointedHere: Story = {
  args: {
    state: 'problem',
    via: 'proxy',
    until: undefined,
    problem: {
      message:
        'conch.example.com reaches your tunnel or web server, but it can’t reach Conch. Point it at http://127.0.0.1:4317.',
      action: { label: 'Try again', onClick: () => undefined },
    },
  },
};

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
