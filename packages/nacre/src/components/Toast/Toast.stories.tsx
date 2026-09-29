import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';

import { Button } from '../Button';
import { Stack } from '../Stack';
import { toast, Toaster } from './Toast';

const meta = {
  title: 'Components/Feedback/Toast',
  component: Toaster,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Transient notifications powered by Sonner, restyled in Nacre. Toasts stack, expand on hover, pause while focused, and surface on a spring. Each tone tints the corner with a faint wash of its colour.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ minBlockSize: 480, display: 'grid', placeItems: 'center' }}>
        <Story />
        <Toaster />
      </div>
    ),
  ],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const Tones: Story = {
  render: () => (
    <Stack direction="row" gap={2} wrap>
      <Button variant="surface" onClick={() => toast('Session renamed')}>
        Default
      </Button>
      <Button
        variant="surface"
        onClick={() =>
          toast.success('Changes applied', { description: '3 files edited in src/auth' })
        }
      >
        Success
      </Button>
      <Button
        variant="surface"
        onClick={() => toast.error('Connection lost', { description: 'Retrying in 5 seconds…' })}
      >
        Error
      </Button>
      <Button variant="surface" onClick={() => toast.warning('Context window 90% full')}>
        Warning
      </Button>
      <Button variant="surface" onClick={() => toast.info('Claude is waiting for permission')}>
        Info
      </Button>
    </Stack>
  ),
};

export const PromiseToast: Story = {
  name: 'Promise',
  render: () => (
    <Button
      onClick={() =>
        toast.promise(wait(2000), {
          loading: 'Running test suite…',
          success: '128 tests passed',
          error: 'Tests failed',
        })
      }
    >
      Run tests
    </Button>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Button
      variant="surface"
      tone="danger"
      onClick={() =>
        toast('Session deleted', {
          description: 'Refactor auth flow',
          action: { label: 'Undo', onClick: () => toast.success('Session restored') },
        })
      }
    >
      Delete session
    </Button>
  ),
};

function Showcase() {
  useEffect(() => {
    toast.info('Claude is waiting for permission', { duration: Infinity });
    toast.error('Connection lost', { description: 'Retrying in 5 seconds…', duration: Infinity });
    toast.success('Changes applied', {
      description: '3 files edited in src/auth',
      duration: Infinity,
      action: { label: 'Review', onClick: () => {} },
    });
    return () => {
      toast.dismiss();
    };
  }, []);
  return null;
}

export const Stacked: Story = {
  tags: ['!autodocs'],
  render: () => <Showcase />,
};
