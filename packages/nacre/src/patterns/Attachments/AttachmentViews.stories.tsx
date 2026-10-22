import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { AttachmentPreview, type AttachmentPreviewProps } from './AttachmentPreview';
import type { AttachmentViewData } from './view';

/** Two seconds of quiet, so the recording story needs no network. */
const quiet = (() => {
  const rate = 8000;
  const samples = rate * 2;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
})();

function Demo(props: Omit<AttachmentPreviewProps, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open preview</Button>
      <AttachmentPreview open={open} onOpenChange={setOpen} downloadHref="#" {...props} />
    </>
  );
}

const meta = {
  title: 'Patterns/Chat/Attachments/Previews',
  component: AttachmentPreview,
  args: { open: true, onOpenChange: () => {} },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A closer look at files the browser can’t show by itself. The gateway reads them with the same readers that give models the file (`GET /api/attachments/:id/view`) and sends plain data; Conch draws every part itself, never a file’s own HTML. A document reads as its lines, a workbook as a tab per sheet, an archive as folders you can open, an email as its subject, who and when, its words and what it carried, a recording as its player with what’s said under it (each time plays from there), a database as its tables, and anything else as what it is.',
      },
    },
  },
} satisfies Meta<typeof AttachmentPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

const documentView: AttachmentViewData = {
  summary: 'The text of this document, taken out by Conch.',
  parts: [
    {
      kind: 'text',
      title: 'Paragraphs 1–9',
      blocks: [
        { kind: 'heading', text: 'Board pack: October' },
        {
          kind: 'paragraph',
          text: 'Revenue grew 12 percent on the quarter, led by the new self-serve plan. Churn held at 2.1 percent.',
        },
        { kind: 'heading', text: 'What we ask the board' },
        { kind: 'item', text: 'Approve the Lisbon office lease.' },
        { kind: 'item', text: 'Move the security review to November.' },
        { kind: 'quote', text: 'The best quarter since launch. — Finance' },
        {
          kind: 'paragraph',
          text: '<script>alert("never runs")</script> A file’s markup is only ever shown as words.',
        },
      ],
    },
  ],
};

export const Document: Story = {
  render: () => (
    <Demo
      attachment={{
        name: 'Board pack.odt',
        kind: 'file',
        mimeType: 'application/vnd.oasis.opendocument.text',
        size: 88_000,
      }}
      view={documentView}
    />
  ),
};

const sheet = (title: string, rows: string[][]) => ({
  kind: 'table' as const,
  title,
  columns: Array.from({ length: rows[0]?.length ?? 0 }, (_, i) => String.fromCharCode(65 + i)),
  rows,
  total: rows.length,
});

export const Workbook: Story = {
  render: () => (
    <Demo
      attachment={{ name: 'Forecast 2027.xlsx', kind: 'file', size: 412_000 }}
      view={{
        summary: 'A workbook of 3 sheets.',
        parts: [
          sheet('Summary', [
            ['Region', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'],
            ['North', '1,200', '1,340', '1,480', '1,610', '5,630'],
            ['South', '980', '1,020', '1,110', '1,240', '4,350'],
            ['East', '1,450', '1,500', '1,520', '1,700', '6,170'],
            ['West', '760', '820', '910', '1,050', '3,540'],
          ]),
          sheet('Hiring', [
            ['Team', 'Now', 'Plan'],
            ['Platform', '14', '18'],
          ]),
          sheet('Notes', [['Figures are in thousands of euros.']]),
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole('tab', { name: 'Hiring' }));
    await expect(await page.findByRole('cell', { name: 'Platform' })).toBeVisible();
    await userEvent.click(page.getByRole('tab', { name: 'Summary' }));
  },
};

export const Archive: Story = {
  render: () => (
    <Demo
      attachment={{ name: 'Launch assets.zip', kind: 'file', size: 24_600_000 }}
      view={{
        summary: 'A ZIP archive of 9 files.',
        parts: [
          {
            kind: 'tree',
            entries: [
              { path: 'README.md', size: 2_100 },
              { path: 'press/', folder: true },
              { path: 'press/Release — final.docx', size: 88_000 },
              { path: 'press/Quotes.txt', size: 1_200 },
              { path: 'photos/hero.jpg', size: 4_800_000 },
              { path: 'photos/team.jpg', size: 3_900_000 },
              { path: 'photos/raw/IMG_0412.HEIC', size: 6_100_000 },
              { path: 'logo/conch.svg', size: 6_400 },
              { path: 'logo/conch-dark.svg', size: 6_500 },
            ],
            total: 9,
          },
        ],
      }}
    />
  ),
};

export const Email: Story = {
  render: () => (
    <Demo
      attachment={{ name: 'Re: launch date.eml', kind: 'text', mimeType: 'message/rfc822' }}
      view={{
        parts: [
          {
            kind: 'email',
            headers: [
              { name: 'Subject', value: 'Re: launch date' },
              { name: 'From', value: 'Ada Lovelace <ada@example.com>' },
              { name: 'To', value: 'Grace Hopper <grace@example.com>' },
              { name: 'Cc', value: 'Launch team <launch@example.com>' },
              { name: 'Date', value: 'Tue, 20 Oct 2026 09:14' },
            ],
            body: 'Hi Grace,\n\nThe 4th works for us. I’ve put the press pack and the final deck on this email, and the photos are coming separately.\n\nThanks,\nAda\n\n> On 19 Oct, Grace wrote:\n> Can we move launch to the 4th?',
            attachments: [
              { name: 'Press pack.pdf', size: 2_400_000 },
              { name: 'Launch deck.pptx', size: 9_800_000 },
            ],
          },
        ],
      }}
    />
  ),
};

export const Recording: Story = {
  render: () => (
    <Demo
      attachment={{ name: 'Interview.wav', kind: 'file', mimeType: 'audio/wav', size: 6_200_000 }}
      src={quiet}
      view={{
        summary: 'A recording, 21 minutes long.',
        parts: [
          {
            kind: 'facts',
            facts: [
              { label: 'Title', value: 'Customer interview: Lisbon' },
              { label: 'Date', value: '2026-10-14' },
            ],
          },
          {
            kind: 'transcript',
            segments: [
              {
                start: 0,
                text: 'Thanks for making the time. Could you start with how you use it today?',
              },
              {
                start: 600,
                text: 'Mostly on my phone, between meetings. I paste the email in and ask what I owe whom.',
              },
              { start: 1200, text: 'The voice notes are the part I didn’t expect to love.' },
            ],
          },
        ],
      }}
    />
  ),
};

export const RecordingBeingHeard: Story = {
  render: () => (
    <Demo
      attachment={{ name: 'Standup.wav', kind: 'file', mimeType: 'audio/wav', size: 1_200_000 }}
      src={quiet}
      viewLoading
    />
  ),
};

export const Database: Story = {
  render: () => (
    <Demo
      attachment={{
        name: 'orders.sqlite',
        kind: 'file',
        mimeType: 'application/vnd.sqlite3',
        size: 3_200_000,
      }}
      view={{
        summary: 'A SQLite database with 2 tables.',
        parts: [
          {
            kind: 'table',
            title: 'orders',
            columns: ['id', 'customer', 'total', 'placed_at'],
            rows: [
              ['1', 'Ada', '42.00', '2026-10-01'],
              ['2', 'Grace', '18.50', '2026-10-02'],
              ['3', 'Katherine', '96.10', '2026-10-02'],
            ],
            total: 18_204,
          },
          {
            kind: 'table',
            title: 'customers',
            columns: ['id', 'name', 'city'],
            rows: [
              ['1', 'Ada', 'London'],
              ['2', 'Grace', 'New York'],
            ],
            total: 2,
          },
        ],
      }}
    />
  ),
};

export const Program: Story = {
  render: () => (
    <Demo
      attachment={{
        name: 'Setup.exe',
        kind: 'file',
        mimeType: 'application/vnd.microsoft.portable-executable',
        size: 8_400_000,
      }}
      view={{ summary: 'A Windows program for 64-bit Intel and AMD processors.', parts: [] }}
    />
  ),
};

export const ProgramWithFacts: Story = {
  render: () => (
    <Demo
      attachment={{ name: 'libsodium.dylib', kind: 'file', size: 412_000 }}
      view={{
        summary: 'A macOS library.',
        parts: [
          {
            kind: 'facts',
            facts: [
              { label: 'Kind', value: 'Mach-O shared library' },
              { label: 'Built for', value: 'Apple silicon (arm64)' },
              { label: 'Signed', value: 'No' },
            ],
          },
        ],
      }}
    />
  ),
};

const notebook = JSON.stringify({
  metadata: { language_info: { name: 'python' } },
  cells: [
    { cell_type: 'markdown', source: ['# Churn by plan\n', 'Monthly churn, **last 12 months**.'] },
    {
      cell_type: 'code',
      source:
        "import pandas as pd\nchurn = pd.read_csv('churn.csv')\nchurn.groupby('plan').rate.mean()",
      outputs: [
        {
          output_type: 'execute_result',
          data: { 'text/plain': 'plan\nfree    0.041\npro     0.012' },
        },
      ],
    },
    {
      cell_type: 'code',
      source: 'churn.plot()',
      outputs: [{ output_type: 'display_data', data: { 'image/png': 'iVBOR…' } }],
    },
  ],
});

export const Notebook: Story = {
  render: () => (
    <Demo
      attachment={{ name: 'churn.ipynb', kind: 'text', lines: 60, size: 4_800 }}
      text={notebook}
    />
  ),
};

export const Loading: Story = {
  render: () => (
    <Demo attachment={{ name: 'Board pack.docx', kind: 'file', size: 88_000 }} viewLoading />
  ),
};

/** Nothing could read it: what it is, its facts, and the download. */
export const NothingReadsIt: Story = {
  render: () => (
    <Demo
      attachment={{ name: 'Bracket.stl', kind: 'file', mimeType: 'model/stl', size: 760_000 }}
      view={null}
    />
  ),
};
