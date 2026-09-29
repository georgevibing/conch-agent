import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Field } from '../Field';
import { Text } from '../Text';
import { Textarea } from './Textarea';

const meta = {
  title: 'Components/Forms/Textarea',
  component: Textarea,
  args: { placeholder: 'Describe the change you want…', 'aria-label': 'Prompt' },
  decorators: [(Story) => <div style={{ inlineSize: 420 }}>{Story()}</div>],
  parameters: {
    docs: {
      description: {
        component:
          'Multi-line input in the same well as Input. Grows with its content between `minRows` and `maxRows` (CSS `field-sizing` with a JS fallback), then scrolls.',
      },
    },
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Autosize: Story = { args: { minRows: 2, maxRows: 8 } };

export const Fixed: Story = { args: { autosize: false, minRows: 4 } };

export const WithCounter: Story = {
  render: function Render(args) {
    const [value, setValue] = useState('Keep the public API stable.');
    const max = 280;
    return (
      <Field invalid={value.length > max}>
        <Field.Label>Custom instructions</Field.Label>
        <Textarea
          {...args}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          footer={
            <Text as="span" size="xs" tone={value.length > max ? 'danger' : 'subtle'} tabular>
              {value.length}/{max}
            </Text>
          }
        />
        <Field.Description>Appended to every session’s system prompt.</Field.Description>
        <Field.Error>That’s {value.length - max} characters over.</Field.Error>
      </Field>
    );
  },
};

export const Disabled: Story = { args: { disabled: true, defaultValue: 'Read-only transcript' } };
