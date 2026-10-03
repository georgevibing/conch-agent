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
    src: `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#f4c7b8"/><stop offset="1" stop-color="#7f9cc9"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="80" cy="64" r="28" fill="#fff" fill-opacity=".85"/><path d="M28 160c4-34 26-52 52-52s48 18 52 52z" fill="#fff" fill-opacity=".85"/></svg>',
    )}`,
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
