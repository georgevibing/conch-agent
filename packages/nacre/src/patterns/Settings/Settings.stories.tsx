import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../../components/Stack';
import { Switch } from '../../components/Switch';
import { Text } from '../../components/Text';
import { SettingsAdvanced } from './SettingsAdvanced';

const meta = {
  title: 'Patterns/Settings/SettingsAdvanced',
  component: SettingsAdvanced,
  parameters: {
    docs: {
      description: {
        component:
          'The end of a settings page. A page shows what people came for; a sensible default nobody changes waits under a hairline, behind the word “Advanced”. What’s inside is the page’s own sections, so opening it only makes the page longer.',
      },
    },
  },
  args: {
    children: (
      <Stack gap={5}>
        <Text size="sm" weight="medium">
          Fast mode
        </Text>
        <Switch label="Faster replies" description="Uses more of your plan." />
        <Switch defaultChecked label="Name new chats automatically" />
      </Stack>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsAdvanced>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Open: Story = { args: { defaultOpen: true } };

export const OwnWord: Story = { args: { label: 'More ways to connect' } };
