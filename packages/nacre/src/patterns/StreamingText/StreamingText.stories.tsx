import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { sampleReply } from '../fixtures';
import { StreamingText } from './StreamingText';

const meta = {
  title: 'Patterns/Chat/StreamingText',
  component: StreamingText,
  args: { text: sampleReply, streaming: false },
  parameters: {
    docs: {
      description: {
        component:
          'Incrementally arriving text. However bursty the stream, words flow out at an even pace (useSmoothText) and each settles in — a soft de-blur that dries from the accent to the text colour. The caret is a breathing pearl. Under reduced motion everything appears instantly.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StreamingText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

function useSimulatedStream(full: string, run: number) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(full.length, i + 3 + Math.floor(Math.random() * 6));
      setLength(i);
      if (i >= full.length) clearInterval(id);
    }, 45);
    return () => {
      clearInterval(id);
      setLength(0);
    };
  }, [full, run]);
  return full.slice(0, length);
}

export const Live: Story = {
  render: function Render(args) {
    const [run, setRun] = useState(0);
    const text = useSimulatedStream(args.text, run);
    return (
      <Stack gap={4} align="start">
        <StreamingText {...args} text={text} streaming={text.length < args.text.length} as="p" />
        <Button size="sm" variant="surface" onClick={() => setRun((r) => r + 1)}>
          Replay
        </Button>
      </Stack>
    );
  },
};
