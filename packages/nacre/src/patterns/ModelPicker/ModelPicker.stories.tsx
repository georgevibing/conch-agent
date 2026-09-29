import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { claudeCode, connectedProviders, DemoToolbar, efforts } from './fixtures';
import { ModelPicker, type ModelPickerProps } from './ModelPicker';
import { ProviderLogo } from './ProviderLogo';

function Stateful(props: Partial<ModelPickerProps>) {
  const [model, setModel] = useState(props.model ?? 'opus');
  const [effort, setEffort] = useState(props.effort ?? 'high');
  const [fast, setFast] = useState(props.fastMode ?? false);
  const [isDefault, setDefault] = useState(props.isDefault ?? false);
  return (
    <ModelPicker
      providers={[claudeCode]}
      efforts={efforts}
      fastModeAvailable={model === 'opus'}
      {...props}
      model={model}
      onModelChange={(m) => {
        setModel(m);
        setDefault(false);
      }}
      effort={effort}
      onEffortChange={(e) => {
        setEffort(e);
        setDefault(false);
      }}
      fastMode={fast}
      onFastModeChange={setFast}
      isDefault={isDefault}
      onMakeDefault={() => setDefault(true)}
    />
  );
}

const meta = {
  title: 'Patterns/Chat/ModelPicker',
  component: ModelPicker,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The composer’s model chip. Every connected provider’s models sit in one list, grouped by provider; once there are more than fit at a glance a search field appears, and typing anywhere in the list searches every provider at once. The popover also holds thinking effort and fast mode, and lets people save the combination as their default.',
      },
    },
  },
  args: {
    providers: [claudeCode],
    model: 'opus',
    onModelChange: () => {},
    effort: 'high',
    efforts,
    onEffortChange: () => {},
    fastMode: false,
    fastModeAvailable: true,
    onFastModeChange: () => {},
    isDefault: false,
  },
  decorators: [
    (Story) => (
      <div style={{ paddingBlockStart: '26rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: (args) => <Stateful {...args} /> };

export const Open: Story = { render: (args) => <Stateful {...args} open /> };

export const FastMode: Story = {
  render: (args) => <Stateful {...args} fastMode effort="max" isDefault open />,
};

export const SecondarySelected: Story = {
  name: 'More models (selection inside)',
  render: (args) => <Stateful {...args} model="claude-opus-4-8" open />,
};

export const Loading: Story = { render: (args) => <Stateful {...args} loading open /> };

export const EveryProvider: Story = {
  name: 'Every connected provider',
  render: (args) => <Stateful {...args} providers={connectedProviders} open />,
};

export const Searching: Story = {
  name: 'Search by name',
  render: (args) => <Stateful {...args} providers={connectedProviders} open />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('radio', { name: /Opus 5.5/ })).toHaveFocus();
    // Typing anywhere in the list searches every provider.
    await userEvent.keyboard('qwen');
    await expect(body.getByRole('searchbox', { name: 'Search models' })).toHaveValue('qwen');
    await expect(body.getByRole('radio', { name: /Qwen3 Coder/ })).toBeInTheDocument();
    await expect(body.queryByRole('radio', { name: /Opus 5.5/ })).toBeNull();
  },
};

export const NothingMatches: Story = {
  tags: ['!autodocs'],
  render: (args) => <Stateful {...args} providers={connectedProviders} open />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(await body.findByRole('searchbox', { name: 'Search models' }), 'zzz');
    await expect(body.getByText(/No model matches/)).toBeInTheDocument();
  },
};

export const InToolbar: Story = {
  render: () => (
    <Stack direction="row" gap={1}>
      <DemoToolbar />
    </Stack>
  ),
};

export const Logos: Story = {
  render: () => (
    <Stack direction="row" gap={4} align="center">
      <ProviderLogo provider="claude" size={32} title="Claude" />
      <ProviderLogo provider="openai" size={32} title="OpenAI" />
      <ProviderLogo provider="openrouter" size={32} title="OpenRouter" />
      <ProviderLogo provider="generic" size={32} title="Other" />
    </Stack>
  ),
};

export const KeyboardSelection: Story = {
  tags: ['!autodocs'],
  render: (args) => <Stateful {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Model: Opus 5.5/ }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('radio', { name: /Opus 5.5/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(body.getByRole('radio', { name: /Sonnet 5/ })).toBeChecked();
  },
};
