import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stack } from '../../components/Stack';
import { GuardNote, TaintNotice, TaintReads, type TaintRead } from './TaintNotice';

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

/** What screenshot #5 showed as nine lines: a task's chat carries what its chat had read. */
const READS: TaintRead[] = [
  { kind: 'web', label: 'cheatsheetseries.owasp.org' },
  { kind: 'download', label: 'rfc-editor.org' },
  { kind: 'web', label: 'localhost' },
  { kind: 'download', label: 'localhost:6018' },
  { kind: 'app', label: 'your chat “I want you to pull the latest conch codebase in…”' },
  { kind: 'app', label: 'your chat “I want you to create a yazio app out of…”' },
  { kind: 'download', label: 'cheatsheetseries.owasp.org' },
];

/** Several reads in a row: one line that opens to each, a page and its download said once. */
export const ManyReads: StoryObj<typeof TaintReads> = {
  render: () => (
    <Stack gap={4} style={{ maxInlineSize: 560 }}>
      <TaintReads reads={READS} />
      <TaintReads reads={READS.slice(0, 3)} first={false} />
    </Stack>
  ),
};

/** In a task's chat, what the chat it came from had read; in that chat, what the task brought back. */
export const Carried: StoryObj<typeof TaintReads> = {
  render: () => (
    <Stack gap={4} style={{ maxInlineSize: 560 }}>
      <TaintReads reads={READS} from="chat" />
      <TaintReads reads={READS.slice(0, 1)} from="chat" />
      <TaintReads reads={READS.slice(0, 2)} from="task" first={false} />
    </Stack>
  ),
};
