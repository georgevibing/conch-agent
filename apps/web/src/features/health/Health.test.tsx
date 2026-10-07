import type { DoctorItem, HealNote } from '@conch/protocol';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { HealedSection } from '../settings/HealedSection';
import { RepairSection } from './RepairSection';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const item = (patch: Partial<DoctorItem> & Pick<DoctorItem, 'id' | 'group'>): DoctorItem => ({
  title: patch.id,
  state: 'ok',
  message: 'Working.',
  ...patch,
});

const report = (items: DoctorItem[]) => ({ items, checkedAt: Date.now(), running: false });

describe('Repair everything', () => {
  it('folds each working group into one line, and opens the one that needs you', async () => {
    mockFetch({
      'GET /api/doctor': () =>
        report([
          item({ id: 'Notion', group: 'Apps' }),
          item({ id: 'GitHub', group: 'Apps' }),
          item({
            id: 'Disk space',
            group: 'This computer',
            state: 'warning',
            message: 'Almost full.',
            action: { kind: 'open', label: 'Open This computer', place: 'health' },
          }),
          item({
            id: 'Search',
            group: 'This computer',
            state: 'warning',
            message: 'Out of date.',
            repairable: true,
          }),
          item({
            id: 'Telegram',
            group: 'Talk to me here',
            state: 'off',
            message: 'Not set up.',
          }),
        ]),
    });
    renderApp(<RepairSection />);
    expect(await screen.findByText('2 things to look at')).toBeInTheDocument();
    const apps = screen.getByRole('button', { name: /^Apps/ });
    expect(apps).toHaveTextContent('2 working');
    expect(apps).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Talk to me here/ })).toHaveTextContent('Off');
    const computer = screen.getByRole('button', { name: /^This computer/ });
    expect(computer).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: /^This computer/ });
    // A warning carries its one button, beside it.
    expect(within(region).getByRole('button', { name: 'Open This computer' })).toBeVisible();
    // What a repair fixes offers it right there.
    expect(within(region).getByRole('button', { name: 'Repair' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Repair everything' })).toHaveAttribute(
      'data-variant',
      'solid',
    );
  });

  it('remembers a group someone opened, for the rest of the visit', async () => {
    mockFetch({ 'GET /api/doctor': () => report([item({ id: 'Notion', group: 'Apps' })]) });
    const first = renderApp(<RepairSection />);
    expect(await screen.findByText('Everything’s working')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Apps/ }));
    first.unmount();
    renderApp(<RepairSection />);
    expect(await screen.findByRole('button', { name: /^Apps/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('Fixed on its own', () => {
  const note = (id: string, message: string, minutes: number): HealNote => ({
    id,
    at: Date.now() - minutes * 60_000,
    area: 'gateway',
    message,
  });

  it('counts the week and folds the same repair into one line', async () => {
    mockFetch({
      'GET /api/healed': () => ({
        notes: [
          note('a', 'Stopped a stuck command', 1),
          note('b', 'Stopped a stuck command', 30),
          note('c', 'Picked up a chat after a restart', 60),
          note('d', 'Stopped a stuck command', 90),
        ],
      }),
    });
    renderApp(<HealedSection />);
    const region = await screen.findByRole('region', { name: 'Fixed on its own' });
    expect(region).toHaveTextContent('Conch fixed 4 things this week');
    const lines = within(region).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('Stopped a stuck command');
    expect(lines[0]).toHaveTextContent('3 times');
  });

  it('is one friendly line when nothing needed fixing', async () => {
    mockFetch({ 'GET /api/healed': () => ({ notes: [] }) });
    renderApp(<HealedSection />);
    expect(await screen.findByText('All quiet')).toBeInTheDocument();
  });
});
