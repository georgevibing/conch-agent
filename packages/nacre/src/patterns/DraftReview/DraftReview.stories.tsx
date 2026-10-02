import type { Meta, StoryObj } from '@storybook/react-vite';
import { DraftReview } from './DraftReview';

const meta = {
  title: 'Patterns/Chat/DraftReview',
  component: DraftReview,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Read the exact account, recipients, subject and plain-text body before approving a draft. Approval saves; it never sends.',
      },
    },
  },
  args: {
    account: 'ada@work.example',
    to: ['maya@example.com'],
    subject: 'Friday launch checklist',
    body: 'Hi Maya,\n\nCould you share the latest launch checklist before Friday?\n\nThanks,\nAda',
  },
} satisfies Meta<typeof DraftReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const LongMessage: Story = {
  args: {
    body: Array.from(
      { length: 40 },
      (_, index) => `Item ${index + 1}: Please review this point before we save the draft.`,
    ).join('\n\n'),
  },
};
export const LiteralContent: Story = {
  args: {
    subject: '',
    body: '<script>not code</script>\n[Not a link](https://example.com)\nUnicode is preserved: Καλημέρα.',
  },
};
