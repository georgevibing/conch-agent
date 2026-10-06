import type { ComputerSample, ComputerStatus } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { Settings } from '../settings/Settings';
import { ComputerTab } from './ComputerTab';
import { duration, memory, percent, rate, statusOf } from './words';

afterEach(() => vi.unstubAllGlobals());

const violations = async (container: HTMLElement) =>
  (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations;

const GiB = 1024 ** 3;

function sample(at: number, patch: Partial<ComputerSample> = {}): ComputerSample {
  return {
    at,
    cpu: 18,
    cores: [30, 6],
    load: 2.4,
    memory: { usedBytes: 20 * GiB, totalBytes: 36 * GiB },
    room: 'healthy',
    disk: { usedBytes: 140e9, totalBytes: 494e9 },
    network: { inPerSecond: 1_200_000, outPerSecond: 50_000 },
    graphics: { percent: 7, memoryUsedBytes: 1.1 * GiB },
    battery: { percent: 100, state: 'charged' },
    conch: { cpu: 0.4, memoryBytes: 93 * 1024 * 1024 },
    helpers: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        processes: 3,
        cpu: 4.2,
        memoryBytes: 412 * 1024 * 1024,
      },
      { id: 'browser', label: 'Browser', processes: 1, cpu: 2, memoryBytes: GiB },
    ],
    ...patch,
  };
}

function status(patch: Partial<ComputerStatus> = {}): ComputerStatus {
  return {
    info: {
      os: 'mac',
      system: 'macOS 26.7',
      processor: 'Apple M3 Pro',
      cores: 2,
      memoryBytes: 36 * GiB,
      graphics: 'Apple M3 Pro',
    },
    uptimeSeconds: 3 * 86_400 + 60,
    conchUptimeSeconds: 7200,
    intervalMs: 2000,
    samples: [sample(1000), sample(3000), sample(5000)],
    ...patch,
  };
}

describe('Settings → This computer', () => {
  it('says how the computer is doing, at a glance and over the last minutes', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/computer': () => status() });
    const { container } = renderApp(<ComputerTab />);

    expect(await screen.findByRole('heading', { name: 'Room to spare' })).toBeInTheDocument();
    expect(screen.getByText('macOS 26.7')).toBeInTheDocument();
    expect(screen.getByText('Up 3 days')).toBeInTheDocument();

    const tile = (name: string) => screen.getByRole('group', { name });
    expect(tile('Processor')).toHaveTextContent('Load 2.4');
    expect(tile('Memory')).toHaveTextContent('20 GB of 36 GB');
    expect(tile('Disk')).toHaveTextContent('354 GB free');
    expect(tile('Battery')).toHaveTextContent('Charged');

    // Each chart says itself in words for anyone who can't see it.
    expect(screen.getByRole('figure', { name: /Network/ })).toHaveAccessibleDescription(
      /Download over the last \d+ seconds: now 1\.2 MB\/s/,
    );
    expect(screen.getByRole('figure', { name: /Graphics/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /2 cores: the busiest at 30%/ })).toBeInTheDocument();

    const running = screen.getByRole('table', { name: 'Conch and what it started' });
    const rows = within(running).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'ConchRunning for 2 hours',
      'Claude Code3 processes',
      'Browser1 process',
    ]);
    expect(
      within(rows[1] as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['', '4.2%', '412 MB']);
    expect(await violations(container)).toEqual([]);
  });

  it('leaves out what this computer can’t tell', async () => {
    mockFetch({
      'GET /api/computer': () =>
        status({
          info: {
            os: 'windows',
            system: 'Windows 11 Pro',
            processor: 'Intel Core i7',
            cores: 8,
            memoryBytes: 16 * GiB,
          },
          samples: [
            sample(1000, {
              network: undefined,
              graphics: undefined,
              battery: undefined,
              helpers: undefined,
              load: undefined,
            }),
          ],
        }),
    });
    renderApp(<ComputerTab />);
    expect(await screen.findByRole('heading', { name: 'Room to spare' })).toBeInTheDocument();
    expect(screen.queryByRole('figure', { name: /Network/ })).toBeNull();
    expect(screen.queryByRole('figure', { name: /Graphics/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Battery' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Processor' })).toHaveTextContent('8 cores');
    // Conch itself is always there.
    expect(screen.getByRole('table')).toHaveTextContent('Conch');
  });

  it('keeps asking while it’s open, and offers a way on when it can’t read', async () => {
    let fail = true;
    const calls = mockFetch({
      'GET /api/computer': () =>
        fail ? new Response('{"error":"down"}', { status: 500 }) : status(),
    });
    renderApp(<ComputerTab />);
    const again = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    again.click();
    expect(await screen.findByRole('heading', { name: 'Room to spare' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/computer').length).toBeGreaterThanOrEqual(2);
  });

  it('is a place in Settings, with its own address', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/computer': () => status(),
    });
    renderApp(<Settings />, { route: '/settings/computer' });
    expect(
      await screen.findByRole('tab', { name: 'This computer', selected: true }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Room to spare' })).toBeInTheDocument(),
    );
  });
});

describe('the words', () => {
  it('says numbers the way the system does', () => {
    expect(percent(0.42)).toBe('0.4%');
    expect(percent(0)).toBe('0%');
    expect(percent(56.6)).toBe('57%');
    expect(memory(36 * GiB)).toBe('36 GB');
    expect(memory(1.5 * GiB)).toBe('1.5 GB');
    expect(memory(93 * 1024 * 1024)).toBe('93 MB');
    expect(rate(1_234_567)).toBe('1.2 MB/s');
    expect(rate(530_000)).toBe('530 KB/s');
    expect(duration(3 * 86_400)).toBe('3 days');
    expect(duration(3700)).toBe('1 hour');
    expect(duration(30)).toBe('a moment');
  });

  it('puts the state in a few words', () => {
    expect(statusOf([])).toEqual({ status: 'Looking…', tone: 'calm' });
    expect(statusOf([sample(1, { room: 'critical' })]).status).toBe('Low on memory');
    expect(statusOf([sample(1, { room: 'busy' })]).status).toBe('Busy right now');
    expect(statusOf([sample(1, { cpu: 95 }), sample(2, { cpu: 90 })]).status).toBe('Working hard');
    expect(statusOf([sample(1, { battery: { percent: 6, state: 'battery' } })]).status).toBe(
      'Battery low',
    );
  });
});
