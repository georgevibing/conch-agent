import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { SkillReview } from '../Skills/SkillReview';
import { openClawItems, openClawTicked } from './fixtures';
import { ImportPreview } from './ImportPreview';
import { ImportOffer, ImportProgress, ImportSummary } from './ImportSummary';

const meta = {
  title: 'Patterns/ComeHome/ImportPreview',
  component: ImportPreview,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Come home (ADR 0035): bringing your things from OpenClaw or Hermes. The preview shows exactly what would come over, grouped, each with a tick and its words. The safe things start ticked; what could surprise — a worrying skill, a chat bot, a key — starts unticked and says why beside it. Skills come over off, routines as drafts.',
      },
    },
  },
  args: { items: openClawItems, selected: openClawTicked, onSelectedChange: () => {} },
} satisfies Meta<typeof ImportPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

const withReview = openClawItems.map((i) =>
  i.id === 'skill:solana-helper'
    ? {
        ...i,
        review: (
          <SkillReview
            verdict="danger"
            findings={[
              {
                severity: 'danger',
                message: 'Downloads something from the internet and runs it.',
                file: 'SKILL.md',
                line: 9,
              },
            ]}
          />
        ),
      }
    : i,
);

export const Playground: Story = {
  render: (args) => {
    const [selected, setSelected] = useState(args.selected);
    return (
      <div style={{ maxInlineSize: 620 }}>
        <ImportPreview {...args} selected={selected} onSelectedChange={setSelected} />
      </div>
    );
  },
  args: { items: withReview },
};

export const WithProblems: Story = {
  ...Playground,
  args: {
    items: openClawItems.slice(0, 4),
    problems: ['Its scheduled jobs couldn’t be read, so they stay behind.'],
  },
};

export const ManyMemories: Story = {
  ...Playground,
  args: {
    items: Array.from({ length: 14 }, (_, i) => ({
      id: `memory:${i}`,
      group: 'memories' as const,
      title: `Something it remembered, number ${i + 1}.`,
      detail: 'From MEMORY.md',
    })),
    selected: ['memory:0', 'memory:1'],
  },
};

export const Offer: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: 620 }}>
      <ImportOffer
        from="OpenClaw"
        summary="3 memories, 2 skills, 1 routine, 1 chat app, your profile"
        action={<Button size="sm">Take a look</Button>}
      />
      <ImportOffer
        from="Hermes"
        summary="2 memories, 1 skill, 1 routine"
        imported="Brought over 6 things on 3 May."
        action={
          <Button size="sm" variant="surface">
            Look again
          </Button>
        }
      />
    </Stack>
  ),
};

export const Progress: Story = {
  render: () => (
    <div style={{ maxInlineSize: 620 }}>
      <ImportProgress done={4} total={9} current="Morning briefing" />
    </div>
  ),
};

export const Summary: Story = {
  render: () => (
    <div style={{ maxInlineSize: 620 }}>
      <ImportSummary
        from="OpenClaw"
        counts={{ persona: 2, about: 1, memories: 2, skills: 1, routines: 1, channels: 1 }}
        next={[
          'Say hello to @pearl_bot in Telegram to finish: nobody else gets in.',
          'Turn on Morning briefing in Routines when you’re ready.',
        ]}
        failed={[{ title: 'OpenRouter key', message: 'OpenRouter didn’t accept it.' }]}
        backedUp
        action={<Button variant="surface">Undo</Button>}
      />
    </div>
  ),
};
