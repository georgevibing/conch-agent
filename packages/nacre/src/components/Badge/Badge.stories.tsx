import type { Meta, StoryObj } from '@storybook/react-vite';
import { GitBranch, Zap } from 'lucide-react';

import { Stack } from '../Stack';
import { Text } from '../Text';
import { Badge } from './Badge';

const tones = ['accent', 'neutral', 'success', 'warning', 'danger', 'info'] as const;

const meta = {
  title: 'Components/Display/Badge',
  component: Badge,
  args: { children: 'Badge' },
  argTypes: {
    tone: { control: 'inline-radio', options: tones },
    variant: { control: 'inline-radio', options: ['soft', 'solid', 'outline'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  render: () => (
    <Stack gap={3}>
      {(['soft', 'solid', 'outline'] as const).map((variant) => (
        <Stack key={variant} direction="row" gap={2} align="center">
          {tones.map((tone) => (
            <Badge key={tone} tone={tone} variant={variant}>
              {tone[0]?.toUpperCase() + tone.slice(1)}
            </Badge>
          ))}
        </Stack>
      ))}
    </Stack>
  ),
};

export const WithDot: Story = {
  render: () => (
    <Stack direction="row" gap={2}>
      <Badge tone="success" dot="pulse">
        Connected
      </Badge>
      <Badge tone="accent" dot="pulse">
        Working
      </Badge>
      <Badge tone="warning" dot>
        Awaiting approval
      </Badge>
      <Badge tone="neutral" dot>
        Idle
      </Badge>
    </Stack>
  ),
};

export const InContext: Story = {
  render: () => (
    <Stack direction="row" gap={2} align="center">
      <Text size="sm" weight="medium">
        refactor-session-store
      </Text>
      <Badge size="sm" icon={<GitBranch />}>
        main
      </Badge>
      <Badge size="sm" tone="accent" variant="outline" icon={<Zap />}>
        Opus 5.5
      </Badge>
      <Badge size="sm" tone="info">
        12 files
      </Badge>
    </Stack>
  ),
};
