import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { skills } from './fixtures';
import { SkillCard, type SkillMode } from './SkillCard';
import { SkillIcon } from './SkillIcon';
import { SkillUsed } from './SkillUsed';

const meta = {
  title: 'Patterns/Skills/SkillCard',
  component: SkillCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A skill at a glance. Each skill gets a tile in a hue of its own (from its name), so a list reads like a shelf of apps rather than a column of text. The title and description follow one house style — a few words, then “Does X. Use when Y.” — because Conch writes them; while it does, they shimmer, then write themselves in. The whole card opens the skill; the switch turns it on or off in place.',
      },
    },
  },
  args: { ...skills[0], onOpen: () => {}, onToggle: () => {} },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '26rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SkillCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

function Shelf() {
  const [modes, setModes] = useState<Record<string, SkillMode>>(() =>
    Object.fromEntries(skills.map((s) => [s.name, s.mode])),
  );
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(22rem, 1fr))',
        gap: 12,
        inlineSize: '48rem',
      }}
    >
      {skills.map((s) => (
        <SkillCard
          key={s.name}
          {...s}
          mode={modes[s.name] ?? s.mode}
          onOpen={() => {}}
          onToggle={(on) =>
            setModes((m) => ({ ...m, [s.name]: on ? (s.mode === 'off' ? 'auto' : s.mode) : 'off' }))
          }
        />
      ))}
    </div>
  );
}

export const List: Story = {
  decorators: [(Story) => <Story />],
  render: () => <Shelf />,
};

export const SearchMatch: Story = {
  name: 'Matched by search',
  args: { highlight: [[0, 6]] },
};

/** How the New skill page shows a skill being written, then written. */
function Writing() {
  const [pending, setPending] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setPending(false), 2400);
    return () => clearTimeout(timer);
  }, []);
  return (
    <SkillCard
      variant="preview"
      name={pending ? 'new-skill' : 'weekly-review'}
      title={pending ? 'New skill' : 'Weekly review'}
      description={
        pending
          ? ''
          : 'Drafts a weekly review from your calendar and notes. Use when asked to review or plan the week.'
      }
      mode="auto"
      pending={pending}
    />
  );
}

export const BeingWritten: Story = { render: () => <Writing /> };

export const Preview: Story = { args: { variant: 'preview' } };

export const Problem: Story = { args: { ...skills[5], name: 'broken', title: 'Broken' } };

export const Icons: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center" wrap>
      {skills.map((s) => (
        <SkillIcon key={s.name} name={s.name} title={s.title} size="lg" />
      ))}
      <SkillIcon name="weekly-review" title="Weekly review" />
      <SkillIcon name="weekly-review" title="Weekly review" size="sm" />
      <SkillIcon name="weekly-review" title="Weekly review" muted />
    </Stack>
  ),
};

export const UsedInChat: Story = {
  render: () => (
    <Stack gap={2} align="start">
      <SkillUsed name="weekly-review" title="Weekly review" by="user" onOpen={() => {}} />
      <SkillUsed name="release-notes" title="Release notes" by="assistant" />
    </Stack>
  ),
};

export const ToggleWithKeyboard: Story = {
  tags: ['!autodocs'],
  render: () => <Shelf />,
  decorators: [(Story) => <Story />],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('switch', { name: 'Turn on GitHub triage' });
    toggle.focus();
    await userEvent.keyboard(' ');
    await expect(canvas.getByRole('switch', { name: 'Turn off GitHub triage' })).toBeChecked();
  },
};
