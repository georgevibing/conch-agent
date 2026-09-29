import type { Meta, StoryObj } from '@storybook/react-vite';

import { Field } from '../Field';
import { PasswordInput } from './PasswordInput';

const meta = {
  title: 'Components/Forms/PasswordInput',
  component: PasswordInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A password field with a show/hide toggle. Paste and password managers always work — set `autoComplete` to `current-password` to sign in or `new-password` to choose one.',
      },
    },
  },
  args: { placeholder: 'Password', autoComplete: 'current-password' },
  decorators: [(Story) => <div style={{ maxInlineSize: 360 }}>{Story()}</div>],
} satisfies Meta<typeof PasswordInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Revealed: Story = {
  args: { defaultValue: 'k7mbqe-x3tnzr-wd8pha', defaultRevealed: true },
};

export const InAField: Story = {
  render: (args) => (
    <Field>
      <Field.Label>Password</Field.Label>
      <PasswordInput {...args} defaultValue="purple otters juggle" />
      <Field.Description>At least 15 characters. A short sentence works well.</Field.Description>
    </Field>
  ),
};

export const Invalid: Story = { args: { invalid: true, defaultValue: 'short' } };
