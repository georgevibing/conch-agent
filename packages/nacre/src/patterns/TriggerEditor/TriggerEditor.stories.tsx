import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import type { TriggerValue } from '../Routines/types';
import { fakeTriggerPreview, PEOPLE, ROUTINES } from './fixtures';
import { TriggerEditor } from './TriggerEditor';

const meta = {
  title: 'Patterns/Routines/TriggerEditor',
  component: TriggerEditor,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '“What starts it?” — a routine that starts when something happens. Plain choices first (an email, a meeting, a page, a folder, a task, another routine), another app’s message behind Advanced. People are picked from those you write to; a folder from the Open dialog; typing is the fallback. The sentence underneath is the gateway’s, and says it costs nothing until something happens.',
      },
    },
  },
  args: {
    value: { kind: 'mail', from: [], words: [] },
    onChange: () => {},
    onlyIf: '',
    onOnlyIfChange: () => {},
  },
} satisfies Meta<typeof TriggerEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

function Interactive({
  initial,
  onlyIf: startOnlyIf = '',
  people = PEOPLE,
}: {
  initial: TriggerValue;
  onlyIf?: string;
  people?: typeof PEOPLE;
}) {
  const [value, setValue] = useState(initial);
  const [onlyIf, setOnlyIf] = useState(startOnlyIf);
  return (
    <div style={{ maxInlineSize: '36rem' }}>
      <TriggerEditor
        value={value}
        onChange={setValue}
        onlyIf={onlyIf}
        onOnlyIfChange={setOnlyIf}
        preview={fakeTriggerPreview(value, onlyIf)}
        people={people}
        peopleNote="Connect Gmail to pick from people you write to, or type an address."
        routines={ROUTINES}
        onChooseFolder={async () => '/Users/ada/Downloads'}
      />
    </div>
  );
}

export const Playground: Story = {
  render: (args) => (
    <div style={{ maxInlineSize: '36rem' }}>
      <TriggerEditor {...args} preview={fakeTriggerPreview(args.value, args.onlyIf)} />
    </div>
  ),
};

/** “Tell me when Anna replies”: picked, not typed, with a condition. */
export const AnEmailFromSomeone: Story = {
  render: () => (
    <Interactive
      initial={{
        kind: 'mail',
        from: [{ address: 'anna.smith@example.com', name: 'Anna Smith' }],
        words: [],
      }}
      onlyIf="it’s about the invoice"
    />
  ),
};

/** Nobody to pick from yet (no Gmail): typing is the fallback, and it says so. */
export const NobodyToPick: Story = {
  render: () => <Interactive initial={{ kind: 'mail', from: [], words: [] }} people={[]} />,
};

export const BeforeAMeeting: Story = {
  render: () => (
    <Interactive initial={{ kind: 'calendar', minutesBefore: 15, withOthers: true, words: [] }} />
  ),
};

export const APageChanges: Story = {
  render: () => (
    <Interactive initial={{ kind: 'page', url: 'https://example.com/pricing', every: 60 }} />
  ),
};

/** An address that isn't one yet: the sentence says what's missing. */
export const NotQuiteYet: Story = {
  render: () => <Interactive initial={{ kind: 'page', url: 'example', every: 60 }} />,
};

export const AFolderChanges: Story = {
  render: () => <Interactive initial={{ kind: 'folder', path: '/Users/ada/Downloads' }} />,
};

export const AfterAnotherRoutine: Story = {
  render: () => <Interactive initial={{ kind: 'routine', routineId: 'r_brief' }} />,
};

/** Advanced, open because it's chosen: another app's message. */
export const AnotherApp: Story = {
  render: () => <Interactive initial={{ kind: 'hook' }} />,
};
