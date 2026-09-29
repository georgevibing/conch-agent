import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Stack } from '../../components/Stack';
import { ThinkingIndicator } from './ThinkingIndicator';

const meta = {
  title: 'Patterns/Chat/ThinkingIndicator',
  component: ThinkingIndicator,
  args: { label: 'Thinking' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] } },
  parameters: {
    docs: {
      description: {
        component:
          'The anticipation before an answer. Verbs chosen for the request take turns, each surfacing letter by letter while a tide of colour washes across it; three pearls rise in place of an ellipsis; and while the model reasons, the newest words of that reasoning drift past underneath in italic serif. A polite live region that announces a stable label, not every verb.',
      },
    },
  },
} satisfies Meta<typeof ThinkingIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithDetailAndTimer: Story = {
  render: function Render(args) {
    const [startedAt] = useState(() => Date.now() - 7000);
    return (
      <Stack gap={4}>
        <ThinkingIndicator {...args} startedAt={startedAt} />
        <ThinkingIndicator
          label="Reading files"
          detail="apps/server/src/session.ts"
          startedAt={startedAt}
        />
        <ThinkingIndicator label="Running tests" size="sm" />
      </Stack>
    );
  },
};

const reasoning =
  'The build broke right after the React upgrade, so the likeliest culprit is a peer dependency that still pins React 18. I should check the lockfile, then the error trace for the first package that fails to resolve.';

export const Anticipation: Story = {
  render: function Render() {
    const [startedAt] = useState(() => Date.now());
    const [trail, setTrail] = useState('');
    useEffect(() => {
      let i = 0;
      const id = setInterval(() => {
        i = Math.min(reasoning.length, i + 6 + Math.floor(Math.random() * 24));
        setTrail(reasoning.slice(0, i));
      }, 180);
      return () => clearInterval(id);
    }, []);
    return (
      <Stack gap={6}>
        <ThinkingIndicator
          orb={false}
          verbs={['Listening', 'Tracing the problem', 'Following the clues', 'Narrowing it down']}
          srLabel="Claude is thinking"
          startedAt={startedAt}
          trail={trail}
        />
        <ThinkingIndicator
          size="sm"
          verbs={['Taking that in', 'Reading the results', 'Piecing it together']}
          srLabel="Claude is working"
        />
      </Stack>
    );
  },
};
