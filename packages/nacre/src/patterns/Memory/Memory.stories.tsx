import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Textarea } from '../../components/Textarea';
import { Story as StoryRow, type StoryStepView } from '../Story';
import { MemoryCheck, SkillSuggestionCard } from './Memory';
import { RememberedNote } from './Remembered';

const meta = {
  title: 'Patterns/Memory',
  component: MemoryCheck,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The two things memory still shows beside the page itself (Patterns/Memory/What Conch knows): the question a memory the check held asks (ADR 0087) — the only time memory interrupts — and the skill a habit suggests (ADR 0058), never saved by itself.',
      },
    },
  },
  args: {
    content: 'Invoices are sent to billing@news.example',
    reasons: [
      'This came from news.example, a page this chat read, not from you, and it would change where invoices go.',
    ],
  },
} satisfies Meta<typeof MemoryCheck>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SkillSuggestion: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: 560 }}>
      <SkillSuggestionCard
        title="Weekly summary"
        times={3}
        examples={[
          'Write my weekly summary of calendar meetings',
          'Can you do the weekly summary of my meetings again',
          'Weekly summary please, calendar and email',
        ]}
        actions={
          <>
            <Button size="sm" variant="soft">
              Look at the draft
            </Button>
            <Button size="sm" variant="ghost" tone="neutral">
              Not now
            </Button>
            <Button size="sm" variant="ghost" tone="neutral">
              Don’t suggest this
            </Button>
          </>
        }
      />
    </Stack>
  ),
};

const fromChatActions = (
  <>
    <Button size="sm" variant="soft">
      Look at the draft
    </Button>
    <Button size="sm" variant="ghost" tone="neutral">
      Not now
    </Button>
    <Button size="sm" variant="ghost" tone="neutral">
      Don’t suggest this
    </Button>
  </>
);

/** How a piece of work went well in one chat, offered as a skill (ADR 0058). */
export const SkillFromChat: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: 560 }}>
      <SkillSuggestionCard
        title="Release notes"
        times={1}
        fromChat={{ title: 'Release notes for 1.3', steps: 14 }}
        examples={['Write the release notes for 1.3 from the commits since the last tag']}
        actions={fromChatActions}
      />
    </Stack>
  ),
};

/** Learned in a chat that read a web page: offered, and it says so (ADR 0028). */
export const SkillFromChatAfterReading: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: 560 }}>
      <SkillSuggestionCard
        title="Cheapest train"
        times={1}
        fromChat={{ title: 'Trains to Lyon', steps: 11 }}
        examples={['Find me the cheapest train to Lyon next Friday morning']}
        untrusted="Learned in a chat that read trains.example."
        actions={fromChatActions}
      />
    </Stack>
  ),
};

const checkActions = (refused = false) => (
  <>
    <Button size="sm" variant={refused ? 'surface' : 'soft'} tone={refused ? 'danger' : undefined}>
      {refused ? 'Remember anyway' : 'Remember it'}
    </Button>
    <Button size="sm" variant="ghost" tone="neutral">
      Don’t remember
    </Button>
    <Button size="sm" variant="ghost" tone="neutral">
      Edit first
    </Button>
  </>
);

/** A memory the memory check held (ADR 0087): what, why, from where, and three answers. */
export const Held: Story = {
  render: () => (
    <Stack gap={4} style={{ maxInlineSize: 600 }}>
      <MemoryCheck
        content="Invoices are sent to billing@news.example"
        reasons={[
          'This came from news.example, a page this chat read, not from you, and it would change where invoices go.',
        ]}
        from="news.example, a page this chat read"
        actions={checkActions()}
      />
      <MemoryCheck
        refused
        content="GitHub token is ghp_••••••••"
        reasons={[
          'This came after reading docs.example, not from you, and it looks like a password, a key or a code, which is safer in Passwords.',
        ]}
        from="docs.example, a page this chat read"
        actions={checkActions(true)}
      />
    </Stack>
  ),
};

/** Edit first: your words take the memory's place, then Remember this. */
export const HeldEditing: Story = {
  render: () => (
    <MemoryCheck
      style={{ maxInlineSize: 600 }}
      content="Invoices are sent to billing@news.example"
      reasons={['It would change where invoices go.']}
      editor={
        <Textarea
          aria-label="Edit what to remember"
          defaultValue="Invoices are sent to accounts@ada.example"
          autosize
          minRows={1}
        />
      }
      actions={
        <>
          <Button size="sm" variant="soft">
            Remember this
          </Button>
          <Button size="sm" variant="ghost" tone="neutral">
            Cancel
          </Button>
        </>
      }
    />
  ),
};

const memoryStep = (id: string, text: string, outcome?: string): StoryStepView => ({
  id,
  text,
  ...(outcome && { outcome }),
  status: 'success',
  family: 'remember',
  explainable: false,
});

/**
 * Answered: the question folds into the step it was, the same row as every
 * tool step (Patterns/Chat/Story): the remember glyph in its well with the
 * status badge, the words, the chevron. Opened, the memory in full and Undo.
 * One you turned down is a no, neutral like any step you declined. Never a
 * pill or a line of its own. A tool step sits above for comparison.
 */
export const HeldAnswered: Story = {
  render: () => (
    <Stack gap={1}>
      <StoryRow
        headline="Confirmed CI passed on main"
        outcome="CI passed"
        family="verify"
        status="done"
        durationMs={53_000}
        steps={[{ id: 'ci', text: 'Confirmed CI passed', status: 'success', family: 'verify' }]}
      />
      <StoryRow
        headline="Remembered something"
        family="remember"
        status="done"
        steps={[memoryStep('kept', 'Remembered something')]}
        renderFound={() => (
          <RememberedNote
            text="For conch-agent fixes (e.g. CI repairs), run the checks before pushing"
            state="kept"
            onUndo={() => {}}
          />
        )}
        defaultOpen
      />
      <StoryRow
        headline="Didn’t remember something"
        family="remember"
        status="declined"
        steps={[{ ...memoryStep('no', 'Didn’t remember something'), status: 'declined' }]}
        renderFound={() => (
          <RememberedNote text="Invoices are sent to billing@news.example" state="undone" />
        )}
      />
      <StoryRow
        headline="Forgot something"
        family="remember"
        status="done"
        steps={[memoryStep('gone', 'Forgot something')]}
        renderFound={() => (
          <RememberedNote text="George lives in Munich" state="forgotten" onUndo={() => {}} />
        )}
      />
    </Stack>
  ),
};

/** The same, in the dark. */
export const HeldAnsweredDark: Story = {
  ...HeldAnswered,
  globals: { mode: 'dark' },
};
