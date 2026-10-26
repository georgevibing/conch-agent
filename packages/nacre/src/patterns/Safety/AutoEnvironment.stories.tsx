import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Text } from '../../components/Text';
import { AUTO_ENVIRONMENT_MAX, AutoEnvironment } from './AutoEnvironment';

const meta = {
  title: 'Patterns/Safety/AutoEnvironment',
  component: AutoEnvironment,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What Auto should know about where you work, in your own words: hosts you trust, your remotes and buckets, what production means here. Auto’s review reads it before a question reaches you. Only a person sets it, in Settings → Security → Safety. One calm field; a count shows only when it’s nearly full.',
      },
    },
  },
  args: { value: '', onChange: () => undefined },
  decorators: [(Story) => <div style={{ maxInlineSize: 560 }}>{Story()}</div>],
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return <AutoEnvironment {...args} value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof AutoEnvironment>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing said yet: the placeholder shows what kind of thing helps. */
export const Empty: Story = {};

/** A note in someone's own words. */
export const Written: Story = {
  args: {
    value:
      'Our GitHub org is acme; pushing feature branches there is fine.\nstaging.acme.dev and the acme-scratch bucket are ours to change.\nProduction is anything in the prod AWS account (123456789012) or acme.com itself.',
  },
};

/** Saving, beside the label. */
export const Saving: Story = {
  args: {
    ...Written.args,
    status: (
      <Text as="span" size="xs" tone="subtle">
        Saved
      </Text>
    ),
  },
};

/** Nearly full: the count appears, and the field stops at the limit. */
export const NearlyFull: Story = {
  args: {
    value:
      `staging.acme.dev is ours. ${'Deploys to dev and staging are routine. '.repeat(45)}`.slice(
        0,
        AUTO_ENVIRONMENT_MAX - 40,
      ),
  },
};
