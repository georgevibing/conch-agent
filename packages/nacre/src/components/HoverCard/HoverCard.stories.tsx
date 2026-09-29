import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileCode2 } from 'lucide-react';

import { Stack } from '../Stack';
import { Text } from '../Text';
import { HoverCard } from './HoverCard';

const meta = {
  title: 'Components/Overlays/HoverCard',
  parameters: {
    docs: {
      description: {
        component:
          'Pointer-only preview. Opens after a deliberate pause and lingers briefly so the pointer can travel into it. Never the only way to reach information.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function FilePreview({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <Text size="sm">
      Claude edited{' '}
      <HoverCard.Root defaultOpen={defaultOpen}>
        <HoverCard.Trigger
          href="#src/auth/session.ts"
          style={{
            fontFamily: 'var(--nc-font-mono)',
            color: 'var(--nc-text-accent)',
            textDecoration: 'underline',
            textDecorationColor: 'var(--nc-accent-7)',
            textUnderlineOffset: 3,
          }}
        >
          src/auth/session.ts
        </HoverCard.Trigger>
        <HoverCard.Content>
          <Stack gap={3}>
            <Stack direction="row" gap={2} align="center">
              <FileCode2 size={16} aria-hidden />
              <Text size="sm" weight="semibold">
                session.ts
              </Text>
            </Stack>
            <Text size="xs" tone="muted" style={{ fontFamily: 'var(--nc-font-mono)' }}>
              +42 −17 · 3 hunks · TypeScript
            </Text>
            <Text size="sm" tone="muted">
              Replaced the cookie-based refresh with a rotating token pair and added expiry checks.
            </Text>
          </Stack>
        </HoverCard.Content>
      </HoverCard.Root>{' '}
      and 2 other files.
    </Text>
  );
}

export const FileLink: Story = {
  render: () => <FilePreview />,
};

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div style={{ blockSize: 260 }}>
      <FilePreview defaultOpen />
    </div>
  ),
};
