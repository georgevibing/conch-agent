import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { WaitingRow, type WaitingPart } from './WaitingRow';

const at = Date.now();

const jobs = (states: WaitingPart['state'][]): WaitingPart[] =>
  ['lint', 'typecheck', 'server unit', 'web unit', 'nacre', 'e2e', 'build'].map((name, i) => ({
    name,
    state: states[i] ?? 'waiting',
  }));

const meta = {
  title: 'Patterns/Chat/WaitingRow',
  component: WaitingRow,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Something Conch waits for on the assistant’s behalf (ADR 0125): CI, a command, a page, a time. One calm row: what it waits for, how it stands now (a CI run’s jobs as small dots that fill in as they finish, read from GitHub’s cheap status API), how long it’s been and when Conch looks next, with Check now and Stop waiting. No model is called while it waits, and the chat stays free when it “wakes” the chat. Once over, it says how it went in words, and the assistant carries on from there.',
      },
    },
  },
  args: {
    kind: 'ci',
    title: 'CI for conch #482',
    state: 'watching',
    status: '3 of 7 checks done',
    parts: jobs(['passed', 'passed', 'passed', 'running', 'running']),
    startedAt: at - 140_000,
    nextCheckAt: at + 40_000,
    url: 'https://github.com/example/conch/actions/runs/7',
    wakes: true,
    onCheck: () => undefined,
    onStop: () => undefined,
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof WaitingRow>;

export default meta;
type S = StoryObj<typeof meta>;

export const Playground: S = {};

/** Watching CI, the chat free: the jobs fill in as they finish. */
export const WatchingCi: S = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('list', { name: '7 checks' })).toBeInTheDocument();
    await expect(canvas.getByText(/you can keep chatting/)).toBeInTheDocument();
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: /Open on GitHub/ })).toHaveFocus();
  },
};

/** One failed while others still run: a red dot, said in words too. */
export const OneFailedSoFar: S = {
  args: {
    status: '5 of 7 checks done · 1 failed — e2e',
    parts: jobs(['passed', 'passed', 'passed', 'passed', 'running', 'failed', 'waiting']),
    tell: true,
  },
};

/** Over, and red: what failed, in the words the assistant reads too. */
export const CiFailed: S = {
  args: {
    state: 'done',
    tone: 'bad',
    status: 'CI finished: 2 failed — e2e, server unit; 5 passed',
    parts: jobs(['passed', 'passed', 'failed', 'passed', 'passed', 'failed', 'passed']),
    endedAt: at,
    startedAt: at - 9 * 60_000,
    nextCheckAt: undefined,
  },
};

/** Over, and green. */
export const CiPassed: S = {
  args: {
    state: 'done',
    tone: 'good',
    status: 'CI passed: all 7 checks are green',
    parts: jobs(['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed']),
    endedAt: at,
    startedAt: at - 6 * 60_000,
    nextCheckAt: undefined,
  },
};

/** A command of this chat, watched live inside the turn: no clock, no dots. */
export const ACommand: S = {
  args: {
    kind: 'process',
    title: 'pnpm test',
    status: 'Running',
    parts: undefined,
    url: undefined,
    nextCheckAt: undefined,
    wakes: false,
    startedAt: at - 75_000,
  },
};

/** A time: the next look is when it comes. */
export const ATime: S = {
  args: {
    kind: 'time',
    title: '4:30 pm',
    status: 'In 25 min',
    parts: undefined,
    url: undefined,
    nextCheckAt: at + 25 * 60_000,
    startedAt: at - 5 * 60_000,
  },
};

/** Stopped from the row: quiet, and nobody is woken. */
export const Stopped: S = {
  args: {
    state: 'stopped',
    status: 'You stopped waiting',
    endedAt: at,
    nextCheckAt: undefined,
  },
};

/** It took too long. */
export const TimedOut: S = {
  args: {
    state: 'timed-out',
    status: 'Stopped waiting after 1 h: 6 of 7 checks done',
    parts: jobs(['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'waiting']),
    endedAt: at,
    startedAt: at - 60 * 60_000,
    nextCheckAt: undefined,
  },
};

/** Live: jobs finish one by one, then the row says how it went. */
export const Arriving: S = {
  render: function Render(args) {
    const [n, setN] = useState(0);
    useEffect(() => {
      if (n >= 7) return;
      const id = setTimeout(() => setN((v) => v + 1), 900);
      return () => clearTimeout(id);
    }, [n]);
    const states = jobs(
      Array.from({ length: 7 }, (_, i) =>
        i < n ? (i === 5 ? 'failed' : 'passed') : i === n ? 'running' : 'waiting',
      ),
    );
    const over = n >= 7;
    return (
      <WaitingRow
        {...args}
        arriving
        parts={states}
        state={over ? 'done' : 'watching'}
        tone={over ? 'bad' : undefined}
        status={over ? 'CI finished: 1 failed — e2e; 6 passed' : `${n} of 7 checks done`}
        {...(over ? { endedAt: Date.now(), nextCheckAt: undefined } : {})}
      />
    );
  },
};
