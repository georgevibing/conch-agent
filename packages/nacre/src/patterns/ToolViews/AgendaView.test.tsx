import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AgendaView, type AgendaEvent } from './AgendaView';

const now = Date.UTC(2026, 9, 3, 12, 0); // Saturday 3 October 2026, noon UTC
const base = { now, timeZone: 'UTC', locale: 'en-GB' };
const events: AgendaEvent[] = [
  { title: 'Offsite', start: '2026-10-03', end: '2026-10-05', allDay: true, color: '#33b679' },
  {
    title: 'Standup',
    start: '2026-10-03T09:30:00Z',
    end: '2026-10-03T09:45:00Z',
    call: true,
    url: 'https://calendar.example.org/e/1',
  },
  {
    title: 'Design review',
    start: '2026-10-03T14:00:00Z',
    end: '2026-10-03T15:00:00Z',
    location: 'Room 4',
  },
];

describe('AgendaView', () => {
  it('draws each day asked about, with Free for an empty one', async () => {
    const { container } = renderNacre(
      <AgendaView
        {...base}
        events={events}
        from="2026-10-03T00:00:00Z"
        to="2026-10-06T00:00:00Z"
      />,
    );
    expect(screen.getByRole('region', { name: 'Calendar, 3 events' })).toBeInTheDocument();
    const today = screen.getByRole('region', { name: 'Today, Sat 3 Oct' });
    const tomorrow = screen.getByRole('region', { name: 'Tomorrow, Sun 4 Oct' });
    const monday = screen.getByRole('region', { name: 'Monday, Mon 5 Oct' });
    // The all-day event covers Saturday and Sunday (its end is exclusive), in a band.
    expect(within(today).getByRole('list', { name: 'All day' })).toHaveTextContent('Offsite');
    expect(within(tomorrow).getByRole('list', { name: 'All day' })).toHaveTextContent('Offsite');
    expect(within(monday).getByText('Free')).toBeInTheDocument();
    expect(within(today).getByText('09:30')).toBeInTheDocument();
    expect(within(today).getByRole('img', { name: 'Video call' })).toBeInTheDocument();
    expect(within(today).getByText('Room 4')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it.each([
    ['en-US', '9:30 AM', '12'],
    ['en-GB', '09:30', '24'],
  ])('writes times the way %s does', (locale, time, clock) => {
    const { container } = renderNacre(<AgendaView {...base} locale={locale} events={events} />);
    expect(screen.getByText(time)).toBeInTheDocument();
    expect(container.querySelector(`[data-clock="${clock}"]`)).not.toBeNull();
  });

  it('shows where now is today, and dims what’s past', () => {
    const { container } = renderNacre(<AgendaView {...base} events={events} />);
    const rows = [...container.querySelectorAll('ul:not([aria-label]) > li')];
    // Standup (past), now, Design review.
    expect(rows.map((r) => r.textContent || 'now')).toEqual([
      expect.stringContaining('Standup'),
      'now',
      expect.stringContaining('Design review'),
    ]);
    expect(rows[0]).toHaveAttribute('data-past');
    expect(rows[2]).not.toHaveAttribute('data-past');
  });

  it('opens an event in a new tab that knows nothing of Conch, and never a link that isn’t a web link', () => {
    renderNacre(
      <AgendaView
        {...base}
        events={[
          ...events,
          { title: 'Sneaky', start: '2026-10-03T16:00:00Z', url: 'javascript:alert(1)' },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: 'Standup, 09:30 to 09:45, video call' });
    expect(link).toHaveAttribute('href', 'https://calendar.example.org/e/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: /Sneaky/ })).toBeNull();
    expect(screen.getByText('Sneaky')).toBeInTheDocument();
  });

  it('draws titles as text, never markup', () => {
    renderNacre(
      <AgendaView {...base} events={[{ title: '<b>bold</b>', start: '2026-10-03T16:00:00Z' }]} />,
    );
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
  });

  it('folds a busy window after six rows, and shows the rest from the keyboard', async () => {
    const busy: AgendaEvent[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Meeting ${i + 1}`,
      start: `2026-10-03T${String(8 + i).padStart(2, '0')}:00:00Z`,
    }));
    renderNacre(<AgendaView {...base} events={busy} />);
    expect(screen.queryByText('Meeting 7')).toBeNull();
    const more = screen.getByRole('button', { name: 'Show all 10 events' });
    more.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Meeting 10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('says so when there’s nothing to show', () => {
    renderNacre(<AgendaView {...base} events={[]} />);
    expect(screen.getByText('Nothing on the calendar.')).toBeInTheDocument();
  });
});
