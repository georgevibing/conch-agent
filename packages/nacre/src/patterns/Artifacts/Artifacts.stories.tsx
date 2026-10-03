import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { ArtifactCard } from './ArtifactCard';
import { ArtifactChart, type ChartData } from './ArtifactChart';
import { ArtifactPanel } from './ArtifactPanel';
import { ArtifactTable } from './ArtifactTable';
import { SealedFrame } from './SealedFrame';

/** A page as a data URL; the trailing comment swallows any query the frame adds. */
const page = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}<!--`;

const tipCalculator = page(`<!doctype html><html><body style="font:15px system-ui;margin:16px">
<h2 style="margin:0 0 12px">Tip calculator</h2>
<label>Bill <input id="bill" type="number" value="48" style="width:6em"></label>
<label style="margin-left:12px">Tip <input id="tip" type="range" min="0" max="30" value="18"></label>
<p id="out" style="font-size:22px;font-weight:600"></p>
<script>
function f(){var b=+bill.value,t=+tip.value;out.textContent='Tip '+(b*t/100).toFixed(2)+' · Total '+(b*(1+t/100)).toFixed(2)}
bill.oninput=tip.oninput=f;f();
</script></body></html>`);

const week: ChartData = {
  type: 'bar',
  title: 'Visitors this week',
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  series: [
    { name: 'This week', values: [1200, 1480, 1310, 1720, 1650, 980, 870] },
    { name: 'Last week', values: [1100, 1250, 1400, 1500, 1420, 1010, 760] },
  ],
};

const budget = `Item,Monthly,Yearly
Rent,1200,14400
Food,420,5040
Transport,95,1140
Phone,25,300
Fun,150,1800`;

const meta = {
  title: 'Patterns/Show me/ArtifactPanel',
  component: ArtifactPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Something the assistant made, beside the chat (ADR 0034): the thing itself, its code, and what changed since the version before. Every version is kept; copy it, download it, pin it as an app, or open it full screen. The chrome stays quiet so what was made is the loudest thing on screen.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          blockSize: '100vh',
          maxInlineSize: 640,
          marginInlineStart: 'auto',
          borderInlineStart: '1px solid var(--nc-border-subtle)',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Visitors this week',
    kind: 'chart',
    version: 2,
    versions: [
      { n: 1, when: 'Today, 9:40 AM' },
      { n: 2, when: 'Today, 9:41 AM', note: 'Added last week to compare' },
    ],
    preview: <ArtifactChart chart={week} />,
    source: JSON.stringify(week, null, 2),
    previous: JSON.stringify({ ...week, series: week.series.slice(0, 1) }, null, 2),
    downloadHref: '#',
    pinned: false,
    onClose: () => {},
  },
} satisfies Meta<typeof ArtifactPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function Render(args) {
    const [pinned, setPinned] = useState(args.pinned);
    const [version, setVersion] = useState(args.version);
    return (
      <ArtifactPanel
        {...args}
        version={version}
        onVersionChange={setVersion}
        pinned={pinned}
        onPinnedChange={setPinned}
        onRefresh={pinned ? () => {} : undefined}
        onDelete={() => {}}
      />
    );
  },
};

export const Changes: Story = { args: { defaultView: 'changes' } };

export const Code: Story = { args: { defaultView: 'source' } };

export const Page: Story = {
  args: {
    title: 'Tip calculator',
    kind: 'html',
    version: 1,
    versions: [{ n: 1, when: 'Today, 9:40 AM' }],
    preview: <SealedFrame src={tipCalculator} title="Tip calculator" initialHeight={200} />,
    source: '<h2>Tip calculator</h2>…',
    previous: undefined,
  },
};

export const PageWithItsCodeOff: Story = {
  name: 'Page with its code off',
  args: {
    title: 'Links out',
    kind: 'html',
    version: 1,
    versions: [{ n: 1, when: 'Today, 9:40 AM' }],
    preview: (
      <SealedFrame
        src={page(
          '<p style="font:15px system-ui">A page with a link to <a href="https://example.com">example.com</a>.</p>',
        )}
        title="Links out"
        navigates
        onAllowScripts={() => {}}
        initialHeight={120}
      />
    ),
    source: '<a href="https://example.com">…</a>',
    previous: undefined,
  },
};

export const Table: Story = {
  args: {
    title: 'Budget',
    kind: 'table',
    version: 1,
    versions: [{ n: 1, when: 'Today, 9:40 AM' }],
    preview: <ArtifactTable csv={budget} label="Budget, as a table" />,
    source: budget,
    previous: undefined,
  },
};

export const RefreshingAPinnedApp: Story = {
  name: 'Refreshing a pinned app',
  args: {
    pinned: true,
    refreshing: true,
    standalone: true,
    onRefresh: () => {},
    onPinnedChange: () => {},
  },
};

export const Card: Story = {
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 12, maxInlineSize: 480 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <ArtifactCard title="Tip calculator" kind="html" version={1} />
      <ArtifactCard
        title="Visitors this week"
        kind="chart"
        version={2}
        action="updated"
        note="Added last week"
        active
      />
      <ArtifactCard title="Budget" kind="table" version={1} pinned />
      <ArtifactCard title="Trip plan" kind="markdown" version={3} action="updated" />
      <ArtifactCard title="How sign-in works" kind="mermaid" version={1} />
    </>
  ),
};

/**
 * A chart, a table or a picture shows a small preview in its card, so the
 * chat says what was made without opening anything. Only to look at:
 * pressing anywhere opens it beside the chat.
 */
export const CardWithPreview: Story = {
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 12, maxInlineSize: 480 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <ArtifactCard
        title="Visitors this week"
        kind="chart"
        version={1}
        preview={<ArtifactChart chart={week} height={116} compact />}
      />
      <ArtifactCard
        title="Budget"
        kind="table"
        version={2}
        action="updated"
        note="Added a total"
        preview={<ArtifactTable csv={budget} label="Budget" maxRows={5} compact />}
      />
    </>
  ),
};

export const Charts: Story = {
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 32, maxInlineSize: 640 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <ArtifactChart chart={week} />
      <ArtifactChart chart={{ ...week, type: 'line', title: 'Visitors, by day' }} />
      <ArtifactChart
        chart={{ ...week, type: 'area', stacked: true, title: 'Visitors, both weeks together' }}
      />
      <ArtifactChart
        chart={{
          type: 'pie',
          title: 'Where the money goes',
          labels: ['Rent', 'Food', 'Transport', 'Phone', 'Fun'],
          series: [{ name: 'Monthly', values: [1200, 420, 95, 25, 150] }],
          unit: '€',
        }}
      />
      <ArtifactChart chart={week} defaultView="table" />
    </>
  ),
};
