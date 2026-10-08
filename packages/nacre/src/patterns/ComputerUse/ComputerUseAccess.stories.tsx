import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { fn } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { ComputerUseAccess, type ComputerUseAccessState } from './ComputerUse';

const meta = {
  title: 'Patterns/Computer/AppsAccess',
  component: ComputerUseAccess,
  args: { screen: 'granted', control: 'missing', grantTo: 'Conch', here: true, onOpen: fn() },
  parameters: {
    docs: {
      description: {
        component:
          'The two switches macOS keeps for itself (ADR 0110), as one short checklist: what each lets Conch do in plain words, one press to its System Settings page with Conch already on the list, and a moment’s glint when one turns on by itself.',
      },
    },
  },
} satisfies Meta<typeof ComputerUseAccess>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Access: Story = {
  args: {
    screen: 'granted',
    control: 'missing',
    grantTo: 'Conch',
    here: true,
    onOpen: fn(),
  },
};

/** Nothing on yet, and from a phone: it says where to do it, and offers no button it can't keep. */
export const FromAPhone: Story = {
  args: { screen: 'missing', control: 'missing', grantTo: 'Terminal', here: false, onOpen: fn() },
};

/** A switch turning on while you watch: the row glints once. */
export const TurningOn: Story = {
  render: function TurningOn(args) {
    const [control, setControl] = useState<ComputerUseAccessState>('missing');
    useEffect(() => {
      const timer = setTimeout(() => setControl('granted'), 1200);
      return () => clearTimeout(timer);
    }, []);
    return (
      <Stack gap={4}>
        <ComputerUseAccess {...args} control={control} />
      </Stack>
    );
  },
  args: { screen: 'granted', control: 'missing', grantTo: 'Conch', here: true, onOpen: fn() },
};
