import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { DeviceList } from './DeviceList';
import { SecretReveal } from './SecretReveal';
import { SecurityCheckup } from './SecurityCheckup';
import { checkupItems, devices } from './fixtures';

const meta = {
  title: 'Patterns/Security/SecurityCheckup',
  component: SecurityCheckup,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The building blocks of Settings → Security. Every warning says what the risk is in plain words and how to fix it — a command to copy or a button to press.',
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

export const WithAction: Story = {
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
      <SecurityCheckup items={checkupItems} />
      <DeviceList devices={devices} onSignOut={() => undefined} />
    </Stack>
  ),
};
