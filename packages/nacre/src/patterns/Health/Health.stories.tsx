import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../components/Button';
import { RepairPanel, type RepairItem } from './RepairPanel';

const now = Date.now();

const healthy: RepairItem[] = [
  {
    id: 'p1',
    group: 'Providers',
    title: 'Claude Code',
    state: 'ok',
    message: 'Ready · Claude Max',
  },
  { id: 'p2', group: 'Providers', title: 'OpenRouter', state: 'ok', message: 'Ready.' },
  { id: 'i1', group: 'Integrations', title: 'Notion', state: 'ok', message: 'Working.' },
  { id: 'i2', group: 'Integrations', title: 'GitHub', state: 'ok', message: 'Working.' },
  {
    id: 'c1',
    group: 'This computer',
    title: 'Browser',
    state: 'ok',
    message: 'Ready · Microsoft Edge',
  },
  { id: 'c2', group: 'This computer', title: 'Search', state: 'ok', message: 'Up to date.' },
  { id: 'c3', group: 'This computer', title: 'Disk space', state: 'ok', message: '133 GB free.' },
];

const sign = (label: string) => (
  <Button size="sm" variant="surface">
    {label}
  </Button>
);

const meta = {
  title: 'Patterns/Health/RepairPanel',
  component: RepairPanel,
  parameters: {
    docs: {
      description: {
        component:
          'Repair everything: how every part of Conch is doing in one sentence, and one button that fixes what can be fixed. While all is well it’s a calm line; what needs you opens by itself, each with its one button.',
      },
    },
  },
  args: {
    items: healthy,
    running: false,
    repairing: false,
    checkedAt: now - 60_000,
    onRepair: () => {},
    onCheck: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '44rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RepairPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EverythingWorking: Story = {};

export const NeedsYou: Story = {
  args: {
    items: [
      healthy[0] as RepairItem,
      {
        id: 'p3',
        group: 'Providers',
        title: 'Codex',
        state: 'needs-you',
        message: 'Signed out.',
        action: sign('Sign in'),
      },
      {
        id: 'i3',
        group: 'Integrations',
        title: 'Linear',
        state: 'needs-you',
        message: 'Sign in again to keep using it.',
        action: sign('Sign in again'),
      },
      ...healthy.slice(2, 6),
      {
        id: 'c4',
        group: 'This computer',
        title: 'Disk space',
        state: 'warning',
        message: 'Almost full (0.8 GB free). Chats and backups may fail to save.',
      },
    ],
  },
};

export const Repairing: Story = {
  args: {
    running: true,
    repairing: true,
    items: [
      ...healthy.slice(0, 3),
      {
        id: 'i2',
        group: 'Integrations',
        title: 'Your apps',
        state: 'checking',
        message: 'Repairing…',
      },
      {
        id: 'c',
        group: 'This computer',
        title: 'Search',
        state: 'checking',
        message: 'Repairing…',
      },
    ],
  },
};

export const Fixed: Story = {
  args: {
    repairing: true,
    items: [
      ...healthy.slice(0, 2),
      {
        id: 'i1',
        group: 'Integrations',
        title: 'Notion',
        state: 'fixed',
        message: 'Working again.',
      },
      ...healthy.slice(3, 5),
      {
        id: 'c2',
        group: 'This computer',
        title: 'Search',
        state: 'fixed',
        message: 'Built again from your chats.',
      },
    ],
    checkedAt: now,
  },
};
