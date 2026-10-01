import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../components/Button';
import { SkillReview } from './SkillReview';

const meta = {
  title: 'Patterns/Skills/SkillReview',
  component: SkillReview,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What Conch saw reading every file in a skill, before it steers anything: a quiet line when it’s fine; when it isn’t, what the skill would do, in plain words, with where it says so. A worrying skill stays off until someone looks and says yes — for that version only.',
      },
    },
  },
  args: { verdict: 'clean', findings: [] },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof SkillReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const Danger: Story = {
  args: {
    verdict: 'danger',
    findings: [
      {
        severity: 'danger',
        message: 'Downloads something from the internet and runs it straight away.',
        file: 'SKILL.md',
        line: 12,
      },
      {
        severity: 'danger',
        message: 'Reaches for saved passwords, keys or wallets.',
        file: 'scripts/run.sh',
        line: 3,
      },
      {
        severity: 'warning',
        message: 'Says something must be downloaded and installed first, from a link in the skill.',
        file: 'SKILL.md',
        line: 8,
      },
    ],
    note: 'Conch found something worrying in it. Look at it before turning it on.',
    action: (
      <Button size="sm" variant="surface" tone="danger">
        Turn it on anyway…
      </Button>
    ),
  },
};
export const Changed: Story = {
  args: {
    verdict: 'clean',
    findings: [],
    note: 'It changed in OpenClaw since you turned it on, so it’s off until you look at it again.',
    action: <Button size="sm">Turn it on as it is now</Button>,
  },
};
