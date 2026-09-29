import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { RoutineCard } from './RoutineCard';

const now = Date.UTC(2025, 9, 16, 8);
const base = {
  title: 'Morning briefing',
  summary: 'A short summary of today’s calendar, weather and top news.',
  scheduleText: 'Weekdays at 7:30 AM',
  now,
  timeZone: 'UTC',
};

describe('RoutineCard (list)', () => {
  it('shows schedule, next run and last outcome accessibly', async () => {
    const { container } = renderNacre(
      <RoutineCard
        {...base}
        status="active"
        nextRunAt={now + 24 * 3_600_000}
        lastRun={{ status: 'succeeded', at: now - 2 * 3_600_000, outcome: 'Sent your briefing.' }}
        onOpen={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('Weekdays at 7:30 AM')).toBeInTheDocument();
    expect(screen.getByText('Next tomorrow at 8:00 AM')).toBeInTheDocument();
    expect(screen.getByText(/Sent your briefing\./)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('opens from the title and toggles without opening', async () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    renderNacre(<RoutineCard {...base} status="active" onOpen={onOpen} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Pause Morning briefing' }));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onOpen).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Morning briefing' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('highlights runs that need you', () => {
    const { container } = renderNacre(
      <RoutineCard
        {...base}
        status="active"
        lastRun={{ status: 'needs-you', at: now - 60_000, outcome: 'Wants to move 14 files.' }}
      />,
    );
    expect(container.querySelector('[data-attention]')).not.toBeNull();
    expect(screen.getByText('Needs you')).toBeInTheDocument();
  });

  it('says when it is paused', () => {
    renderNacre(<RoutineCard {...base} status="paused" onToggle={() => {}} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Turn on Morning briefing' })).not.toBeChecked();
  });
});

describe('RoutineCard (proposal)', () => {
  it('offers turn on, try now, edit and not now', async () => {
    const handlers = {
      onActivate: vi.fn(),
      onTryNow: vi.fn(),
      onEdit: vi.fn(),
      onDismiss: vi.fn(),
    };
    const { container } = renderNacre(
      <RoutineCard
        {...base}
        variant="proposal"
        status="draft"
        nextRunAt={now + 24 * 3_600_000}
        {...handlers}
      />,
    );
    expect(screen.getByText('New routine')).toBeInTheDocument();
    expect(screen.getByText(/first run tomorrow at 8:00 AM/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await userEvent.click(screen.getByRole('button', { name: 'Try it now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    for (const fn of Object.values(handlers)) expect(fn).toHaveBeenCalledTimes(1);
    await expectAccessible(container);
  });

  it('settles into a calm confirmed state once on', () => {
    renderNacre(
      <RoutineCard
        {...base}
        variant="proposal"
        status="active"
        nextRunAt={now + 3_600_000}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('Routine on')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });
});
