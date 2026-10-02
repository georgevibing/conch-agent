import type { Meta, StoryObj } from '@storybook/react-vite';
import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { DeviceLinkCard, type DeviceLinkState } from './DeviceLinkCard';
import { GuideSteps } from './GuideSteps';
import { LinkedDevicesSketch } from './LinkedDevicesSketch';

const meta = {
  title: 'Patterns/Channels/Linking',
  parameters: {
    docs: {
      description: {
        component:
          'WhatsApp and Signal have no bots to make: Conch joins your own account as a linked device, like WhatsApp Web. Linking is one QR code beside a picture of the phone’s Linked devices screen. The code changes by itself, so there’s nothing to press but the button on the phone; once scanned, the card says so while the phone finishes, then turns into a welcome.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const QR =
  'https://wa.me/settings/linked_devices#2@Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z,Zx9cVb7nM5lK3jH1gF0dS8aP6oI4uY2tR=,Qw1eR3tY5uI7oP9aS2dF4gH6jK8lZ0xC=,Mn2bV4cX6zL8kJ0hG1fD3sA5pO7iU9yT=,7';

const STEPS = (
  <ol>
    <li>
      Open <b>WhatsApp</b> on your phone.
    </li>
    <li>
      Tap <b>Settings</b> (on Android, <b>⋮</b>), then <b>Linked devices</b>.
    </li>
    <li>
      Tap <b>Link a device</b> and point the phone at this code.
    </li>
  </ol>
);

export const Playground: StoryObj<typeof DeviceLinkCard> = {
  args: {
    state: 'showing',
    qr: QR,
    title: 'Scan this with WhatsApp',
    qrLabel: 'Scan with WhatsApp on your phone',
    message: 'Nobody scanned the code in time.',
  },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: ['starting', 'showing', 'finishing', 'linked', 'expired', 'failed'],
    },
  },
  render: (args) => (
    <div style={{ maxWidth: 620 }}>
      <DeviceLinkCard {...args} onRetry={() => undefined}>
        {STEPS}
      </DeviceLinkCard>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <Stack gap={4} style={{ maxWidth: 620 }}>
      <DeviceLinkCard state="starting" title="Getting a code from WhatsApp" />
      <DeviceLinkCard state="showing" qr={QR} title="Scan this with WhatsApp">
        {STEPS}
      </DeviceLinkCard>
      <DeviceLinkCard state="finishing" title="Scanned">
        <p>Keep WhatsApp open on your phone for a moment.</p>
      </DeviceLinkCard>
      <DeviceLinkCard
        state="expired"
        title="The code ran out"
        message="Nobody scanned it in time. Codes last a few minutes, so an old one can’t be used."
        onRetry={() => undefined}
      />
      <DeviceLinkCard
        state="failed"
        title="That didn’t link"
        message="That’s another number (+1 555 000 2222). To use it, connect it as a new channel."
        onRetry={() => undefined}
        retryLabel="Try again"
      />
      <DeviceLinkCard
        state="linked"
        title="You’re connected, Ada"
        actions={
          <Button variant="solid" leadingIcon={<Send />}>
            Send a test message
          </Button>
        }
      >
        <p>
          Write to your assistant in <b>Message yourself</b> on WhatsApp. Nobody else’s chats reach
          it.
        </p>
      </DeviceLinkCard>
    </Stack>
  ),
};

export const LinkedDevices: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <LinkedDevicesSketch
        label="Linked devices in WhatsApp, with Link a device to press"
        color="#25D366"
        action="Link a device"
        note="Your personal messages are end-to-end encrypted on all your devices."
        alive
      />
      <LinkedDevicesSketch
        label="Linked devices in WhatsApp, with Conch linked"
        color="#25D366"
        action="Link a device"
        devices={[
          { name: 'Conch', meta: 'Active now', isNew: true },
          { name: 'Chrome (Mac OS)', meta: 'Last active today at 09:12' },
        ]}
      />
      <LinkedDevicesSketch
        label="Linked devices in Signal, with Link a new device to press"
        color="#3A76F0"
        action="Link a new device"
        alive
      />
    </div>
  ),
};

/** The whole linking step as the Channels page lays it out, moving through its states. */
export const Linking: Story = {
  render: function Render() {
    const [state, setState] = useState<DeviceLinkState>('starting');
    useEffect(() => {
      const order: DeviceLinkState[] = ['starting', 'showing', 'finishing', 'linked'];
      const timer = setInterval(
        () => setState((s) => order[(order.indexOf(s) + 1) % order.length] ?? 'starting'),
        2600,
      );
      return () => clearInterval(timer);
    }, []);
    return (
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 26rem', maxWidth: 620 }}>
          <GuideSteps label="Connect WhatsApp">
            <GuideSteps.Step
              number={1}
              title="Link WhatsApp"
              state={state === 'linked' ? 'done' : 'current'}
              summary="Linked +1 555 000 1111"
            >
              <DeviceLinkCard state={state} qr={QR} title="Scan this with WhatsApp">
                {STEPS}
              </DeviceLinkCard>
            </GuideSteps.Step>
            <GuideSteps.Step
              number={2}
              title="Say hello"
              state={state === 'linked' ? 'current' : 'upcoming'}
            >
              <DeviceLinkCard state="linked" title="You’re connected, Ada">
                <p>Write to your assistant in Message yourself.</p>
              </DeviceLinkCard>
            </GuideSteps.Step>
          </GuideSteps>
        </div>
        <LinkedDevicesSketch
          label="Linked devices in WhatsApp"
          color="#25D366"
          action="Link a device"
          alive={state === 'showing'}
          devices={state === 'linked' ? [{ name: 'Conch', meta: 'Active now', isNew: true }] : []}
        />
      </div>
    );
  },
};
