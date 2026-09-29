import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileCode2, Terminal } from 'lucide-react';

import { Badge } from '../Badge';
import { Stack } from '../Stack';
import { Surface } from '../Surface';
import { Text } from '../Text';
import { Collapsible } from './Collapsible';

const meta = {
  title: 'Components/Display/Collapsible',
  component: Collapsible,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: (args) => (
    <Collapsible {...args} style={{ maxInlineSize: 480 }}>
      <Collapsible.Trigger>Show reasoning</Collapsible.Trigger>
      <Collapsible.Content>
        <Text
          size="sm"
          tone="muted"
          style={{ paddingBlock: 'var(--nc-space-2)', paddingInlineStart: 'var(--nc-space-6)' }}
        >
          The failing test mocks the clock but the retry helper reads <code>performance.now()</code>
          directly, so the backoff never elapses. I&apos;ll inject the clock instead.
        </Text>
      </Collapsible.Content>
    </Collapsible>
  ),
};

export const ToolCall: Story = {
  render: () => (
    <Stack gap={2} style={{ inlineSize: 520 }}>
      {[
        {
          icon: <Terminal />,
          label: 'Ran pnpm test',
          meta: '3.2s',
          body: '✓ 128 tests passed (14 files)',
        },
        {
          icon: <FileCode2 />,
          label: 'Edited src/gateway/retry.ts',
          meta: '+18 −4',
          body: 'export async function withRetry(fn, { clock = performance } = {}) { … }',
        },
      ].map((tool) => (
        <Surface key={tool.label} variant="flat" radius="md" padding={2}>
          <Collapsible>
            <Collapsible.Trigger style={{ alignSelf: 'stretch' }}>
              <Stack direction="row" gap={2} align="center" style={{ flex: 1 }}>
                <span style={{ display: 'grid', inlineSize: 14, color: 'var(--nc-text-subtle)' }}>
                  {tool.icon}
                </span>
                <Text as="span" size="sm" tone="inherit">
                  {tool.label}
                </Text>
                <Badge size="sm" style={{ marginInlineStart: 'auto' }}>
                  {tool.meta}
                </Badge>
              </Stack>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <Surface
                variant="sunken"
                radius="sm"
                padding={3}
                style={{ marginBlockStart: 'var(--nc-space-2)' }}
              >
                <Text size="xs" style={{ fontFamily: 'var(--nc-font-mono)' }}>
                  {tool.body}
                </Text>
              </Surface>
            </Collapsible.Content>
          </Collapsible>
        </Surface>
      ))}
    </Stack>
  ),
};
