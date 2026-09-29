import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bot } from 'lucide-react';

import { Stack } from '../Stack';
import { Text } from '../Text';
import { Avatar, AvatarGroup } from './Avatar';

const meta = {
  title: 'Components/Display/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace', size: 'md' },
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    shape: { control: 'inline-radio', options: ['circle', 'square'] },
    status: {
      control: 'inline-radio',
      options: [undefined, 'online', 'busy', 'offline', 'working'],
    },
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const people = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Linus Pauling',
  'Margaret Hamilton',
];

export const Fallbacks: Story = {
  render: () => (
    <Stack direction="row" gap={3}>
      {people.map((name) => (
        <Avatar key={name} name={name} size="lg" />
      ))}
    </Stack>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center">
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Avatar key={size} name="Grace Hopper" size={size} />
      ))}
    </Stack>
  ),
};

export const WithImage: Story = {
  args: {
    src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop',
    name: 'Mira Chen',
    size: 'xl',
    status: 'online',
  },
};

export const Status: Story = {
  render: () => (
    <Stack direction="row" gap={4} align="center">
      {(['online', 'busy', 'offline', 'working'] as const).map((status) => (
        <Stack key={status} gap={2} align="center">
          <Avatar name="Alan Turing" size="lg" status={status} />
          <Text size="xs" tone="muted">
            {status}
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Agent: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center">
      <Avatar name="Claude" shape="square" size="lg" fallback={<Bot />} status="working" />
      <Stack gap={0}>
        <Text size="sm" weight="semibold">
          Claude
        </Text>
        <Text size="xs" tone="muted">
          Editing 3 files…
        </Text>
      </Stack>
    </Stack>
  ),
};

export const Group: Story = {
  render: () => (
    <AvatarGroup max={4} aria-label="Session participants">
      {people.map((name) => (
        <Avatar key={name} name={name} />
      ))}
    </AvatarGroup>
  ),
};
