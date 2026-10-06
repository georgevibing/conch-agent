import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Stack } from '../../components/Stack';
import { Textarea } from '../../components/Textarea';
import {
  MeaningHint,
  MemoryAdd,
  MemoryCell,
  MemoryCells,
  MemoryGlance,
  memoryKindOrder,
} from './Knows';
import { MemoryCheck, type MemoryKindName } from './Memory';

const meta = {
  title: 'Patterns/Memory/What Conch knows',
  component: MemoryGlance,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What Conch knows, at a glance (ADR 0032, ADR 0097). Conch learns and tidies quietly, so this is not a report of what it did: one calm summary — a number, one bar coloured by kind, a breathing dot while it learns — and one list to search, change and forget. The kinds under the bar are the filter. Edit and Forget appear on hover or focus; on a phone, press the words to change them and swipe left to forget. Forgetting folds the cell away before it goes. Only a security concern asks for anything, with the Memory check card above it all.',
      },
    },
  },
  args: {
    counts: { preference: 12, person: 6, project: 4, fact: 9 },
    learning: true,
    status: 'Learning quietly · tidied last night',
  },
  argTypes: {
    filter: { control: 'select', options: [null, ...memoryKindOrder] },
  },
} satisfies Meta<typeof MemoryGlance>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div style={{ maxInlineSize: 560 }}>
      <MemoryGlance {...args} />
    </div>
  ),
};

/** Pressing a kind shows only it; the other shares of the bar dim. */
export const Filtered: Story = {
  args: { filter: 'person' },
  render: (args) => (
    <div style={{ maxInlineSize: 560 }}>
      <MemoryGlance {...args} />
    </div>
  ),
};

/** Learn from your chats is off: the dot rests, and the words say so. */
export const LearningOff: Story = {
  args: { learning: false, status: 'Remembers only what you ask' },
  render: (args) => (
    <div style={{ maxInlineSize: 560 }}>
      <MemoryGlance {...args} />
    </div>
  ),
};

export const Empty: Story = {
  args: { counts: {}, status: 'Learning quietly' },
  render: (args) => (
    <div style={{ maxInlineSize: 560 }}>
      <MemoryGlance {...args} />
    </div>
  ),
};

const sample: { id: string; text: string; kind: MemoryKindName; meta: string }[] = [
  { id: 'a', text: 'Prefers British spelling', kind: 'preference', meta: 'You added · 3 days ago' },
  {
    id: 'b',
    text: 'Sister Ana lives in Porto',
    kind: 'person',
    meta: 'Learned in a chat · yesterday',
  },
  {
    id: 'c',
    text: 'Building a recipe app in TypeScript',
    kind: 'project',
    meta: 'Learned in a chat · last week',
  },
  { id: 'd', text: 'Lives in Lisbon', kind: 'fact', meta: 'Tidied · last night' },
];

/** The list: a dot for the kind, the words, where it came from. */
export const Cells: Story = {
  render: () => (
    <MemoryCells aria-label="Memories" style={{ maxInlineSize: 560 }}>
      {sample.map((m, i) => (
        <MemoryCell
          key={m.id}
          index={i}
          kind={m.kind}
          label={m.text}
          meta={m.meta}
          onEdit={() => undefined}
          onForget={() => undefined}
        >
          {m.text}
        </MemoryCell>
      ))}
    </MemoryCells>
  ),
};

/** Editing in place: the words become a field; Enter keeps, Escape goes back. */
export const Editing: Story = {
  render: () => (
    <MemoryCells aria-label="Memories" style={{ maxInlineSize: 560 }}>
      <MemoryCell kind="preference" label="Prefers British spelling" editing>
        <Textarea
          autosize
          minRows={1}
          aria-label="Edit memory"
          defaultValue="Prefers British spelling"
        />
      </MemoryCell>
      <MemoryCell
        kind="fact"
        label="Lives in Lisbon"
        meta="Tidied · last night"
        onEdit={() => undefined}
      >
        Lives in Lisbon
      </MemoryCell>
    </MemoryCells>
  ),
};

/** While you type in the search: remember it, in one press. */
export const AddWhileTyping: Story = {
  render: () => (
    <MemoryCells aria-label="Memories" style={{ maxInlineSize: 560 }}>
      <MemoryAdd text="Allergic to peanuts" onAdd={() => undefined} />
    </MemoryCells>
  ),
};

/** Search by meaning, offered in one line; nothing once it's there. */
export const MeaningHints: Story = {
  render: () => (
    <Stack gap={2} style={{ maxInlineSize: 560 }}>
      <MeaningHint
        state="offer"
        size="23 MB"
        action={
          <Button size="sm" variant="ghost">
            Get it
          </Button>
        }
      />
      <MeaningHint state="getting" progress={42} />
      <MeaningHint state="indexing" indexed={18} total={31} />
      <MeaningHint
        state="problem"
        problem="The download stopped twice."
        action={
          <Button size="sm" variant="ghost">
            Try again
          </Button>
        }
      />
    </Stack>
  ),
};

function Page() {
  const [items, setItems] = useState(sample);
  const [filter, setFilter] = useState<MemoryKindName | null>(null);
  const [query, setQuery] = useState('');
  const counts = Object.fromEntries(
    memoryKindOrder.map((k) => [k, items.filter((m) => m.kind === k).length]),
  );
  const shown = items.filter(
    (m) =>
      (!filter || m.kind === filter) && m.text.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Stack gap={4} style={{ maxInlineSize: 600 }}>
      <MemoryCheck
        content="Invoices go to billing@news.example"
        reasons={[
          'This came from news.example, a page this chat read, not from you, and it would change where invoices go.',
        ]}
        from="news.example, a page this chat read"
        actions={
          <>
            <Button size="sm" variant="soft">
              Remember it
            </Button>
            <Button size="sm" variant="ghost" tone="neutral">
              Don’t remember
            </Button>
          </>
        }
      />
      <MemoryGlance
        counts={counts}
        filter={filter}
        onFilterChange={setFilter}
        status="Learning quietly · tidied last night"
      />
      <Input
        leading={<Search />}
        aria-label="Search, or remember something new"
        placeholder="Search, or remember something new"
        value={query}
        clearable
        onClear={() => setQuery('')}
        onChange={(e) => setQuery(e.target.value)}
      />
      <MemoryCells aria-label="Memories">
        {query.trim() && !shown.some((m) => m.text === query.trim()) && (
          <MemoryAdd
            text={query.trim()}
            onAdd={() => {
              setItems((all) => [
                {
                  id: String(Date.now()),
                  text: query.trim(),
                  kind: 'fact',
                  meta: 'You added · now',
                },
                ...all,
              ]);
              setQuery('');
            }}
          />
        )}
        {shown.map((m, i) => (
          <MemoryCell
            key={m.id}
            index={i}
            kind={m.kind}
            label={m.text}
            meta={m.meta}
            onEdit={() => undefined}
            onForget={() => setItems((all) => all.filter((x) => x.id !== m.id))}
          >
            {m.text}
          </MemoryCell>
        ))}
      </MemoryCells>
    </Stack>
  );
}

/** The whole page, composed: a security question first, then what it knows. */
export const Composed: Story = {
  render: () => <Page />,
};
