import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { Switch } from '../../components/Switch';
import { AddToHomeScreen } from './AddToHomeScreen';
import { NotifiedDevices } from './NotifiedDevices';
import { NotifyThisDevice, type NotifyState } from './NotifyThisDevice';

const meta = {
  title: 'Patterns/Notifications/NotifyThisDevice',
  component: NotifyThisDevice,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Notifications on this device: one switch and a test. When the device needs something first — the Home Screen on an iPhone, the browser’s own permission — it says exactly that, calmly. Conch only notifies when nobody is looking at it.',
      },
    },
  },
  args: { state: 'off', onChange: () => undefined, onTest: () => undefined },
  decorators: [(Story) => <div style={{ maxInlineSize: 600 }}>{Story()}</div>],
} satisfies Meta<typeof NotifyThisDevice>;

export default meta;
type Story = StoryObj<typeof meta>;

const prefs = (
  <Stack gap={3}>
    <Switch labelPosition="start" defaultChecked label="When it needs your OK" />
    <Switch labelPosition="start" defaultChecked label="When an answer is ready" />
    <Switch labelPosition="start" defaultChecked label="When a routine runs" />
    <Switch labelPosition="start" defaultChecked label="When a new device wants to sign in" />
    <Switch
      labelPosition="start"
      defaultChecked
      label="Say what it’s about"
      description="Off: only “Open Conch to see what it’s asking”."
    />
  </Stack>
);

export const Playground: Story = {
  render: (args) => {
    const [state, setState] = useState<NotifyState>(args.state);
    const [busy, setBusy] = useState(false);
    return (
      <NotifyThisDevice
        {...args}
        state={state}
        busy={busy}
        onChange={(on) => {
          setBusy(true);
          setTimeout(() => {
            setState(on ? 'on' : 'off');
            setBusy(false);
          }, 900);
        }}
      >
        {state === 'on' ? prefs : undefined}
      </NotifyThisDevice>
    );
  },
};

export const Off: Story = {};
export const On: Story = { args: { state: 'on', children: prefs } };
export const InstallFirst: Story = {
  args: { state: 'install', children: <AddToHomeScreen /> },
};
export const Blocked: Story = { args: { state: 'blocked' } };
export const Unsupported: Story = {
  args: {
    state: 'unsupported',
    detail: 'Notifications need a secure address. Open Conch at its https address instead.',
  },
};

export const Devices: StoryObj<typeof NotifiedDevices> = {
  render: () => (
    <NotifiedDevices
      devices={[
        { id: '1', name: 'Safari on iPhone', detail: 'Last told 2 hours ago', current: true },
        { id: '2', name: 'Chrome on Mac', detail: 'Not told anything yet' },
        {
          id: '3',
          name: 'Firefox on Windows',
          problem: 'The push service was busy, so the last notification didn’t arrive.',
        },
      ]}
      onRemove={() => undefined}
    />
  ),
};
