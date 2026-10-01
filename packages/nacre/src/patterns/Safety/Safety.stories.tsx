import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../../components/Stack';
import { GuardNote, TaintNotice } from './TaintNotice';

const meta = {
  title: 'Patterns/Safety/TaintNotice',
  component: TaintNotice,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'When a chat reads something from outside — a web page, an email, someone else’s message — a quiet line says so once, and from then on anything that could send what it read somewhere, or change the computer, asks first. The question card carries a GuardNote saying why, and offers no “always”.',
      },
    },
  },
  args: { read: 'news.example', first: true },
} satisfies Meta<typeof TaintNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const First: Story = {};
export const Later: Story = { args: { read: 'things in Gmail', first: false } };
export const OnACard: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: 560 }}>
      <GuardNote>
        This chat read news.example, which could be trying to steer me. So I’m checking before I run
        a command.
      </GuardNote>
    </Stack>
  ),
};
