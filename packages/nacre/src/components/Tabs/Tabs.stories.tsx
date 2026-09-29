import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileDiff, MessageSquare, Settings2, TerminalSquare } from 'lucide-react';

import { Surface } from '../Surface';
import { Text } from '../Text';
import { Tabs } from './Tabs';

const meta = {
  title: 'Components/Navigation/Tabs',
  component: Tabs,
  args: { defaultValue: 'chat', variant: 'line', size: 'md' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['line', 'pill'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const panels = [
  { value: 'chat', label: 'Chat', icon: <MessageSquare />, body: 'The conversation with Claude.' },
  {
    value: 'changes',
    label: 'Changes',
    icon: <FileDiff />,
    meta: 12,
    body: '12 files changed across 3 packages.',
  },
  {
    value: 'terminal',
    label: 'Terminal',
    icon: <TerminalSquare />,
    body: 'Live output of commands Claude runs.',
  },
  {
    value: 'settings',
    label: 'Settings',
    icon: <Settings2 />,
    body: 'Model, permissions and working directory.',
  },
];

function Example(args: Story['args']) {
  return (
    <Tabs {...args} style={{ maxInlineSize: 560 }}>
      <Tabs.List aria-label="Session views">
        {panels.map((p) => (
          <Tabs.Trigger key={p.value} value={p.value} icon={p.icon} meta={p.meta}>
            {p.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {panels.map((p) => (
        <Tabs.Content key={p.value} value={p.value}>
          <Text tone="muted">{p.body}</Text>
        </Tabs.Content>
      ))}
    </Tabs>
  );
}

export const Line: Story = { render: (args) => <Example {...args} /> };

export const Pill: Story = {
  args: { variant: 'pill' },
  render: (args) => <Example {...args} />,
};

export const Small: Story = {
  args: { size: 'sm', variant: 'pill' },
  render: (args) => (
    <Tabs {...args} defaultValue="all">
      <Tabs.List aria-label="Filter sessions">
        <Tabs.Trigger value="all">All</Tabs.Trigger>
        <Tabs.Trigger value="active" meta={2}>
          Active
        </Tabs.Trigger>
        <Tabs.Trigger value="archived">Archived</Tabs.Trigger>
        <Tabs.Trigger value="shared" disabled>
          Shared
        </Tabs.Trigger>
      </Tabs.List>
      {['all', 'active', 'archived', 'shared'].map((v) => (
        <Tabs.Content key={v} value={v}>
          <Text size="sm" tone="muted">
            Showing {v} sessions.
          </Text>
        </Tabs.Content>
      ))}
    </Tabs>
  ),
};

export const Vertical: Story = {
  args: { orientation: 'vertical', defaultValue: 'chat' },
  render: (args) => (
    <Surface padding={3} radius="xl" style={{ inlineSize: 560 }}>
      <Tabs {...args}>
        <Tabs.List aria-label="Settings sections" style={{ minInlineSize: 160 }}>
          {panels.map((p) => (
            <Tabs.Trigger
              key={p.value}
              value={p.value}
              icon={p.icon}
              style={{ justifyContent: 'flex-start' }}
            >
              {p.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {panels.map((p) => (
          <Tabs.Content key={p.value} value={p.value} style={{ padding: 'var(--nc-space-2)' }}>
            <Text tone="muted">{p.body}</Text>
          </Tabs.Content>
        ))}
      </Tabs>
    </Surface>
  ),
};
