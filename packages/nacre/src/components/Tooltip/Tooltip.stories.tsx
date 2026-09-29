import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../Button';
import { Stack } from '../Stack';
import { Tooltip } from './Tooltip';

const meta = {
  title: 'Components/Overlays/Tooltip',
  component: Tooltip,
  args: {
    content: 'Start a new Claude Code session',
    children: <Button variant="surface">Hover me</Button>,
  },
  argTypes: { children: { control: false } },
  parameters: {
    docs: {
      description: {
        component:
          'Short, non-interactive hints. Tooltips surface with a small rise out of soft focus; moving between tooltips inside the shared delay group switches instantly.',
      },
    },
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Open: Story = { args: { defaultOpen: true, shortcut: 'mod+n' } };

export const Sides: Story = {
  render: () => (
    <Stack direction="row" gap={4} style={{ padding: '4rem' }}>
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Tooltip key={side} content={`On the ${side}`} side={side}>
          <Button variant="surface">{side}</Button>
        </Tooltip>
      ))}
    </Stack>
  ),
};

export const WithShortcut: Story = {
  args: { content: 'Command palette', shortcut: 'mod+k', defaultOpen: true },
};
