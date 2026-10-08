import type { Meta, StoryObj } from '@storybook/react-vite';
import { AtSign, Eye, EyeOff, FolderGit2, Search } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Field } from '../Field';
import { IconButton } from '../IconButton';
import { Kbd } from '../Kbd';
import { Stack } from '../Stack';
import { Input } from './Input';

const meta = {
  title: 'Components/Forms/Input',
  component: Input,
  args: { placeholder: 'Search sessions', 'aria-label': 'Search sessions' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    leading: { control: false },
    trailing: { control: false },
  },
  decorators: [(Story) => <div style={{ inlineSize: 340 }}>{Story()}</div>],
  parameters: {
    docs: {
      description: {
        component:
          'Text input set in a recessed well. Focus lifts the well to the surface colour with an accent halo. Click anywhere in the well — padding or icons — to focus.',
      },
    },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { leading: <Search /> } };

export const Sizes: Story = {
  render: (args) => (
    <Stack gap={3}>
      <Input {...args} size="sm" leading={<Search />} />
      <Input {...args} size="md" leading={<Search />} />
      <Input {...args} size="lg" leading={<Search />} />
    </Stack>
  ),
};

export const Slots: Story = {
  render: function Render() {
    const [visible, setVisible] = useState(false);
    return (
      <Stack gap={3}>
        <Input
          aria-label="Search"
          placeholder="Search"
          leading={<Search />}
          trailing={<Kbd keys="mod+k" />}
        />
        <Input aria-label="Email" placeholder="you@example.com" leading={<AtSign />} type="email" />
        <Input
          aria-label="Repository"
          defaultValue="conch"
          leading={<FolderGit2 />}
          trailing=".git"
        />
        <Input
          aria-label="API key"
          type={visible ? 'text' : 'password'}
          defaultValue="correct-horse-battery-staple"
          trailing={
            <IconButton
              size="sm"
              label={visible ? 'Hide key' : 'Show key'}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeOff /> : <Eye />}
            </IconButton>
          }
        />
      </Stack>
    );
  },
};

export const Clearable: Story = {
  args: { clearable: true, defaultValue: 'streaming markdown', leading: <Search /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox');
    await expect(input).toHaveValue('streaming markdown');
    await userEvent.click(canvas.getByRole('button', { name: 'Clear' }));
    await expect(input).toHaveValue('');
    await expect(input).toHaveFocus();
  },
};

export const States: Story = {
  render: () => (
    <Stack gap={5}>
      <Field invalid>
        <Field.Label>Branch</Field.Label>
        <Input defaultValue="feature/ spaces" />
        <Field.Error>Branch names can’t contain spaces.</Field.Error>
      </Field>
      <Field disabled>
        <Field.Label>Model</Field.Label>
        <Input defaultValue="claude-opus-5-5" />
      </Field>
      <Field>
        <Field.Label>Read only</Field.Label>
        <Input readOnly defaultValue="/Users/you/code/conch" />
      </Field>
    </Stack>
  ),
};

/**
 * A unit before the amount, a placeholder for "nothing set", under a label and
 * over a description: Settings → Usage's monthly budget. On a phone the input
 * is 16px to the browser, so the page never zooms into it, and is drawn at the
 * well's size, so the placeholder reads at the size of the words around it
 * (snap it with `--touch`).
 */
export const Amount: Story = {
  render: () => (
    <Stack gap={5}>
      <Field>
        <Field.Label>Budget per month (USD)</Field.Label>
        <Input inputMode="decimal" leading="$" placeholder="No budget" />
        <Field.Description>Leave empty for no budget.</Field.Description>
      </Field>
      <Field>
        <Field.Label>Budget per month (USD)</Field.Label>
        <Input inputMode="decimal" leading="$" defaultValue="50" trailing="a month" />
        <Field.Description>Leave empty for no budget.</Field.Description>
      </Field>
      <Field>
        <Field.Label>Small</Field.Label>
        <Input size="sm" leading="$" placeholder="No budget" />
      </Field>
    </Stack>
  ),
};
