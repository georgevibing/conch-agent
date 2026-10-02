import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Callout } from '../../components/Callout';
import { ArtifactChart, type ChartData } from './ArtifactChart';
import { ArtifactEditor } from './ArtifactEditor';
import { ArtifactPanel } from './ArtifactPanel';
import { ArtifactTable } from './ArtifactTable';
import { LiveDataAsk, LiveDataBar, LiveDataList } from './LiveData';

const week: ChartData = {
  type: 'bar',
  title: 'Visitors this week',
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  series: [{ name: 'Visitors', values: [120, 180, 150, 210, 260] }],
};

const budget = `Item,Monthly,Yearly
Rent,1200,14400
Food,420,5040
Transport,95,1140`;

/** The chart as typed: drawn when it reads, the last good one kept when it doesn't. */
function ChartEditing({ layout }: { layout: 'split' | 'switch' }) {
  const start = JSON.stringify(week, null, 2);
  const [text, setText] = useState(start);
  const [shown, setShown] = useState(week);
  const [problem, setProblem] = useState<string>();
  const change = (next: string) => {
    setText(next);
    try {
      setShown(JSON.parse(next) as ChartData);
      setProblem(undefined);
    } catch {
      setProblem('The chart’s JSON has a mistake: look for a missing comma, quote or bracket.');
    }
  };
  return (
    <ArtifactEditor
      kind="chart"
      title="Visitors this week"
      value={text}
      onChange={change}
      preview={<ArtifactChart chart={shown} />}
      problem={problem}
      dirty={text !== start}
      onSave={() => {}}
      onCancel={() => change(start)}
      layout={layout}
    />
  );
}

const meta = {
  title: 'Patterns/Show me/Editing and live data',
  component: ArtifactEditor,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Editing something by hand (ADR 0039): its code in CodeMirror, and the thing itself redrawn as you type — beside it when there is room, a press away when there isn’t. Save makes a version marked as yours. A page with live data says when it last read, asks once per site (showing exactly which addresses), and fails calmly.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ blockSize: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    kind: 'chart',
    title: 'Visitors this week',
    value: '',
    onChange: () => {},
    preview: null,
    dirty: false,
    onSave: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof ArtifactEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SideBySide: Story = {
  name: 'Side by side',
  render: () => <ChartEditing layout="split" />,
};

export const OnAPhone: Story = {
  name: 'On a phone (Edit or Preview)',
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 390, blockSize: 720, display: 'flex', margin: '0 auto' }}>
        <Story />
      </div>
    ),
  ],
  render: () => <ChartEditing layout="switch" />,
};

export const ATableThatWontSave: Story = {
  name: 'A table that won’t save yet',
  args: {
    kind: 'table',
    title: 'Budget',
    value: `${budget}\nPhone,25`,
    preview: <ArtifactTable csv={budget} label="Budget, as a table" />,
    problem: 'Line 5 has 2 values, but the header has 3.',
    dirty: true,
    layout: 'split',
  },
};

export const ANewerVersionCameIn: Story = {
  name: 'A newer version came in',
  args: {
    kind: 'table',
    title: 'Budget',
    value: budget,
    preview: <ArtifactTable csv={budget} label="Budget, as a table" />,
    dirty: true,
    layout: 'split',
    notice: (
      <Callout tone="info" title="The assistant made version 4 while you were editing">
        Your edit is still here. Save it as the newest version, or cancel and start from theirs.
      </Callout>
    ),
  },
};

export const InThePanel: Story = {
  name: 'In the panel',
  render: () => (
    <div style={{ blockSize: '100vh', maxInlineSize: 900, marginInlineStart: 'auto' }}>
      <ArtifactPanel
        title="Visitors this week"
        kind="chart"
        versions={[
          { n: 1, when: 'Today, 9:40 AM' },
          { n: 2, when: 'Today, 9:44 AM', edited: true, note: 'Edited by you' },
        ]}
        version={2}
        preview={null}
        editing={<ChartEditing layout="split" />}
        onClose={() => {}}
      />
    </div>
  ),
};

export const LiveData: Story = {
  name: 'Live data',
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxInlineSize: 560 }}>
      <LiveDataBar
        state="live"
        updatedAt={Date.now() - 2 * 60_000}
        everySeconds={600}
        onRefresh={() => {}}
        sources={[{ host: 'api.open-meteo.com' }]}
        onStop={() => {}}
      />
      <LiveDataBar
        state="failed"
        updatedAt={Date.now() - 12 * 60_000}
        problem="api.open-meteo.com took too long to answer."
        onRefresh={() => {}}
        sources={[{ host: 'api.open-meteo.com' }]}
      />
      <LiveDataBar state="live" refreshing onRefresh={() => {}} sources={[]} />
    </div>
  ),
};

export const AskingFirst: Story = {
  name: 'Asking first',
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxInlineSize: 520 }}>
      <LiveDataAsk
        title="Weather now"
        host="api.open-meteo.com"
        urls={[
          'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m',
        ]}
        onAllow={() => {}}
        onDecline={() => {}}
      />
      <LiveDataAsk
        title="Prices"
        host="api.example.com"
        urls={['https://api.example.com/prices?coin={coin}']}
        changed
        tainted="This chat read evil.example, which could be trying to steer me."
        onAllow={() => {}}
        onDecline={() => {}}
      />
      <LiveDataAsk
        title="Build status"
        host="localhost:3000"
        urls={['http://localhost:3000/status']}
        local
        onAllow={() => {}}
        onDecline={() => {}}
      />
    </div>
  ),
};

export const WhatPagesMayRead: Story = {
  name: 'What pages may read',
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ display: 'grid', gap: 32, maxInlineSize: 560 }}>
      <LiveDataList
        approvals={[
          { artifactId: 'a_1', title: 'Weather now', host: 'api.open-meteo.com', when: 'Oct 2' },
          { artifactId: 'a_2', title: 'Prices', host: 'api.example.com', when: 'Sep 30' },
          {
            artifactId: 'a_3',
            title: 'Build status',
            host: 'localhost:3000',
            when: 'Sep 28',
            local: true,
          },
        ]}
        onRevoke={() => {}}
        onOpen={() => {}}
      />
      <LiveDataList approvals={[]} onRevoke={() => {}} />
    </div>
  ),
};
