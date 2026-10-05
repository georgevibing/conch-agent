import type { Meta, StoryObj } from '@storybook/react-vite';

import { Surface } from '../../components/Surface';
import { Text } from '../../components/Text';
import { LogoRow } from './LogoRow';

const items = [
  { id: 'claude-code', name: 'Claude Code', color: '#D97757' },
  { id: 'codex-cli', name: 'Codex', color: '#242424' },
  { id: 'copilot', name: 'Copilot', color: '#24292F' },
  { id: 'gemini-cli', name: 'Gemini CLI', color: '#8E75B2' },
  { id: 'grok', name: 'Grok', color: '#171717' },
  { id: 'ollama', name: 'On this computer', color: '#357568' },
  { id: 'openai', name: 'OpenAI', color: '#242424' },
  { id: 'anthropic', name: 'Anthropic', color: '#D97757' },
];

const meta = {
  title: 'Patterns/Site/LogoRow',
  component: LogoRow,
  args: { items },
  parameters: {
    docs: {
      description: {
        component:
          'A single row of catalog marks that fits its container. Hidden marks become a quiet “+N more” count. Resize the card to see the row adjust; screen readers get every name once.',
      },
    },
  },
} satisfies Meta<typeof LogoRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Surface
      variant="flat"
      radius="xl"
      padding={5}
      style={{ width: 280, maxWidth: '100%', resize: 'horizontal', overflow: 'auto' }}
    >
      <LogoRow {...args} />
      <Text size="lg" weight="semibold">
        Your providers
      </Text>
      <Text tone="muted">The assistants and models you connect.</Text>
    </Surface>
  ),
};

export const AllFit: Story = { args: { style: { width: 400 } } };
export const Narrow: Story = { args: { style: { width: 140 } } };
export const CountOnly: Story = { args: { style: { width: 64 } } };
export const One: Story = { args: { items: items.slice(0, 1) } };
export const Empty: Story = { args: { items: [] } };
