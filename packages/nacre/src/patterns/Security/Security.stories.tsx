import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { DeviceApproval } from './DeviceApproval';
import { DeviceList } from './DeviceList';
import { DeviceRequests } from './DeviceRequests';
import { SecretReveal } from './SecretReveal';
import { SecurityCheckup } from './SecurityCheckup';
import { approvedDevices, checkupItems, checkupWithFixes, devices, requests } from './fixtures';

const meta = {
  title: 'Patterns/Security/SecurityCheckup',
  component: SecurityCheckup,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The building blocks of Settings → Security. Every warning says what the risk is in plain words and offers one way to fix it: a button that makes the change (only ever towards asking, off or private), a button that takes you where to decide, or — when only a person can do it — one line to copy. A fix shows progress while it runs; once it works, the finding goes away.',
      },
    },
  },
  args: { items: checkupItems },
  decorators: [(Story) => <div style={{ maxInlineSize: 560 }}>{Story()}</div>],
} satisfies Meta<typeof SecurityCheckup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllGood: Story = { args: { items: checkupItems.filter((i) => i.level === 'ok') } };

/** Each finding's one fix: `act` makes the change here, `open` (with an arrow) goes where to decide. */
export const WithFixes: Story = { args: { items: checkupWithFixes } };

/** Any other control, when a single fix button isn't the right shape. */
export const WithCustomAction: Story = {
  args: {
    items: [
      {
        id: 'full-trust',
        level: 'warn',
        title: 'New chats never ask before acting',
        detail: '“Full trust” lets the assistant run any command without asking.',
        action: (
          <Button size="sm" variant="surface">
            Change
          </Button>
        ),
      },
    ],
  },
};

export const NewAccessKey: Story = {
  render: () => <SecretReveal secret="conch_YC02EjvW93oa4FyySXsMnqq6Rzg_XDgzBWfSQggExrk" />,
};

export const Devices: Story = {
  render: () => <DeviceList devices={devices} onSignOut={() => undefined} />,
};

export const Composed: Story = {
  render: () => (
    <Stack gap={6}>
      <SecurityCheckup items={checkupWithFixes} />
      <DeviceList devices={devices} onSignOut={() => undefined} />
    </Stack>
  ),
};

/** Approval on: signed-in and remembered devices, each removable. */
export const ApprovedDevices: Story = {
  render: () => (
    <DeviceList
      label="Devices"
      devices={approvedDevices}
      onSignOut={() => undefined}
      onRemove={() => undefined}
    />
  ),
};

/** On the computer running Conch: approve or turn down, right here. */
export const WaitingHere: Story = {
  render: () => (
    <DeviceRequests
      requests={requests}
      canApprove
      onApprove={() => undefined}
      onReject={() => undefined}
    />
  ),
};

/** On another device: turn down, or the line to run on the computer running Conch. */
export const WaitingElsewhere: Story = {
  render: () => (
    <DeviceRequests requests={requests} canApprove={false} onReject={() => undefined} />
  ),
};

const inTenMinutes = () => Date.now() + 9 * 60 * 1000 + 41 * 1000;

/** What the new device sees: its code, and the one line to run. */
export const ApprovalWaiting: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <DeviceApproval
      state="waiting"
      code="K7M-Q2X"
      device="Safari on iPhone"
      expiresAt={inTenMinutes()}
      onCancel={() => undefined}
      footnote="Or open Conch on that computer: Settings → Security."
    />
  ),
};

export const ApprovalRejected: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <DeviceApproval
      state="rejected"
      code="K7M-Q2X"
      device="Safari on iPhone"
      onRetry={() => undefined}
    />
  ),
};

export const ApprovalApproved: Story = {
  parameters: { layout: 'centered' },
  render: () => <DeviceApproval state="approved" code="K7M-Q2X" device="Safari on iPhone" />,
};

/** ADR 0065: any approved device can let it in, after confirming it’s you; the terminal is the second way. */
export const ApprovalFromDevices: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <DeviceApproval
      state="waiting"
      code="K7M-Q2X"
      device="Chrome on Windows"
      expiresAt={inTenMinutes()}
      command="conch devices approve K7M-Q2X"
      fromDevices
      onCancel={() => undefined}
    />
  ),
};

/** This device could use a passkey instead of waiting. */
export const ApprovalWithPasskey: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <DeviceApproval
      state="waiting"
      code="K7M-Q2X"
      device="Safari on Mac"
      expiresAt={inTenMinutes()}
      command="conch devices approve K7M-Q2X"
      fromDevices
      passkey={{ platform: 'mac', onUse: () => undefined }}
      onCancel={() => undefined}
    />
  ),
};

export const ApprovalRejectedFromDevices: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <DeviceApproval
      state="rejected"
      code="K7M-Q2X"
      device="Chrome on Windows"
      fromDevices
      onRetry={() => undefined}
    />
  ),
};

/** On a device that can’t approve (not confirmed, or not approved itself): the hint says where. */
export const WaitingElsewhereFromDevices: Story = {
  render: () => (
    <DeviceRequests
      requests={requests}
      canApprove={false}
      hint="Approve it from a device you’ve signed in on, or on the computer running Conch:"
      commandFor={(code) => `conch devices approve ${code}`}
      onReject={() => undefined}
    />
  ),
};
