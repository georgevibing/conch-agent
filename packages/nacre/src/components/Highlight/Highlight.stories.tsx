import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../Stack';
import { Text } from '../Text';
import { Highlight } from './Highlight';

const meta = {
  title: 'Components/Display/Highlight',
  component: Highlight,
  args: {
    text: 'Run the deploy script with --stage staging, then redeploy the worker.',
    ranges: [
      [8, 14],
      [58, 64],
    ],
    tone: 'soft',
  },
  argTypes: { tone: { control: 'inline-radio', options: ['soft', 'strong'] } },
  parameters: {
    docs: {
      description: {
        component:
          'Marks matched spans in search results, fuzzy titles and previews. A quiet accent wash plus a touch more weight, so a match reads at a glance without shouting — and never by colour alone.',
      },
    },
  },
} satisfies Meta<typeof Highlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
  render: (args) => (
    <Stack gap={3}>
      <Text>
        <Highlight {...args} tone="soft" />
      </Text>
      <Text>
        <Highlight {...args} tone="strong" />
      </Text>
    </Stack>
  ),
};

export const FuzzyTitle: Story = {
  args: {
    text: 'Plan my week in Lisbon',
    ranges: [
      [0, 1],
      [5, 7],
      [16, 19],
    ],
  },
  render: (args) => (
    <Text weight="medium">
      <Highlight {...args} />
    </Text>
  ),
};
