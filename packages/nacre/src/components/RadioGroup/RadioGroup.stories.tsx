import type { Meta, StoryObj } from '@storybook/react-vite';
import { Hand, ShieldCheck, Zap } from 'lucide-react';
import { expect, userEvent, within } from 'storybook/test';

import { Field } from '../Field';
import { RadioGroup } from './RadioGroup';

const meta = {
  title: 'Components/Forms/RadioGroup',
  component: RadioGroup,
  parameters: {
    docs: {
      description: {
        component:
          'Single choice from a small, visible set. Use arrow keys to move between options. The `card` variant turns options into tiles — ideal for consequential choices such as permission modes.',
      },
    },
  },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Field>
      <Field.Label>Theme</Field.Label>
      <RadioGroup defaultValue="system">
        <RadioGroup.Item value="light" label="Pearl" />
        <RadioGroup.Item value="dark" label="Abalone" />
        <RadioGroup.Item value="system" label="Match system" />
      </RadioGroup>
    </Field>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <RadioGroup aria-label="Density" defaultValue="comfortable" orientation="horizontal">
      <RadioGroup.Item value="compact" label="Compact" />
      <RadioGroup.Item value="comfortable" label="Comfortable" />
      <RadioGroup.Item value="spacious" label="Spacious" disabled />
    </RadioGroup>
  ),
};

export const Cards: Story = {
  render: () => (
    <div style={{ inlineSize: 420 }}>
      <Field>
        <Field.Label>Permission mode</Field.Label>
        <RadioGroup variant="card" defaultValue="ask">
          <RadioGroup.Item
            value="ask"
            icon={<Hand />}
            label="Ask every time"
            description="Approve each file edit and shell command."
          />
          <RadioGroup.Item
            value="edits"
            icon={<ShieldCheck />}
            label="Accept edits"
            description="Edits apply automatically; commands still need approval."
          />
          <RadioGroup.Item
            value="auto"
            icon={<Zap />}
            label="Full auto"
            description="Claude works uninterrupted. Use in trusted sandboxes."
          />
        </RadioGroup>
      </Field>
    </div>
  ),
};

export const KeyboardNavigation: Story = {
  tags: ['!autodocs'],
  render: Default.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Pearl' }));
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('radio', { name: 'Abalone' })).toBeChecked();
  },
};
