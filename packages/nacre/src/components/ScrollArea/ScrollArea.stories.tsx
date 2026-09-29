import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar } from '../Avatar';
import { Separator } from '../Separator';
import { Stack } from '../Stack';
import { Surface } from '../Surface';
import { Text } from '../Text';
import { ScrollArea } from './ScrollArea';

const meta = {
  title: 'Components/Display/ScrollArea',
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

const sessions = [
  'Refactor session store',
  'Add retries to gateway',
  'Fix flaky tool-call test',
  'Design the composer',
  'Investigate memory leak',
  'Write ARCHITECTURE.md',
  'Upgrade to Vite 8',
  'Stream markdown safely',
  'Wire up Storybook a11y',
  'Permissions prompt UX',
  'Keyboard shortcuts',
  'Theme persistence',
  'WebSocket reconnect',
  'Diff viewer',
];

export const Vertical: Story = {
  render: () => (
    <Surface style={{ inlineSize: 300, blockSize: 320 }} radius="xl">
      <ScrollArea style={{ blockSize: '100%' }} label="Recent sessions">
        <Stack gap={0} style={{ padding: 'var(--nc-space-2)' }}>
          {sessions.map((title, i) => (
            <Stack
              key={title}
              direction="row"
              gap={3}
              align="center"
              style={{ padding: 'var(--nc-space-2) var(--nc-space-3)' }}
            >
              <Avatar name={title} size="sm" shape="square" />
              <Stack gap={0} style={{ minInlineSize: 0 }}>
                <Text size="sm" weight="medium" truncate>
                  {title}
                </Text>
                <Text size="xs" tone="subtle">
                  {i + 1}h ago
                </Text>
              </Stack>
            </Stack>
          ))}
        </Stack>
      </ScrollArea>
    </Surface>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <Surface style={{ inlineSize: 420 }} radius="lg">
      <ScrollArea orientation="horizontal" label="Attachments">
        <Stack
          direction="row"
          gap={2}
          style={{ padding: 'var(--nc-space-3)', inlineSize: 'max-content' }}
        >
          {sessions.map((title) => (
            <Surface
              key={title}
              variant="sunken"
              radius="md"
              padding={3}
              style={{ inlineSize: 140 }}
            >
              <Text size="xs" truncate>
                {title}
              </Text>
            </Surface>
          ))}
        </Stack>
      </ScrollArea>
    </Surface>
  ),
};

export const LongText: Story = {
  render: () => (
    <Surface style={{ inlineSize: 440, blockSize: 260 }}>
      <ScrollArea type="always" style={{ blockSize: '100%' }} label="Log output">
        <Stack gap={3} style={{ padding: 'var(--nc-space-5)' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <Stack key={i} gap={3}>
              <Text size="sm" tone="muted">
                Claude read <code>src/session/store.ts</code> and found that selectors recompute on
                every event. Memoising them should reduce render work during streaming.
              </Text>
              {i < 7 && <Separator />}
            </Stack>
          ))}
        </Stack>
      </ScrollArea>
    </Surface>
  ),
};
