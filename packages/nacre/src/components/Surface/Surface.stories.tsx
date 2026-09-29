import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderGit2 } from 'lucide-react';

import { Button } from '../Button';
import { Stack } from '../Stack';
import { Heading, Text } from '../Text';
import { Card, Surface } from './Surface';

const meta = {
  title: 'Components/Layout/Surface',
  component: Surface,
  args: {
    children: <Text tone="muted">Glazed porcelain</Text>,
    padding: 6,
    style: { minWidth: '18rem', minHeight: '8rem' },
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['raised', 'flat', 'sunken', 'outline'] },
    elevation: { control: 'inline-radio', options: [0, 1, 2, 3, 4] },
    lustre: { control: 'inline-radio', options: [false, true, 'ambient'] },
    children: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'The material every container is made of: opaque, top-lit, with layered tinted shadows. Add `lustre` for the pearl rim and sheen, `interactive` for hover lift and press settle.',
      },
    },
  },
} satisfies Meta<typeof Surface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { lustre: true } };

export const Variants: Story = {
  render: () => (
    <Stack direction="row" gap={5} wrap>
      {(['raised', 'flat', 'sunken', 'outline'] as const).map((variant) => (
        <Surface
          key={variant}
          variant={variant}
          padding={6}
          style={{ width: '11rem', height: '7rem' }}
        >
          <Text size="sm" tone="muted">
            {variant}
          </Text>
        </Surface>
      ))}
    </Stack>
  ),
};

export const ProjectCard: Story = {
  name: 'Card — project',
  render: () => (
    <Card style={{ width: '22rem' }}>
      <Card.Header>
        <Stack direction="row" gap={2} align="center">
          <FolderGit2 size={16} aria-hidden />
          <Card.Title>conch</Card.Title>
        </Stack>
        <Card.Description>
          ~/pworkplace/conch · 3 sessions · last active 4 minutes ago
        </Card.Description>
      </Card.Header>
      <Card.Footer>
        <Button variant="ghost" size="sm">
          History
        </Button>
        <Button size="sm">Open</Button>
      </Card.Footer>
    </Card>
  ),
};

export const InteractiveGrid: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 14rem)', gap: '1rem' }}>
      {['Refactor auth', 'Fix flaky test', 'Write ADR'].map((title) => (
        <Surface key={title} asChild interactive lustre padding={5}>
          <button type="button" style={{ textAlign: 'start', border: 0, font: 'inherit' }}>
            <Stack gap={1}>
              <Heading level={3} size="md">
                {title}
              </Heading>
              <Text size="sm" tone="muted">
                Resume session
              </Text>
            </Stack>
          </button>
        </Surface>
      ))}
    </div>
  ),
};

export const Ambient: Story = {
  args: { lustre: 'ambient', elevation: 3, children: <Text tone="muted">Claude is working…</Text> },
};
