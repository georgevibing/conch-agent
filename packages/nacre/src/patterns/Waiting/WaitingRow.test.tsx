import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { WaitingRow, waitingHeadline, type WaitingRowProps } from './WaitingRow';

const now = Date.now();
const watching: WaitingRowProps = {
  kind: 'ci',
  title: 'CI for conch #482',
  state: 'watching',
  status: '2 of 3 checks done',
  parts: [
    { name: 'lint', state: 'passed' },
    { name: 'server unit', state: 'passed' },
    { name: 'e2e', state: 'running' },
  ],
  startedAt: now - 140_000,
  nextCheckAt: now + 40_000,
  url: 'https://github.com/o/conch/actions/runs/7',
  wakes: true,
};

describe('WaitingRow', () => {
  it('says what it waits for, how it stands, and that the chat is free', async () => {
    const { container } = renderNacre(
      <WaitingRow {...watching} onCheck={() => {}} onStop={() => {}} />,
    );
    expect(screen.getByText('Waiting for CI for conch #482')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 checks done')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '3 checks' })).toBeInTheDocument();
    expect(screen.getByText('e2e, running')).toBeInTheDocument();
    expect(screen.getByText(/next look in 4\d s · you can keep chatting/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open on GitHub/ })).toHaveAttribute(
      'rel',
      'noreferrer noopener',
    );
    await expectAccessible(container);
  });

  it('Check now and Stop waiting work from the keyboard', async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn();
    const onStop = vi.fn();
    renderNacre(<WaitingRow {...watching} url={undefined} onCheck={onCheck} onStop={onStop} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Check now' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard(' ');
    expect(onCheck).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('once over, says how it went in words, without the buttons', async () => {
    const { container } = renderNacre(
      <WaitingRow
        {...watching}
        state="done"
        tone="bad"
        status="CI finished: 1 failed — e2e; 2 passed"
        parts={[
          { name: 'lint', state: 'passed' },
          { name: 'server unit', state: 'passed' },
          { name: 'e2e', state: 'failed' },
        ]}
        endedAt={now}
        nextCheckAt={undefined}
        onCheck={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.getByText('Waited for CI for conch #482')).toBeInTheDocument();
    expect(screen.getByText('CI finished: 1 failed — e2e; 2 passed')).toHaveAttribute(
      'data-tone',
      'bad',
    );
    expect(screen.getByRole('list', { name: '3 checks, 1 failed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop waiting' })).not.toBeInTheDocument();
    expect(screen.getByText(/took 2m 20s/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('a command is watched live, so there is no next look', () => {
    renderNacre(
      <WaitingRow
        kind="process"
        title="pnpm test"
        onCheck={() => {}}
        state="watching"
        status="Running"
        startedAt={now}
      />,
    );
    expect(screen.getByText('watching live')).toBeInTheDocument();
    // Seen as it changes: there's nothing for Check now to do.
    expect(screen.queryByRole('button', { name: 'Check now' })).not.toBeInTheDocument();
  });

  it('words every ending', () => {
    expect(waitingHeadline('time', 'watching', '4:30 pm')).toBe('Waiting until 4:30 pm');
    expect(waitingHeadline('ci', 'timed-out', 'CI')).toBe('Gave up waiting for CI');
    expect(waitingHeadline('url', 'stopped', 'example.com')).toBe(
      'Stopped waiting for example.com',
    );
    expect(waitingHeadline('ci', 'failed', 'CI')).toBe('Couldn’t watch CI');
  });
});
