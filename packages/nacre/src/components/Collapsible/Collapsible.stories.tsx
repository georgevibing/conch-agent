import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileCode2, Terminal } from 'lucide-react';
import type { CSSProperties } from 'react';
import { expect, within } from 'storybook/test';

import { Badge } from '../Badge';
import { Stack } from '../Stack';
import { Surface } from '../Surface';
import { Text } from '../Text';
import { Collapsible } from './Collapsible';

const meta = {
  title: 'Components/Display/Collapsible',
  component: Collapsible,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One region, shown or folded away. What opens lines up with the trigger’s words, past its chevron, so a list nests under them: its bullets at the words’ start, never out under the chevron. A pattern that moves the trigger sets `--cl-bleed` (its chevron hanging out past the edge) or `--cl-gap` on the root, and the content follows. `inset={false}` lets a full-width panel span the fold.',
      },
    },
  },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: (args) => (
    <Collapsible {...args} style={{ maxInlineSize: 480 }}>
      <Collapsible.Trigger>Show reasoning</Collapsible.Trigger>
      <Collapsible.Content>
        <Text size="sm" tone="muted" style={{ paddingBlock: 'var(--nc-space-2)' }}>
          The failing test mocks the clock but the retry helper reads <code>performance.now()</code>
          directly, so the backoff never elapses. I&apos;ll inject the clock instead.
        </Text>
      </Collapsible.Content>
    </Collapsible>
  ),
};

const changes = [
  'Attach files, pictures and long pastes to a message',
  'Terminals heal a spawn helper that lost its execute bit, so a long line wraps under its words',
  'Conch keeps itself running, and can start itself again',
];

/** A list under its disclosure: bullets at the words' start, never under the chevron. */
export const WithAList: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Stack gap={4} style={{ maxInlineSize: 480 }}>
      <Collapsible {...args}>
        <Collapsible.Trigger>What’s new</Collapsible.Trigger>
        <Collapsible.Content>
          <ul
            style={{
              margin: 0,
              paddingBlock: 'var(--nc-space-1)',
              paddingInlineStart: 'var(--nc-space-4)',
              fontSize: 'var(--nc-text-sm)',
            }}
          >
            {changes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Collapsible.Content>
      </Collapsible>
      {/* Hung out past the edge: the chevron on it, the words and the list in from it. */}
      <Collapsible {...args} style={{ '--cl-bleed': 'var(--nc-space-1-5)' } as CSSProperties}>
        <Collapsible.Trigger>Show details</Collapsible.Trigger>
        <Collapsible.Content>
          <Text size="sm" tone="muted" style={{ paddingBlock: 'var(--nc-space-1)' }}>
            Opened under its words, on a page whose edge the chevron sits on.
          </Text>
        </Collapsible.Content>
      </Collapsible>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'What’s new' });
    const words = trigger.lastChild as Node;
    const range = document.createRange();
    range.selectNodeContents(words);
    const wordsStart = range.getBoundingClientRect().left;
    const item = canvas.getByText(changes[0] ?? '');
    const list = item.closest('ul') as HTMLElement;
    // The bullets' column starts at the words, and each line's text past it.
    await expect(list.getBoundingClientRect().left).toBeGreaterThanOrEqual(wordsStart - 0.5);
    await expect(item.getBoundingClientRect().left).toBeGreaterThan(wordsStart);
  },
};

export const ToolCall: Story = {
  render: () => (
    <Stack gap={2} style={{ inlineSize: 520 }}>
      {[
        {
          icon: <Terminal />,
          label: 'Ran pnpm test',
          meta: '3.2s',
          body: '✓ 128 tests passed (14 files)',
        },
        {
          icon: <FileCode2 />,
          label: 'Edited src/gateway/retry.ts',
          meta: '+18 −4',
          body: 'export async function withRetry(fn, { clock = performance } = {}) { … }',
        },
      ].map((tool) => (
        <Surface key={tool.label} variant="flat" radius="md" padding={2}>
          <Collapsible>
            <Collapsible.Trigger style={{ alignSelf: 'stretch' }}>
              <Stack direction="row" gap={2} align="center" style={{ flex: 1 }}>
                <span style={{ display: 'grid', inlineSize: 14, color: 'var(--nc-text-subtle)' }}>
                  {tool.icon}
                </span>
                <Text as="span" size="sm" tone="inherit">
                  {tool.label}
                </Text>
                <Badge size="sm" style={{ marginInlineStart: 'auto' }}>
                  {tool.meta}
                </Badge>
              </Stack>
            </Collapsible.Trigger>
            <Collapsible.Content inset={false}>
              <Surface
                variant="sunken"
                radius="sm"
                padding={3}
                style={{ marginBlockStart: 'var(--nc-space-2)' }}
              >
                <Text size="xs" style={{ fontFamily: 'var(--nc-font-mono)' }}>
                  {tool.body}
                </Text>
              </Surface>
            </Collapsible.Content>
          </Collapsible>
        </Surface>
      ))}
    </Stack>
  ),
};
