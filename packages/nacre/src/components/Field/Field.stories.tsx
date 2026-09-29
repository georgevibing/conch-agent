import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Input } from '../Input';
import { Stack } from '../Stack';
import { Textarea } from '../Textarea';
import { Field, Label } from './Field';

const meta = {
  title: 'Components/Forms/Field',
  component: Field.Root,
  parameters: {
    docs: {
      description: {
        component:
          'Composition that ties a `Label`, a control, a description and an error together. Controls inside a Field pick up its id, `aria-describedby`, `aria-invalid`, `required` and `disabled` automatically via `useFieldControl`.',
      },
    },
  },
  decorators: [(Story) => <div style={{ inlineSize: 340 }}>{Story()}</div>],
} satisfies Meta<typeof Field.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: () => (
    <Field>
      <Field.Label>Session name</Field.Label>
      <Input placeholder="Refactor auth middleware" />
      <Field.Description>Shown in the sidebar and in notifications.</Field.Description>
    </Field>
  ),
};

export const RequiredAndOptional: Story = {
  render: () => (
    <Stack gap={5}>
      <Field required>
        <Field.Label>Working directory</Field.Label>
        <Input placeholder="~/code/conch" />
      </Field>
      <Field>
        <Label optional>System prompt</Label>
        <Textarea placeholder="You are a meticulous reviewer…" minRows={2} />
      </Field>
    </Stack>
  ),
};

export const WithValidation: Story = {
  render: function Render() {
    const [value, setValue] = useState('8o80');
    const invalid = !/^\d{2,5}$/.test(value);
    return (
      <Field invalid={invalid} required>
        <Field.Label>Port</Field.Label>
        <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" />
        <Field.Description>The gateway listens on this port.</Field.Description>
        <Field.Error>Use digits only, e.g. 8080.</Field.Error>
      </Field>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <Field disabled>
      <Field.Label>API base URL</Field.Label>
      <Input defaultValue="http://localhost:4242" />
      <Field.Description>Managed by your administrator.</Field.Description>
    </Field>
  ),
};
