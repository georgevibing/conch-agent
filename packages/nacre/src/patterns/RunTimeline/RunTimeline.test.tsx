import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { RunTimeline } from './RunTimeline';

const now = Date.UTC(2025, 9, 16, 12);
const runs = [
  {
    id: 'a',
    status: 'succeeded' as const,
    at: now - 3_600_000,
    trigger: 'schedule' as const,
    outcome: 'Sent your briefing.',
    durationMs: 38_000,
  },
  {
    id: 'b',
    status: 'failed' as const,
    at: now - 26 * 3_600_000,
    trigger: 'catch-up' as const,
    error: 'Claude Code was signed out.',
  },
  {
    id: 'c',
    status: 'missed' as const,
    at: now - 5 * 24 * 3_600_000,
    trigger: 'schedule' as const,
  },
];

describe('RunTimeline', () => {
  it('groups by day with friendly text', async () => {
    const { container } = renderNacre(
      <RunTimeline runs={runs} now={now} timeZone="UTC" onOpen={() => {}} />,
    );
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    expect(screen.getByText('Claude Code was signed out.')).toBeInTheDocument();
    expect(screen.getByText('Caught up after Conch was off')).toBeInTheDocument();
    expect(screen.getByText('Conch wasn’t running at the scheduled time.')).toBeInTheDocument();
    expect(screen.getByText('38s')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('opens runs by click or keyboard', async () => {
    const onOpen = vi.fn();
    renderNacre(<RunTimeline runs={runs} now={now} timeZone="UTC" onOpen={onOpen} />);
    const [first, second] = screen.getAllByRole('button');
    if (first) await userEvent.click(first);
    second?.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen.mock.calls).toEqual([['a'], ['b']]);
  });

  it('has a calm empty state', () => {
    renderNacre(<RunTimeline runs={[]} />);
    expect(screen.getByText('No runs yet. The first one will appear here.')).toBeInTheDocument();
  });
});
