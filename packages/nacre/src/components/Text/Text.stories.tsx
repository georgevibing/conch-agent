import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../Stack';
import { Heading, Text } from './Text';

const meta = {
  title: 'Components/Typography/Text',
  component: Text,
  args: { children: 'Claude read 14 files and proposed a refactor of the session store.' },
  argTypes: {
    size: {
      control: 'select',
      options: ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'],
    },
    tone: {
      control: 'select',
      options: ['default', 'muted', 'subtle', 'accent', 'danger', 'success'],
    },
    weight: { control: 'inline-radio', options: ['regular', 'medium', 'semibold', 'bold'] },
  },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Headings: Story = {
  render: () => (
    <Stack gap={3}>
      <Heading level={1} display size="5xl">
        Good evening, <em>George</em>
      </Heading>
      <Heading level={1}>Heading 1</Heading>
      <Heading level={2}>Heading 2</Heading>
      <Heading level={3}>Heading 3</Heading>
      <Heading level={4}>Heading 4</Heading>
    </Stack>
  ),
};

export const Truncation: Story = {
  render: () => (
    <Stack gap={4} style={{ width: '18rem' }}>
      <Text truncate>
        A single line that is far too long to fit and therefore ends with an ellipsis.
      </Text>
      <Text truncate={2} tone="muted">
        Two lines of text that keep going well beyond what fits, clamped neatly at the end of the
        second line so layouts stay tidy.
      </Text>
    </Stack>
  ),
};

export const Tabular: Story = {
  render: () => (
    <Stack gap={1}>
      <Text tabular>$0.0412 · 11,204 tokens</Text>
      <Text tabular>$1.2873 · 98,441 tokens</Text>
    </Stack>
  ),
};
