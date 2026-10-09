import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { ApprovalCard } from '../Approval';
import { asked, callsFor, invoiceResult, invoiceScript, sendScript, tallyFor } from './fixtures';
import { ScriptRun, type ScriptRunProps } from './ScriptRun';

const meta = {
  title: 'Patterns/Chat/ScriptRun',
  component: ScriptRun,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A script the assistant wrote to call its tools (ADR 0123), told as one story instead of hundreds of rows. While it runs: what it’s for, a hairline that fills as it says how far it is, the live line with Stop, and a counter for each kind of call that turns as the calls go. A question it waits on sits right under its line. Once over: what it came to, in the script’s own last note, with Undo for everything it changed. Open it for the script, every call grouped by tool (each opening to its input and output), the questions it asked, and what it gave back.',
      },
    },
  },
  args: {
    title: 'Tag the invoices among my last 300 emails',
    headline: 'Tagged 47 invoices among 300 emails',
    state: 'done',
    script: invoiceScript,
    tally: tallyFor(300, 47),
    calls: callsFor(300, 47),
    result: invoiceResult,
    durationMs: 12_400,
    changes: { count: 47, onUndo: () => undefined },
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof ScriptRun>;

export default meta;
type S = StoryObj<typeof meta>;
const base = meta.args as ScriptRunProps;

export const Playground: S = {};

/** At work: the hairline fills, the counters turn, the live line says the latest note. */
export const Running: S = {
  args: {
    state: 'running',
    headline: undefined,
    live: 'Tagged 12 invoices so far',
    progress: { done: 120, total: 300, label: 'emails' },
    tally: tallyFor(120, 12, true),
    calls: callsFor(120, 12, true),
    startedAt: Date.now() - 4_200,
    durationMs: undefined,
    result: undefined,
    changes: undefined,
    onStop: () => undefined,
  },
};

/** It waits on you: the question for step 48 sits under its line, naming the script and the call. */
export const ApprovalWaiting: S = {
  args: {
    title: 'Remind everyone with an unpaid invoice',
    state: 'running',
    headline: undefined,
    script: sendScript,
    live: 'Sending reminders',
    progress: { done: 47, total: 61, label: 'reminders' },
    tally: [
      {
        tool: 'google_mail_send',
        label: 'Sent an email',
        family: 'ship',
        calls: 47,
        running: 1,
        declined: 1,
      },
      { tool: 'google_mail_search', label: 'Searched your email', family: 'explore', calls: 1 },
    ],
    calls: undefined,
    asks: asked,
    startedAt: Date.now() - 31_000,
    durationMs: undefined,
    result: undefined,
    changes: undefined,
    onStop: () => undefined,
    approval: (
      <ApprovalCard
        title="Send 1 email to noreply@shop.example"
        detail="Step 48 of the script · Remind everyone with an unpaid invoice"
        caution="This chat read your email. Check this is what you asked for."
        allowAlways={false}
        onDecide={() => undefined}
      />
    ),
  },
};

/** Finished: what it came to, its calls in all, how long it worked, and Undo for all of it. */
export const Done: S = {};

/** Opened: the script, the calls by kind, what it gave back. */
export const Opened: S = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('What it called')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /Labelled an email/ }));
    await expect(canvas.getAllByText(/^#\d+$/).length).toBeGreaterThan(0);
  },
};

/** It didn’t finish: a warm note, the line it stopped at, and what it did before. */
export const Failed: S = {
  args: {
    state: 'failed',
    headline: undefined,
    tally: [
      { tool: 'google_mail_read', label: 'Read an email', family: 'explore', calls: 18, failed: 1 },
      { tool: 'google_mail_search', label: 'Searched your email', family: 'explore', calls: 1 },
    ],
    calls: callsFor(18, 0),
    error: 'Line 4: TypeError: Cannot read properties of undefined (reading ’subject’)',
    result:
      'The script stopped at line 4 with TypeError: Cannot read properties of undefined (reading ’subject’)\n\n19 tool calls: google_mail_read ×18 (1 failed), google_mail_search ×1 · 2.1 s of work.',
    durationMs: 2_100,
    changes: undefined,
    defaultOpen: true,
  },
};

/** Stopped by you: neutral, never a failure; what it changed can still be put back. */
export const Stopped: S = {
  args: {
    state: 'stopped',
    headline: undefined,
    tally: tallyFor(86, 9),
    calls: callsFor(86, 9),
    result: 'It was stopped before it finished: the person pressed Stop, or the turn ended.',
    durationMs: 4_800,
    changes: { count: 9, onUndo: () => undefined },
  },
};

/** Undone: every change it made is back as it was, with a way to put them back again. */
export const Undone: S = {
  args: { changes: { count: 47, undone: true, onRedo: () => undefined } },
};

/** Two thousand calls: one line still, the calls folded by kind, the latest few in reach. */
export const ManyCalls: S = {
  args: {
    title: 'Rename every photo by the date it was taken',
    headline: 'Renamed 1,912 photos by the date they were taken',
    script: `const photos = await tools.search_files({ name: '*.jpg', path: 'Pictures' });
for (const photo of photos.files) {
  const taken = await tools.Bash({ command: \`exiftool -d %Y-%m-%d -DateTimeOriginal -s3 "\${photo}"\` });
  await tools.Bash({ command: \`mv -n "\${photo}" "Pictures/\${taken.trim()} \${photo.split('/').pop()}"\` });
}
note(\`Renamed \${photos.files.length} photos by the date they were taken\`);`,
    tally: [
      { tool: 'Bash', label: 'Ran a command', family: 'run', calls: 3_824 },
      { tool: 'search_files', label: 'Looked for files', family: 'explore', calls: 1 },
    ],
    calls: Array.from({ length: 60 }, (_, i) => ({
      id: `b${i}`,
      step: 3_765 + i,
      tool: 'Bash',
      summary: i % 2 ? 'mv -n IMG_…' : 'exiftool -d %Y-%m-%d …',
      status: 'success' as const,
      input: '{"command":"exiftool -d %Y-%m-%d -DateTimeOriginal -s3 \\"Pictures/IMG_2041.jpg\\""}',
      output: '2026-07-14',
      durationMs: 90,
    })),
    callCount: 3_825,
    durationMs: 96_000,
    changes: { count: 1_912, onUndo: () => undefined },
    result:
      'It logged:\n… 1,912 more lines not shown.\n\n3,825 tool calls: Bash ×3,824, search_files ×1 · 96.0 s of work.',
  },
};

/** A live run, start to end: the counters turn, the bar fills, then it lands. */
export const Live: S = {
  render: (args) => <LiveRun {...args} />,
  args: { state: 'running', onStop: () => undefined },
};

function LiveRun(args: ScriptRunProps) {
  const [n, setN] = useState(0);
  const [startedAt] = useState(() => Date.now());
  useEffect(() => {
    if (n >= 300) return;
    const t = setTimeout(() => setN((x) => Math.min(300, x + 6)), 60);
    return () => clearTimeout(t);
  }, [n]);
  const tags = Math.floor(n / 6.4);
  const done = n >= 300;
  return (
    <ScriptRun
      {...base}
      {...args}
      arriving
      state={done ? 'done' : 'running'}
      live={`Tagged ${tags} invoices so far`}
      progress={{ done: n, total: 300, label: 'emails' }}
      tally={tallyFor(n, tags, !done)}
      calls={callsFor(Math.min(n, 40), Math.min(tags, 6), !done)}
      callCount={n + tags + 1}
      startedAt={startedAt}
      {...(done
        ? {
            durationMs: 300 * 60,
            headline: `Tagged ${tags} invoices among 300 emails`,
          }
        : {})}
    />
  );
}
