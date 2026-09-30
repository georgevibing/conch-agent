import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { DeviceList } from './DeviceList';
import { SecretReveal } from './SecretReveal';
import { SecurityCheckup } from './SecurityCheckup';
import { checkupItems, checkupWithFixes, devices } from './fixtures';

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
