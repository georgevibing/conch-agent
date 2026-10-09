import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../Stack';
import { Text } from '../Text';
import { joinMeta, MetaList } from './MetaList';

const FACTS = ['Ubuntu 24.04.4 LTS', '8 cores', '15 GB memory', 'Up 29 days'];

const meta = {
  title: 'Components/Display/MetaList',
  component: MetaList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A quiet line of short facts with a dot between them. It wraps between facts, and the dot in front of whichever fact starts a line is tucked away, so a line never starts with "·". For a plain string (a row\'s detail, a card\'s byline), `joinMeta` does the same with words: the dot is bound to the fact before it.',
      },
    },
  },
  args: { items: FACTS },
} satisfies Meta<typeof MetaList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Text as="div" size="sm" tone="muted">
      <MetaList {...args} />
    </Text>
  ),
};

/** At a phone's width the line wraps between facts; no line starts with a dot. */
export const Narrow: Story = {
  render: (args) => (
    <Stack gap={6} style={{ inlineSize: 300 }}>
      <Text as="div" size="sm" tone="muted">
        <MetaList {...args} />
      </Text>
      <Text as="div" size="sm" tone="muted">
        <MetaList
          items={['macOS 26.1', '12 cores', '36 GB memory', 'Apple M3 Pro graphics', 'Up 3 days']}
        />
      </Text>
    </Stack>
  ),
};

/** The same line as one string: the dot stays with the fact before it. */
export const AsWords: Story = {
  render: () => (
    <Stack gap={2} style={{ inlineSize: 300 }}>
      <Text size="sm" tone="muted">
        {joinMeta(FACTS)}
      </Text>
      <Text size="sm" tone="muted">
        {joinMeta(['PDF', '3 pages', '242 KB', 'made 2 minutes ago', null])}
      </Text>
    </Stack>
  ),
};
