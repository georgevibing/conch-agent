import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from '../Surface';
import { Heading, Text } from '../Text';
import { Page } from './Page';

const meta = {
  title: 'Components/Layout/Page',
  component: Page,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "A page of the app: one centred column at `--nc-page-width`, in a pane that scrolls from edge to edge, so the scrollbar sits at the window's side. Every page uses it, so nothing jumps sideways between them.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', blockSize: '100dvh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Long: Story = {
  render: (args) => (
    <Page {...args}>
      <header>
        <Heading level={1}>Routines</Heading>
        <Text tone="muted">Things your assistant does on a schedule.</Text>
      </header>
      {Array.from({ length: 14 }, (_, i) => (
        <Card key={i} padding={5}>
          <Text>Routine {i + 1}</Text>
        </Card>
      ))}
    </Page>
  ),
};

export const Short: Story = {
  render: (args) => (
    <Page {...args}>
      <Heading level={1}>Tasks</Heading>
      <Text tone="muted">Nothing running.</Text>
    </Page>
  ),
};
