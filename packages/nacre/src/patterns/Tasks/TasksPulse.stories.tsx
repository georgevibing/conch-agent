import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../../components/Stack';
import { InlineCode } from '../CodeBlock';
import { TasksPulse, type PulseTask } from './TasksPulse';

const link = (title: string) => (
  <a href="#task" onClick={(e) => e.preventDefault()}>
    {title}
  </a>
);

const working: PulseTask[] = [
  {
    id: 'a',
    link: link('Add dark mode to settings'),
    status: 'running',
    chat: 'Ship the settings redesign',
    current: (
      <>
        Running <InlineCode>pnpm test</InlineCode>
      </>
    ),
  },
  { id: 'b', link: link('Write the release notes'), status: 'queued', chat: 'Release 0.4' },
];

const asking: PulseTask = {
  id: 'c',
  link: link('Clean up old branches'),
  status: 'needs-you',
  chat: 'Repo housekeeping',
  current: 'Wants to delete 6 branches',
  asking: { onAllow: () => undefined, onDeny: () => undefined },
};

const meta = {
  title: 'Patterns/Tasks/TasksPulse',
  component: TasksPulse,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The pearl beside the assistant’s name says what’s going on in the background, without a page for it. It rests when nothing is; breathes while tasks work; turns warm amber when one needs you; and glints once when something finishes. While anything’s going, a press opens a short list of just those, wherever they came from — what’s asking can be allowed right there. Without a name (the phone’s header) it’s only the pearl and a count, and only while something’s going.',
      },
    },
  },
  args: { tasks: working, children: 'Conch' },
  decorators: [
    (Story) => (
      <div style={{ fontFamily: 'var(--nc-font-display)', fontSize: 'var(--nc-text-xl)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TasksPulse>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Calm: Story = { args: { tasks: [] } };

export const Working: Story = {};

export const NeedsYou: Story = { args: { tasks: [asking, ...working] } };

export const Open: Story = { args: { tasks: [asking, ...working], open: true } };

export const Compact: Story = { args: { tasks: [asking, ...working], children: undefined } };

/** Something finishes while you're elsewhere: one glint, every few seconds here. */
export const Glint: Story = {
  render: function Render(args) {
    const [celebrate, setCelebrate] = useState(false);
    useEffect(() => {
      const id = setInterval(() => {
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 900);
      }, 2400);
      return () => clearInterval(id);
    }, []);
    return (
      <Stack gap={4}>
        <TasksPulse {...args} tasks={[]} celebrate={celebrate} />
        <TasksPulse {...args} celebrate={celebrate} />
      </Stack>
    );
  },
};
