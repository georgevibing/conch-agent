import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../Stack';
import { Card } from '../Surface';
import { Text } from '../Text';
import { Skeleton } from './Skeleton';

const meta = {
  title: 'Components/Feedback/Skeleton',
  component: Skeleton,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shapes: Story = {
  render: () => (
    <Stack gap={4} style={{ inlineSize: 360 }}>
      <Skeleton />
      <Skeleton lines={3} />
      <Stack direction="row" gap={3} align="center">
        <Skeleton shape="circle" width={36} />
        <Skeleton width="40%" />
      </Stack>
      <Skeleton shape="block" height={120} />
    </Stack>
  ),
};

export const MessageLoading: Story = {
  render: function Render() {
    const [loading, setLoading] = useState(true);
    useEffect(() => {
      const id = setInterval(() => setLoading((l) => !l), 2600);
      return () => clearInterval(id);
    }, []);
    return (
      <Card style={{ inlineSize: 420 }} aria-busy={loading}>
        <Stack direction="row" gap={3}>
          <Skeleton shape="circle" width={32} loading={loading}>
            <span
              style={{
                inlineSize: 32,
                blockSize: 32,
                borderRadius: '50%',
                background: 'var(--nc-accent-4)',
                flexShrink: 0,
              }}
            />
          </Skeleton>
          <Stack gap={1} style={{ flex: 1 }}>
            <Skeleton width="30%" loading={loading}>
              <Text size="sm" weight="semibold">
                Claude
              </Text>
            </Skeleton>
            <Skeleton lines={3} loading={loading}>
              <Text size="sm" tone="muted">
                I found three places where the session store mutates state outside the reducer. Want
                me to consolidate them?
              </Text>
            </Skeleton>
          </Stack>
        </Stack>
      </Card>
    );
  },
};
