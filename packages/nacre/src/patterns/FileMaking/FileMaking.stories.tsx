import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { AttachmentList } from '../Attachments';
import { FileMaking, FileTile, type FileMakingProps } from './FileMaking';

const svg = (body: string, w: number, h: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;

/** A stand-in first page of a PDF: a title, a chart and lines of text. */
const reportPage = svg(
  `<rect width="612" height="792" fill="#fff"/>
<rect x="56" y="64" width="300" height="26" rx="4" fill="#1f2937"/>
<rect x="56" y="104" width="200" height="12" rx="6" fill="#9ca3af"/>
<rect x="56" y="150" width="500" height="200" rx="10" fill="#f3f4f6"/>
<rect x="96" y="250" width="50" height="80" rx="4" fill="#ef4444"/>
<rect x="176" y="210" width="50" height="120" rx="4" fill="#f97316"/>
<rect x="256" y="180" width="50" height="150" rx="4" fill="#f59e0b"/>
<rect x="336" y="230" width="50" height="100" rx="4" fill="#10b981"/>
<rect x="416" y="170" width="50" height="160" rx="4" fill="#3b82f6"/>
${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  .map(
    (i) =>
      `<rect x="56" y="${390 + i * 30}" width="${[500, 480, 490, 310, 500, 470, 500, 260, 490, 420][i]}" height="10" rx="5" fill="#d1d5db"/>`,
  )
  .join('')}`,
  612,
  792,
);

/** A stand-in first slide. */
const firstSlide = svg(
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/>
<rect x="96" y="260" width="620" height="64" rx="10" fill="#fff"/>
<rect x="96" y="352" width="420" height="28" rx="14" fill="#c4b5fd"/>
<circle cx="1000" cy="360" r="170" fill="#a78bfa" opacity=".6"/>`,
  1280,
  720,
);

const markdown = `# Launch plan

A short plan for the spring launch: what ships, who owns it, and when.

## This week
- Finish the onboarding copy
- Record the demo video
- Book the press briefings

> Keep the first screen to one sentence.`;

const csv = `Region,Q1,Q2,Q3,Q4
North,12 400,13 100,14 900,15 200
South,9 800,10 250,11 040,12 300
East,15 600,15 900,16 700,17 950
West,7 200,8 100,8 800,9 400
Online,21 300,24 800,27 100,31 600`;

const html = `<!doctype html><html><head><title>Tip calculator</title><style>body{font:16px system-ui}</style></head>
<body><h1>Split the bill</h1><p>Type the total and how many of you there are.</p><p>Tip: 15%, 18% or 20%.</p><script>alert(1)</script></body></html>`;

const code = `export function split(total: number, people: number, tip = 0.18) {
  const withTip = total * (1 + tip);
  return Math.ceil((withTip / people) * 100) / 100;
}

console.log(split(84.5, 3));`;

const details: FileMakingProps['details'] = [
  { label: 'Made by', value: 'Conch, for you' },
  { label: 'Made with', value: 'Chromium' },
  { label: 'Model', value: 'Claude Sonnet 4.5' },
  { label: 'When', value: 'Today, 14:32' },
  { label: 'Took', value: '1.2s' },
];

const meta = {
  title: 'Patterns/Chat/FileMaking',
  component: FileMaking,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A file being made, then the file: the same family as `ImageMaking`, suited to documents. While it’s made, the file’s own shape draws itself on a slow wash of pearl light: a page’s heading and lines are written in, a sheet’s cells fill in a diagonal wave, slides stack from the back, papers drop into a box for an archive, a window’s blocks settle in for a web page. Round the edge, two arcs of light chase each other; a sheen crosses now and then; a pill says how far it got and the step it’s on (“Laying out pages”), or just turns when it can’t say. It surfaces after a breath, since most files take well under a second. When it’s ready the picture of the file rises out of the light (its first page, its first rows, its first words; or its drawn shape as a cover with its badge), and it rests as a card: the type’s tile, the name, “PDF · 3 pages · 240 KB”, and Look closer, Download, Copy link, Send to… and Details in one row. Every layer bigger than the card is cut by `overflow: hidden`, so it never widens the chat. Not made is a calm line. Reduced motion draws the file whole and still. `FileTile` is the same file, small, on a message.',
      },
    },
  },
  args: {
    state: 'making',
    name: 'Q3 report.pdf',
    mimeType: 'application/pdf',
    kind: 'file',
    size: 248_000,
    pages: 3,
    progress: 0.42,
    stage: 'generating',
    detail: 'Laying out pages',
    by: 'Chromium',
    prompt: 'A one-page summary of the third quarter, with a chart of revenue by region.',
    details,
    thumbnail: reportPage,
    downloadHref: '#',
    onOpen: () => {},
    onCopyLink: () => {},
    onSend: () => {},
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof FileMaking>;

export default meta;
type S = StoryObj<typeof meta>;

export const Playground: S = {};

/** Every type being made: its own shape, drawing itself. */
export const MakingEachType: S = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 24 }}>
      {(
        [
          ['Q3 report.pdf', 'Laying out pages'],
          ['Proposal.docx', 'Writing 4 sections'],
          ['Budget.xlsx', 'Writing 3 sheets'],
          ['Regions.csv', undefined],
          ['Launch deck.pptx', 'Slide 2 of 6'],
          ['Launch plan.md', undefined],
          ['Tip calculator.html', undefined],
          ['split.ts', undefined],
          ['Everything.zip', 'Adding report.pdf'],
          ['Intro.mp3', undefined],
          ['Chart.png', 'Drawing the chart'],
        ] as const
      ).map(([name, detail], i) => (
        <FileMaking
          {...args}
          key={name}
          name={name}
          mimeType={undefined}
          thumbnail={undefined}
          detail={detail}
          progress={detail ? 0.2 + i * 0.06 : undefined}
          stage={detail ? 'generating' : undefined}
        />
      ))}
    </div>
  ),
};

/** Being made, with real steps: the percent climbs, the step changes. */
export const WithProgress: S = {
  render: (args) => {
    const [p, setP] = useState(0.05);
    useEffect(() => {
      const id = setInterval(() => setP((v) => (v >= 0.94 ? 0.05 : v + 0.03)), 500);
      return () => clearInterval(id);
    }, []);
    const page = Math.min(5, 1 + Math.floor(p * 5));
    return (
      <FileMaking
        {...args}
        state="making"
        progress={p}
        stage={p > 0.9 ? 'finishing' : 'generating'}
        detail={p > 0.9 ? 'Making a preview' : `Page ${page} of 5`}
      />
    );
  },
};

/** It can’t say how far it is: the ring turns, no number. */
export const Indeterminate: S = {
  args: { progress: undefined, stage: undefined, detail: undefined, by: undefined },
};

/** Another file of this chat is being made first. */
export const Queued: S = {
  args: { progress: 0, stage: 'queued', detail: undefined },
};

/** It asked first: the light holds still until you answer. */
export const Waiting: S = { args: { waiting: true } };

/** Converting one file to another. */
export const Converting: S = {
  args: { name: 'Proposal.pdf', doing: 'Converting', progress: undefined, stage: 'generating' },
};

/**
 * The moment it lands: made → ready. The first page rises out of the light as
 * the edge light flares once and goes. Press Again to replay.
 */
export const Reveal: S = {
  render: (args) => {
    const [run, setRun] = useState(0);
    const [ready, setReady] = useState(false);
    useEffect(() => {
      setReady(false);
      const id = setTimeout(() => setReady(true), 2400);
      return () => clearTimeout(id);
    }, [run]);
    return (
      <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
        <FileMaking
          key={run}
          {...args}
          state={ready ? 'ready' : 'making'}
          progress={ready ? undefined : 0.94}
          stage="finishing"
          detail="Making a preview"
        />
        <Button size="sm" variant="surface" onClick={() => setRun((r) => r + 1)}>
          Again
        </Button>
      </div>
    );
  },
};

/** Finished, at rest (as after a reload): its first page, its name, what you can do. */
export const Ready: S = {
  args: { state: 'ready' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('button', { name: 'Look closer at Q3 report.pdf' }),
    ).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Download Q3 report.pdf' })).toBeVisible();
    await expect(canvas.getByText('PDF · 3 pages · 242 KB')).toBeVisible();
  },
};

/** Every type, ready: a picture where there is one, the first words, or its cover. */
export const ReadyEachType: S = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 24 }}>
      <FileMaking {...args} state="ready" />
      <FileMaking
        {...args}
        state="ready"
        name="Launch deck.pptx"
        mimeType={undefined}
        pages={undefined}
        slides={6}
        size={1_840_000}
        thumbnail={firstSlide}
      />
      <FileMaking
        {...args}
        state="ready"
        name="Budget.xlsx"
        mimeType={undefined}
        pages={undefined}
        sheets={3}
        size={18_400}
        thumbnail={undefined}
      />
      <FileMaking
        {...args}
        state="ready"
        name="Regions.csv"
        kind="text"
        mimeType="text/csv"
        pages={undefined}
        lines={6}
        size={212}
        thumbnail={undefined}
        excerpt={csv}
      />
      <FileMaking
        {...args}
        state="ready"
        name="Launch plan.md"
        kind="text"
        mimeType="text/markdown"
        pages={undefined}
        lines={11}
        size={290}
        thumbnail={undefined}
        excerpt={markdown}
      />
      <FileMaking
        {...args}
        state="ready"
        name="Tip calculator.html"
        kind="text"
        mimeType="text/html"
        pages={undefined}
        size={1_400}
        thumbnail={undefined}
        excerpt={html}
      />
      <FileMaking
        {...args}
        state="ready"
        name="split.ts"
        kind="text"
        mimeType="text/plain"
        pages={undefined}
        lines={6}
        size={170}
        thumbnail={undefined}
        excerpt={code}
      />
      <FileMaking
        {...args}
        state="ready"
        name="Proposal.docx"
        mimeType={undefined}
        pages={undefined}
        size={38_000}
        thumbnail={undefined}
      />
      <FileMaking
        {...args}
        state="ready"
        name="Everything.zip"
        mimeType="application/zip"
        pages={undefined}
        files={4}
        size={2_400_000}
        thumbnail={undefined}
      />
      <FileMaking
        {...args}
        state="ready"
        name="Intro.mp3"
        mimeType="audio/mpeg"
        pages={undefined}
        size={3_100_000}
        thumbnail={undefined}
      />
      <FileMaking
        {...args}
        state="ready"
        name="Walkthrough.mp4"
        mimeType="video/mp4"
        pages={undefined}
        size={24_000_000}
        thumbnail={undefined}
      />
      <FileMaking
        {...args}
        state="ready"
        name="notes"
        mimeType="application/octet-stream"
        pages={undefined}
        size={900}
        thumbnail={undefined}
      />
    </div>
  ),
};

/** Details open: who made it, with what, when and how long it took. */
export const DetailsOpen: S = {
  args: { state: 'ready' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Details' });
    await userEvent.click(button);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(canvas.getByText('Chromium')).toBeVisible());
  },
};

/** It failed: a calm line with the reason, never a red flood. */
export const Failed: S = {
  args: {
    state: 'failed',
    reason: 'The table had a row with more cells than its header. Ask again with the table fixed.',
  },
};

/** You said no on the question: nothing was made. */
export const Declined: S = { args: { state: 'declined' } };

/** Stopped while it was being made. */
export const Stopped: S = { args: { state: 'stopped' } };

/** Reduced motion: the file drawn whole and still, the edge lit, the percent. */
export const ReducedMotion: S = {
  globals: { motion: 'reduced' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 24 }}>
      <FileMaking {...args} state="making" thumbnail={undefined} />
      <FileMaking {...args} state="making" name="Budget.xlsx" thumbnail={undefined} />
    </div>
  ),
};

/** In the dark (Abalone). */
export const Dark: S = {
  globals: { mode: 'dark' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 24 }}>
      <FileMaking {...args} state="making" thumbnail={undefined} />
      <FileMaking {...args} state="ready" />
      <FileMaking
        {...args}
        state="ready"
        name="Launch plan.md"
        kind="text"
        mimeType="text/markdown"
        pages={undefined}
        size={290}
        thumbnail={undefined}
        excerpt={markdown}
      />
      <FileMaking
        {...args}
        state="ready"
        name="split.ts"
        kind="text"
        pages={undefined}
        size={170}
        thumbnail={undefined}
        excerpt={code}
      />
      <FileMaking {...args} state="failed" reason="Chromium closed before the PDF was saved." />
    </div>
  ),
};

/** On a phone (390 px wide, 16 px either side): names truncate, the actions stay, nothing spills. */
export const Phone: S = {
  decorators: [(Story) => <div style={{ inlineSize: 358, overflow: 'auto' }}>{Story()}</div>],
  render: (args) => (
    <div style={{ display: 'grid', gap: 24 }}>
      <FileMaking {...args} state="making" thumbnail={undefined} />
      <FileMaking
        {...args}
        state="making"
        name="Launch deck with every region and a long name.pptx"
        detail="Slide 4 of 12, with the charts"
        thumbnail={undefined}
      />
      <FileMaking {...args} state="ready" name="Quarterly report for the whole team.pdf" />
      <FileMaking
        {...args}
        state="ready"
        name="Regions.csv"
        kind="text"
        mimeType="text/csv"
        pages={undefined}
        thumbnail={undefined}
        excerpt={csv}
      />
      <FileMaking {...args} state="failed" reason="Chromium closed before the PDF was saved." />
    </div>
  ),
};

/** Files on a message, small: the same glyphs, tints and words as the full card. */
export const Tiles: S = {
  render: () => (
    <AttachmentList label="Attached">
      <FileTile
        role="listitem"
        name="Q3 report.pdf"
        kind="file"
        size={248_000}
        pages={3}
        thumbnail={reportPage}
        onOpen={() => {}}
        downloadHref="#"
      />
      <FileTile
        role="listitem"
        name="Budget.xlsx"
        kind="file"
        size={18_400}
        sheets={3}
        onOpen={() => {}}
        downloadHref="#"
      />
      <FileTile
        role="listitem"
        name="Regions.csv"
        kind="text"
        size={212}
        lines={6}
        onOpen={() => {}}
      />
      <FileTile
        role="listitem"
        name="Everything.zip"
        kind="file"
        size={2_400_000}
        onOpen={() => {}}
        downloadHref="#"
        note="This model can’t open archives"
      />
    </AttachmentList>
  ),
};
