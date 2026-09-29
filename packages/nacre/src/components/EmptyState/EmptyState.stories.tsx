import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderOpen, MessageSquareDashed, Plus, SearchX } from 'lucide-react';

import { Button } from '../Button';
import { Kbd } from '../Kbd';
import { Pearl } from '../Pearl';
import { Surface } from '../Surface';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'Components/Display/EmptyState',
  component: EmptyState,
  args: {
    icon: <MessageSquareDashed />,
    title: (
      <>
        What shall we <em>build</em> today?
      </>
    ),
    description:
      'Start a session to hand a task to Claude Code running on this machine. It can read, edit and run code in your project.',
    actions: (
      <>
        <Button leadingIcon={<Plus />}>New session</Button>
        <Button variant="surface" leadingIcon={<FolderOpen />}>
          Open project
        </Button>
      </>
    ),
  },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] } },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstRun: Story = { args: { size: 'lg' } };

export const NoResults: Story = {
  args: {
    size: 'sm',
    icon: <SearchX />,
    title: 'No sessions match',
    description: (
      <>
        Try a different search, or press <Kbd keys="mod+n" size="sm" /> to start a new one.
      </>
    ),
    actions: (
      <Button variant="ghost" size="sm">
        Clear search
      </Button>
    ),
  },
  render: (args) => (
    <Surface style={{ inlineSize: 360 }}>
      <EmptyState {...args} />
    </Surface>
  ),
};

export const WithPearl: Story = {
  args: {
    size: 'lg',
    media: <Pearl state="idle" size="xl" label={null} />,
    title: (
      <>
        Good evening. <em>Ready</em> when you are.
      </>
    ),
  },
};
