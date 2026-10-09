import type { Meta, StoryObj } from '@storybook/react-vite';
import { Menu } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '../IconButton';
import { Stack } from '../Stack';
import { Text } from '../Text';
import { Breadcrumb } from './Breadcrumb';

const meta = {
  title: 'Components/Navigation/Breadcrumb',
  component: Breadcrumb,
  args: { size: 'md' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] } },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Where you are, as a trail — one line, in place of a stack of back buttons. Every place above this one is a quiet step back to it; the last names the page you’re on (`current`, read as the current page). Short of room, the places above give way first, each down to an ellipsis, and the page you’re on last; a pointer resting on one that was cut short reads its whole name. Use it at the top of a page inside a page (Settings → What Conch knows → What Conch knows), never for a single level: a page with nothing above it just has its title.',
      },
    },
  },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <Breadcrumb.Item onClick={() => {}}>Settings</Breadcrumb.Item>
      <Breadcrumb.Item onClick={() => {}}>Memory</Breadcrumb.Item>
      <Breadcrumb.Item current>What Conch knows</Breadcrumb.Item>
    </Breadcrumb>
  ),
};

/** Two levels: the place, and the page inside it. */
export const TwoLevels: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <Breadcrumb.Item onClick={() => {}}>Providers</Breadcrumb.Item>
      <Breadcrumb.Item current>Ollama Cloud</Breadcrumb.Item>
    </Breadcrumb>
  ),
};

/** Links, for a trail of addresses rather than actions. */
export const Links: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <Breadcrumb.Item href="#skills">Skills</Breadcrumb.Item>
      <Breadcrumb.Item href="#discover">Discover</Breadcrumb.Item>
      <Breadcrumb.Item current>Frontend design</Breadcrumb.Item>
    </Breadcrumb>
  ),
};

/** Short of room: the places above give way first, the page you're on last. */
export const Narrow: Story = {
  render: (args) => (
    <Stack gap={4}>
      {[320, 220, 150].map((width) => (
        <Stack key={width} gap={1}>
          <Text size="xs" tone="subtle">
            {width}px
          </Text>
          <div style={{ inlineSize: width, boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)' }}>
            <Breadcrumb {...args} aria-label={`Breadcrumb at ${width}px`}>
              <Breadcrumb.Item onClick={() => {}}>Settings</Breadcrumb.Item>
              <Breadcrumb.Item onClick={() => {}}>Memory</Breadcrumb.Item>
              <Breadcrumb.Item current>Bring your things from OpenClaw</Breadcrumb.Item>
            </Breadcrumb>
          </div>
        </Stack>
      ))}
    </Stack>
  ),
};

/** On a phone, beside the button that opens the menu: the header of a page in Settings. */
export const InAPhoneHeader: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: function Render(args) {
    const [deep, setDeep] = useState(true);
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--nc-space-1)',
          inlineSize: 375,
          blockSize: '3.25rem',
          paddingInline: 'var(--nc-space-3)',
          boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
        }}
      >
        <IconButton label="Open settings menu">
          <Menu />
        </IconButton>
        <Breadcrumb {...args}>
          {deep ? (
            <>
              <Breadcrumb.Item onClick={() => setDeep(false)}>Memory</Breadcrumb.Item>
              <Breadcrumb.Item current>What Conch knows</Breadcrumb.Item>
            </>
          ) : (
            <Breadcrumb.Item current>Memory</Breadcrumb.Item>
          )}
        </Breadcrumb>
      </div>
    );
  },
};
