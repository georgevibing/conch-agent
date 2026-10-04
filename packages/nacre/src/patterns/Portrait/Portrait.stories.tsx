import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { portraitCards, portraitFacts, portraitSuggested } from './fixtures';
import { Portrait, type PortraitFact } from './Portrait';

/** A live portrait: everything you do to it sticks, as it would in Settings. */
function Live({
  initialName = 'George',
  initialFacts = portraitFacts,
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
  const first = (kind: string) => facts.find((f) => f.kind === kind)?.text;
  const summary = [first('work'), first('home'), first('person')].filter(Boolean).join(' · ');
  return (
    <div style={{ inlineSize: 'min(46rem, 100%)' }}>
      <Portrait
        name={name}
        onNameChange={setName}
        photo={photo}
        onPhotoSave={(blob) => setPhoto(URL.createObjectURL(blob))}
        onPhotoRemove={() => setPhoto(undefined)}
        summary={summary}
        cards={portraitCards}
        facts={facts}
        suggested={suggested}
        onAdd={(fact) => setFacts((all) => [...all, { ...fact, id: String(Math.random()) }])}
        onChange={(fact) => setFacts((all) => all.map((f) => (f.id === fact.id ? fact : f)))}
        onRemove={(id) => setFacts((all) => all.filter((f) => f.id !== id))}
        onKeep={(id) => {
          const kept = suggested.find((f) => f.id === id);
          if (kept) setFacts((all) => [...all, kept]);
          setSuggested((all) => all.filter((f) => f.id !== id));
        }}
        onKeepAll={() => {
          setFacts((all) => [...all, ...suggested]);
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
          'About you as a portrait, not a form: your name as a title you type into, a line that sums you up, and a card for each part of your life holding short facts. Every chat starts with them.',
          'A fact is a chip: press it to change or remove it. **Add** opens a field in place, with an example of what belongs there. People carry who they are to you, and a date when it matters.',
          'Your initial is a button: press it (or drop a picture on it) to frame a photo of you in a circle; once there is one, the same press changes or removes it.',
          'Facts read from your own words arrive outlined, with Keep and Dismiss, until you decide. Nothing is saved that you didn’t keep.',
        ].join('\n\n'),
      },
    },
  },
  args: {
    name: 'George',
    onNameChange: () => {},
    cards: portraitCards,
    facts: portraitFacts,
    onAdd: () => {},
    onChange: () => {},
    onRemove: () => {},
  },
} satisfies Meta<typeof Portrait>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: () => <Live /> };

export const Empty: Story = {
  name: 'Nothing yet',
  render: () => <Live initialName="" initialFacts={[]} />,
};

export const ReadFromYourWords: Story = {
  name: 'Read from your words',
  render: () => <Live initialSuggested={portraitSuggested} />,
};
