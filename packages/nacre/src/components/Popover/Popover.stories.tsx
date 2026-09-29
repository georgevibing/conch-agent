import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check, Gauge } from 'lucide-react';

import { Button } from '../Button';
import { Stack } from '../Stack';
import { Text } from '../Text';
import { Popover } from './Popover';

const meta = {
  title: 'Components/Overlays/Popover',
  parameters: {
    docs: {
      description: {
        component:
          'Non-modal floating panel for interactive content. Surfaces from the trigger along the side it opens on, with a resting pearl rim.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="surface" leadingIcon={<Gauge />}>
          Context
        </Button>
      </Popover.Trigger>
      <Popover.Content style={{ inlineSize: 280 }}>
        <Stack gap={2}>
          <Text size="sm" weight="semibold">
            Context window
          </Text>
          <Text size="sm" tone="muted">
            84,210 of 200,000 tokens used. Claude will summarise older turns automatically when the
            window fills.
          </Text>
        </Stack>
      </Popover.Content>
    </Popover.Root>
  ),
};

function ContextPopover({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <Popover.Root defaultOpen={defaultOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" leadingIcon={<Gauge />}>
          42% context
        </Button>
      </Popover.Trigger>
      <Popover.Content align="start" style={{ inlineSize: 300 }}>
        <Stack gap={3}>
          <Stack gap={1}>
            <Text size="sm" weight="semibold">
              Context window
            </Text>
            <Text size="xs" tone="subtle" tabular>
              84,210 / 200,000 tokens
            </Text>
          </Stack>
          <div
            role="img"
            aria-label="42 percent used"
            style={{
              blockSize: 6,
              borderRadius: 99,
              background: 'var(--nc-gray-4)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                inlineSize: '42%',
                blockSize: '100%',
                borderRadius: 99,
                background: 'var(--nc-accent-9)',
              }}
            />
          </div>
          <Text size="sm" tone="muted">
            Older turns are summarised automatically when the window fills.
          </Text>
          <Stack direction="row" gap={2} justify="end">
            <Popover.Close asChild>
              <Button size="sm" variant="surface">
                Close
              </Button>
            </Popover.Close>
            <Button size="sm" leadingIcon={<Check />}>
              Compact now
            </Button>
          </Stack>
        </Stack>
      </Popover.Content>
    </Popover.Root>
  );
}

export const ContextUsage: Story = {
  render: () => <ContextPopover />,
};

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div style={{ blockSize: 320 }}>
      <ContextPopover defaultOpen />
    </div>
  ),
};

export const Sides: Story = {
  render: () => (
    <Stack direction="row" gap={3}>
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Popover.Root key={side}>
          <Popover.Trigger asChild>
            <Button variant="surface">{side}</Button>
          </Popover.Trigger>
          <Popover.Content side={side}>
            <Text size="sm">Opens {side}</Text>
          </Popover.Content>
        </Popover.Root>
      ))}
    </Stack>
  ),
};
