import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../components/Button';
import { SkillShelf } from './SkillShelf';

const actions = (
  <>
    <Button size="sm" variant="soft">
      Turn them off
    </Button>
    <Button size="sm" variant="ghost" tone="neutral">
      Keep them
    </Button>
  </>
);

const meta = {
  title: 'Patterns/Skills/SkillShelf',
  component: SkillShelf,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A tidy shelf (ADR 0058). Skills Conch suggested, learned from your work or brought in from another app, unused for two months, are offered to turn off together — one card, two buttons. Nothing changes until you press. A skill you wrote yourself is never on it. Off keeps everything: the skill stays in your list and in every backup, and one switch brings it back. Your assistant stops reaching for it.',
      },
    },
  },
  args: {
    skills: [
      {
        id: 'release-notes',
        name: 'release-notes',
        title: 'Release notes',
        idle: 'Last used 3 August',
      },
      { id: 'tidy-downloads', name: 'tidy-downloads', title: 'Tidy downloads', idle: 'Never used' },
      {
        id: 'weekly-standup-from-my-calendar',
        name: 'weekly-standup-from-my-calendar',
        title: 'Weekly standup from my calendar and the team’s notes',
        idle: 'Last used 12 July',
      },
    ],
    actions,
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof SkillShelf>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const One: Story = {
  args: {
    skills: [{ id: 'imported', name: 'imported', title: 'Morning briefing', idle: 'Never used' }],
    actions: (
      <>
        <Button size="sm" variant="soft">
          Turn it off
        </Button>
        <Button size="sm" variant="ghost" tone="neutral">
          Keep it
        </Button>
      </>
    ),
  },
};

export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 340 }}>{Story()}</div>],
};
