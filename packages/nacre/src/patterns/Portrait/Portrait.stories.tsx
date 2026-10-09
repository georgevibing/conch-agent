import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import {
  guessFixtureKind,
  portraitFacts,
  portraitGroups,
  portraitLearned,
  portraitSuggested,
} from './fixtures';
import { FactChip } from './FactChip';
import { Portrait, type PortraitFact } from './Portrait';
import { PortraitTell } from './PortraitTell';

/** A live portrait: everything you do to it sticks, as it would in Settings. */
function Live({
  initialName = 'George',
  initialFacts = [...portraitFacts, ...portraitLearned],
  initialSuggested = [] as PortraitFact[],
}: {
  initialName?: string;
  initialFacts?: PortraitFact[];
  initialSuggested?: PortraitFact[];
}) {
  const [name, setName] = useState(initialName);
  const [facts, setFacts] = useState(initialFacts);
  const [suggested, setSuggested] = useState(initialSuggested);
  const [photo, setPhoto] = useState<string>();
  const first = (kind: string) => facts.find((f) => f.kind === kind && !f.learned)?.text;
  const summary = [first('work'), first('home'), first('person')].filter(Boolean).join(' · ');
  const add = (fact: Omit<PortraitFact, 'id'>) =>
    setFacts((all) => [...all, { ...fact, id: String(Math.random()), arriving: true }]);
  return (
    <div style={{ inlineSize: 'min(46rem, 100%)' }}>
      <Portrait
        name={name}
        onNameChange={setName}
        photo={photo}
        onPhotoSave={(blob) => setPhoto(URL.createObjectURL(blob))}
        onPhotoRemove={() => setPhoto(undefined)}
        summary={summary}
        groups={portraitGroups}
        facts={facts}
        suggested={suggested}
        onAdd={add}
        onTell={(text, kind) => add({ kind, text })}
        guessKind={guessFixtureKind}
        onChange={(fact) => setFacts((all) => all.map((f) => (f.id === fact.id ? fact : f)))}
        onRemove={(id) => setFacts((all) => all.filter((f) => f.id !== id))}
        onKeep={(id) => {
          const kept = suggested.find((f) => f.id === id);
          if (kept) setFacts((all) => [...all, { ...kept, arriving: true }]);
          setSuggested((all) => all.filter((f) => f.id !== id));
        }}
        onKeepAll={() => {
          setFacts((all) => [...all, ...suggested.map((f) => ({ ...f, arriving: true }))]);
          setSuggested([]);
        }}
        onDismiss={(id) => setSuggested((all) => all.filter((f) => f.id !== id))}
      />
    </div>
  );
}

const meta = {
  title: 'Patterns/Chat/Portrait',
  component: Portrait,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'What the assistant knows about you, as a portrait rather than a form: your face and your name as a title you type into, a line that sums you up, and the parts of your life as rows of chips. Every chat starts with them.',
          'What you told it and what it learned from your chats sit together. A small spark marks the learned — and its name says so, never colour alone — and opening a chip says where it came from (“Learned from a chat on 3 May”).',
          'A chip opens **in place** to be corrected or removed: Enter keeps it, Escape leaves it as it was, and the focus comes back to the chip. Removed, it folds away before it goes. A new one surfaces with a glint — the same band of pearl light a panel carries. Reduced motion simply shows it; `lustre = 0` takes the light away.',
          'A part with nothing in it is never a blank: it’s a question at the foot (“Who’s close to you?”) that opens to a field. **Tell Conch something** takes whatever you’d say; the group it’ll go in shows as you type, and pressing it picks another.',
          'Facts read from your own words arrive outlined, with Keep and Dismiss, until you decide.',
        ].join('\n\n'),
      },
    },
  },
  args: {
    name: 'George',
    onNameChange: () => {},
    groups: portraitGroups,
    facts: portraitFacts,
    onAdd: () => {},
    onChange: () => {},
    onRemove: () => {},
  },
} satisfies Meta<typeof Portrait>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: () => <Live /> };

export const OnlyWhatYouSaid: Story = {
  name: 'Only what you told it',
  render: () => <Live initialFacts={portraitFacts} />,
};

export const Empty: Story = {
  name: 'Nothing yet',
  render: () => <Live initialName="" initialFacts={[]} />,
};

export const ReadFromYourWords: Story = {
  name: 'Read from your words',
  render: () => <Live initialSuggested={portraitSuggested} />,
};

export const Arriving: Story = {
  name: 'A fact arriving',
  render: () => (
    <Live
      initialFacts={[
        ...portraitFacts,
        { id: 'new', kind: 'way', text: 'Metric units, always', arriving: true },
      ]}
    />
  ),
};

export const Chip: Story = {
  name: 'Fact chip',
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', inlineSize: 'min(32rem, 100%)' }}>
      <FactChip
        text="Lina"
        detail="daughter"
        label="People"
        onSave={() => {}}
        onRemove={() => {}}
      />
      <FactChip
        text="Prefers metric units"
        learned
        source="Learned from a chat on 3 May"
        label="How you like answers"
        onSave={() => {}}
        onRemove={() => {}}
      />
      <FactChip text="Just told" arriving label="People" onSave={() => {}} onRemove={() => {}} />
    </div>
  ),
};

export const Tell: Story = {
  name: 'Tell Conch something',
  render: () => (
    <div style={{ inlineSize: 'min(32rem, 100%)' }}>
      <PortraitTell groups={portraitGroups} guess={guessFixtureKind} onTell={() => {}} />
    </div>
  ),
};
