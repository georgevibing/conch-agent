import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';

let services: Services | undefined;

async function setup(state = 'ready') {
  process.env.CONCH_MOCK_STATE = state;
  const home = await mkdtemp(join(tmpdir(), 'conch-doctor-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  return services;
}

afterEach(() => {
  services?.integrations.stop();
  services = undefined;
});

describe('Repair everything, on a real Conch', () => {
  it('looks at every part, and says a healthy Conch is healthy', async () => {
    const s = await setup();
    const report = await s.doctor.run();
    const byId = Object.fromEntries(report.items.map((i) => [i.id, i]));
    expect(byId['providers:mock']).toMatchObject({ state: 'ok', group: 'Providers' });
    expect(byId['computer:files']).toMatchObject({ state: 'ok' });
    expect(report.items.some((i) => i.state === 'checking')).toBe(false);
    expect(report.running).toBe(false);
  });

  it('points at the one thing only you can do: signing in', async () => {
    const s = await setup('signed-out');
    const report = await s.doctor.run();
    expect(report.items.find((i) => i.id === 'providers:mock')).toMatchObject({
      state: 'needs-you',
      action: { kind: 'open', place: 'providers', focus: 'mock', label: 'Sign in' },
    });
  });

  it('rebuilds a broken search index when asked to repair, and notes it', async () => {
    const s = await setup();
    vi.spyOn(s.search, 'state', 'get').mockReturnValueOnce('unavailable');
    const repair = vi.spyOn(s.search, 'repair').mockResolvedValue('ready');
    const report = await s.doctor.run({ repair: true });
    expect(repair).toHaveBeenCalled();
    expect(report.items.find((i) => i.id === 'search')).toMatchObject({
      state: 'fixed',
      message: 'Built again from your chats.',
    });
    await vi.waitFor(async () =>
      expect((await s.healed.list()).map((n) => n.message)).toContain(
        'Search: Built again from your chats.',
      ),
    );
  });

  it('reconnects a bot that dropped, and points at the key only you can paste', async () => {
    const s = await setup();
    const bot = (name: string, state: string, id: string) =>
      ({
        id,
        kind: 'telegram',
        enabled: true,
        createdAt: 1,
        bot: { id, name },
        people: [],
        requests: [],
        blocked: 0,
        settings: { notifyRoutines: true },
        health: { state },
      }) as never;
    vi.spyOn(s.channels, 'list').mockResolvedValue({
      channels: [
        bot('Ada’s Conch', 'reconnecting', 'ch_1'),
        bot('Work bot', 'needs-token', 'ch_2'),
      ],
      catalog: [],
    });
    const repair = vi
      .spyOn(s.channels, 'repair')
      .mockResolvedValue(bot('Ada’s Conch', 'online', 'ch_1'));

    const looked = await s.doctor.run();
    expect(looked.items.find((i) => i.id === 'channels:ch_1')).toMatchObject({
      state: 'warning',
      title: 'Ada’s Conch on Telegram',
    });
    expect(repair).not.toHaveBeenCalled();

    const repaired = await s.doctor.run({ repair: true });
    expect(repaired.items.find((i) => i.id === 'channels:ch_1')).toMatchObject({
      state: 'fixed',
      message: 'Connected again.',
    });
    expect(repaired.items.find((i) => i.id === 'channels:ch_2')).toMatchObject({
      state: 'needs-you',
      action: { kind: 'open', place: 'channels', focus: 'ch_2', label: 'Paste a new key' },
    });
  });
});
