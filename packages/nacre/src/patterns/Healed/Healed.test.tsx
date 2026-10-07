import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { collapseHealed, HealedLog, splitHealed } from './HealedLog';
import { ago, HealedNotes } from './HealedNotes';

describe('HealedNotes', () => {
  it('lists what was fixed, newest first, as a quiet named region', async () => {
    const now = Date.now();
    const { container } = renderNacre(
      <HealedNotes
        notes={[
          { at: now - 10_000, message: 'Search was rebuilt.' },
          { at: now - 3 * 3_600_000, message: 'Notion is answering again.' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'Fixed on its own' });
    expect(region).toHaveTextContent('Search was rebuilt.just now');
    expect(region).toHaveTextContent('Notion is answering again.3 h ago');
    await expectAccessible(container);
  });

  it('says nothing when nothing was fixed', () => {
    renderNacre(<HealedNotes notes={[]} />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByText('Fixed on its own')).toBeNull();
  });

  it('says how long ago in plain words', () => {
    const now = 1_000_000_000;
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 2 * 86_400_000, now)).toBe('2 d ago');
  });
});

describe('HealedLog', () => {
  const now = 10_000_000_000;
  const at = (minutes: number) => now - minutes * 60_000;
  const stuck = (minutes: number) => ({ at: at(minutes), message: 'Stopped a stuck command' });

  it('says how much it fixed this week, and folds repeats into one counted line', async () => {
    const { container } = renderNacre(
      <HealedLog
        now={now}
        notes={[
          stuck(1),
          { at: at(30), message: 'Picked up a chat after a restart' },
          stuck(60),
          stuck(120),
          { at: at(14 * 1440), message: 'Rebuilt search' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'Fixed on its own' });
    expect(region).toHaveTextContent('Conch fixed 4 things this week');
    const lines = within(region).getAllByRole('listitem');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent('Stopped a stuck command');
    expect(lines[0]).toHaveTextContent('3 times, last');
    expect(lines[0]).toHaveTextContent('1 min ago');
    expect(lines[1]).not.toHaveTextContent('times');
    await expectAccessible(container);
  });

  it('shows the latest few, and the rest behind Show all', async () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({ at: at(i), message: `Fix ${i}` }));
    const { container } = renderNacre(<HealedLog now={now} notes={notes} limit={5} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    const more = screen.getByRole('button', { name: 'Show all 8' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expectAccessible(container);
  });

  it('is short and friendly when nothing needed fixing', async () => {
    const { container } = renderNacre(<HealedLog now={now} notes={[]} />);
    expect(screen.getByRole('region', { name: 'Fixed on its own' })).toHaveTextContent(
      'All quietNothing has needed fixing.',
    );
    expect(screen.queryByRole('list')).toBeNull();
    await expectAccessible(container);
  });

  it('calls an older log a quiet week', () => {
    renderNacre(<HealedLog now={now} notes={[{ at: at(10 * 1440), message: 'Rebuilt search' }]} />);
    expect(screen.getByRole('region')).toHaveTextContent('A quiet week');
  });

  it('keeps the latest of a repeat, whatever follows its few words', () => {
    expect(collapseHealed([stuck(5), stuck(1)])).toEqual([
      { at: at(1), message: 'Stopped a stuck command', count: 2 },
    ]);
    expect(
      collapseHealed([
        { at: at(1), message: 'Reconnected Slack. It was out of reach for 5 minutes.' },
        { at: at(9), message: 'Reconnected Slack. It was out of reach for a minute.' },
      ]),
    ).toEqual([
      { at: at(1), message: 'Reconnected Slack. It was out of reach for 5 minutes.', count: 2 },
    ]);
  });

  it('reads the first few words loudest, and what else matters quieter', () => {
    expect(splitHealed('Stopped a heavy command. Its output is kept.')).toEqual({
      head: 'Stopped a heavy command',
      detail: 'Its output is kept.',
    });
    expect(splitHealed('Updated Codex to 0.160.0')).toEqual({ head: 'Updated Codex to 0.160.0' });
  });
});
