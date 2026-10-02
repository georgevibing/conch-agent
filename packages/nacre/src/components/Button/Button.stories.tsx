import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Blocks, ListChecks, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Badge } from '../Badge';
import { Kbd } from '../Kbd';
import { Stack } from '../Stack';
import { Button } from './Button';

const meta = {
  title: 'Components/Actions/Button',
  component: Button,
  args: { children: 'Start session', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: ['solid', 'soft', 'surface', 'ghost'] },
    tone: { control: 'inline-radio', options: ['accent', 'neutral', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    leadingIcon: { control: false },
    trailingIcon: { control: false },
    trailing: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'The primary action primitive. Solid buttons are glazed with a top-lit gradient and a colour-tinted shadow; hover them to see the Lustre sheen follow your pointer, press to send a tide ring from the press point.',
      },
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { leadingIcon: <Sparkles /> },
};

export const Variants: Story = {
  render: (args) => (
    <Stack gap={4}>
      {(['accent', 'neutral', 'danger'] as const).map((tone) => (
        <Stack key={tone} direction="row" gap={3} align="center">
          {(['solid', 'soft', 'surface', 'ghost'] as const).map((variant) => (
            <Button key={variant} {...args} variant={variant} tone={tone}>
              {variant[0]?.toUpperCase() + variant.slice(1)}
            </Button>
          ))}
        </Stack>
      ))}
    </Stack>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <Stack direction="row" gap={3} align="center">
      <Button {...args} size="sm" leadingIcon={<Plus />}>
        Small
      </Button>
      <Button {...args} size="md" leadingIcon={<Plus />}>
        Medium
      </Button>
      <Button {...args} size="lg" leadingIcon={<Plus />}>
        Large
      </Button>
    </Stack>
  ),
};

export const WithIcons: Story = {
  render: (args) => (
    <Stack direction="row" gap={3}>
      <Button {...args} leadingIcon={<Sparkles />}>
        Ask Claude
      </Button>
      <Button {...args} variant="surface" trailingIcon={<ArrowRight />}>
        Continue
      </Button>
      <Button {...args} variant="soft" tone="danger" leadingIcon={<Trash2 />}>
        Delete session
      </Button>
    </Stack>
  ),
};

/**
 * A count or a key hint goes in `trailing`, not `trailingIcon`: it keeps its
 * own size, sits on the label's line, and moves to the far end when the
 * button is wider than its words — a column of them lines up, as in a sidebar.
 */
export const WithTrailing: Story = {
  render: (args) => (
    <Stack gap={1} style={{ inlineSize: '14rem' }}>
      <Button
        {...args}
        variant="ghost"
        block
        leadingIcon={<Search />}
        trailing={<Kbd keys="mod+k" size="sm" />}
        style={{ justifyContent: 'flex-start' }}
      >
        Search
      </Button>
      <Button
        {...args}
        variant="ghost"
        block
        leadingIcon={<ListChecks />}
        trailing={
          <Badge size="sm" tone="neutral">
            3
          </Badge>
        }
        style={{ justifyContent: 'flex-start' }}
      >
        Tasks<span className="nc-visually-hidden">, 3 working</span>
      </Button>
      <Button
        {...args}
        variant="soft"
        tone="neutral"
        block
        leadingIcon={<Blocks />}
        trailing={
          <Badge size="sm" tone="warning" variant="solid">
            8
          </Badge>
        }
        style={{ justifyContent: 'flex-start' }}
      >
        Apps<span className="nc-visually-hidden">, 8 need you</span>
      </Button>
      <Button
        {...args}
        variant="surface"
        trailing={
          <Badge size="sm" tone="accent" variant="solid">
            12
          </Badge>
        }
        style={{ alignSelf: 'flex-start' }}
      >
        Inbox<span className="nc-visually-hidden">, 12 new</span>
      </Button>
    </Stack>
  ),
};

export const Loading: Story = {
  render: function Render(args) {
    const [loading, setLoading] = useState(false);
    return (
      <Button
        {...args}
        loading={loading}
        onClick={() => {
          setLoading(true);
          setTimeout(() => setLoading(false), 1800);
        }}
      >
        {loading ? 'Connecting…' : 'Connect'}
      </Button>
    );
  },
};

export const Disabled: Story = {
  render: (args) => (
    <Stack direction="row" gap={3}>
      {(['solid', 'soft', 'surface', 'ghost'] as const).map((variant) => (
        <Button key={variant} {...args} variant={variant} disabled>
          Disabled
        </Button>
      ))}
    </Stack>
  ),
};

export const AsLink: Story = {
  render: (args) => (
    <Button {...args} asChild variant="surface">
      <a href="#docs">Read the docs</a>
    </Button>
  ),
};

export const KeyboardActivation: Story = {
  tags: ['!autodocs'],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Start session' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
