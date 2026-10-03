import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { AppPreview, type AppPreviewApp } from './AppPreview';
import {
  coffeeTab,
  coffeeTools,
  coffeeWords,
  plantDiary,
  plantTools,
  plantUpdate,
  plantWords,
  trainCheck,
  trainTools,
  trainWords,
} from './fixtures';

const fromAda = 'From github.com/ada/plant-diary';

const plant: AppPreviewApp = {
  manifest: plantDiary,
  tools: plantTools,
  signature: { state: 'verified', publisher: 'Ada Lovelace', fingerprint: '3F9A 21C0 7B44 E1D2' },
  words: { ...plantWords, from: 'Signed by Ada Lovelace' },
};

const coffee: AppPreviewApp = {
  manifest: coffeeTab,
  tools: coffeeTools,
  signature: { state: 'unsigned' },
  words: { ...coffeeWords, from: 'From github.com/ada/conch-apps' },
};

const train: AppPreviewApp = {
  manifest: trainCheck,
  tools: trainTools,
  signature: { state: 'unsigned' },
  words: trainWords,
};

const broken: AppPreviewApp = {
  manifest: {
    id: 'pool-hours',
    name: 'Pool hours',
    tagline: 'Says whether the pool is open',
    version: '0.1.0',
    icon: { glyph: 'waves', color: 'cyan' },
  },
  tools: [],
  signature: { state: 'unsigned' },
  problems: [
    {
      message: 'Its tools reach city-pools.example, which it doesn’t say it reaches.',
      file: 'tools.mjs',
      line: 14,
    },
    { message: 'Its page has no title.', file: 'pages/main.html' },
  ],
  words: {
    from: 'From github.com/ada/conch-apps',
    abilities: [
      { kind: 'reach', text: 'Reaches no websites' },
      { kind: 'nothing-else', text: 'Can’t read your files, run programs or see your other apps' },
    ],
  },
};

const meta = {
  title: 'Patterns/Conch apps/Preview',
  component: AppPreview,
  args: {
    state: 'ready',
    looking: 'github.com/ada/plant-diary',
    apps: [plant],
    onAdd: fn(),
    onRetry: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What a link or a `.conchapp` holds, before anything is added (ADR 0061): one app laid out like the card in a chat — what it can do, its tools, who signed it, what it needs from you — or a collection to pick from, each opening in place. What stops one being added is said in words. One you have already says which version, and offers **Update** with what changed first.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { state: 'loading' } };

/** One app, signed by someone you trust. */
export const OneApp: Story = {};

/** Pressed: it's being added. */
export const Adding: Story = { args: { busy: 'plant-diary' } };

export const Added: Story = { args: { added: ['plant-diary'] } };

/** It has your app's name but comes from someone else: said before you add it. */
export const ReplacesAnother: Story = {
  args: {
    apps: [
      {
        ...plant,
        warnings: [
          {
            message:
              'It replaces the Plant diary you have, which came from someone else. Its settings and keys don’t carry over.',
          },
        ],
      },
    ],
  },
};

/** You have 1.0.0: Update, with the new reach first. */
export const Update: Story = {
  args: {
    apps: [
      {
        ...plant,
        manifest: { ...plantDiary, version: '1.1.0' },
        installed: '1.0.0',
        saved: ['weatherKey', 'city'],
        changes: plantUpdate.changes,
        words: { ...plantUpdate.words, from: 'Signed by Ada Lovelace' },
      },
    ],
  },
};

/** A folder of several: pick one, it opens in place. */
export const Collection: Story = {
  args: {
    looking: 'github.com/ada/conch-apps',
    apps: [
      coffee,
      train,
      broken,
      { ...plant, installed: '1.0.0', words: { ...plantWords, from: fromAda } },
    ],
  },
};

export const CollectionPicking: Story = {
  render: function Picking(args) {
    const [added, setAdded] = useState<string[]>([]);
    return (
      <AppPreview
        {...args}
        looking="github.com/ada/conch-apps"
        apps={[coffee, train, broken]}
        added={added}
        onAdd={(id) => setAdded((a) => [...a, id])}
      />
    );
  },
};

/** Why it can't be added, in words. */
export const Problems: Story = { args: { apps: [broken], looking: 'github.com/ada/pool-hours' } };

export const NotFound: Story = {
  args: {
    state: 'failed',
    looking: 'github.com/ada/holiday-photos',
    message: 'There’s no conch-app.json in that repository. Check the link, or ask Ada.',
  },
};
