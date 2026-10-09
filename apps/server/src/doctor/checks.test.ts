import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Provider } from '@conch/protocol';

import { loadConfig } from '../config';
import { Services } from '../services';
import { providersCheck } from './checks';

let services: Services | undefined;

async function setup(state = 'ready') {
  process.env.CONCH_MOCK_STATE = state;
  const home = await mkdtemp(join(tmpdir(), 'conch-doctor-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  // A started Conch has made this computer's key (Services.start).
  services.here.key();
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
    expect(byId['computer:here']).toMatchObject({ state: 'ok', title: 'This computer’s key' });
    expect(report.items.some((i) => i.state === 'checking')).toBe(false);
    expect(report.running).toBe(false);
  });

  it('leaves nothing worth a look without something to do about it, before or after Repair', async () => {
    const s = await setup();
    const told = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const repair of [false, true]) {
        const report = await s.doctor.run({ repair });
        for (const item of report.items) {
          if (item.state === 'warning' && !repair)
            expect(item.action ?? item.repairable).toBeTruthy();
          if (item.state === 'warning' && repair) expect(item.action).toBeDefined();
          if (item.state === 'needs-you') expect(item.action).toBeDefined();
          if (repair) expect(item.repairable).toBeUndefined();
        }
      }
      expect(told.mock.calls.filter(([m]) => String(m).startsWith('[doctor]'))).toEqual([]);
    } finally {
      told.mockRestore();
    }
  });

  it('makes this computer’s key again when it’s damaged, and says what that means', async () => {
    const s = await setup();
    const file = join(s.config.CONCH_HOME, 'here', 'key');
    await mkdir(join(s.config.CONCH_HOME, 'here'), { recursive: true });
    await writeFile(file, 'not a key');
    const looked = await s.doctor.run();
    expect(looked.items.find((i) => i.id === 'computer:here')).toMatchObject({
      state: 'warning',
      message: expect.stringMatching(/damaged/),
    });
    const repaired = await s.doctor.run({ repair: true });
    expect(repaired.items.find((i) => i.id === 'computer:here')).toMatchObject({
      state: 'fixed',
      message: expect.stringMatching(/Open Conch from your apps/),
    });
    expect((await readFile(file, 'utf8')).trim()).toMatch(/^[A-Za-z0-9_-]{43}$/);
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

  it('asks to link WhatsApp again, and offers to install what Signal needs', async () => {
    const s = await setup();
    const linked = (kind: string, id: string, health: Record<string, string>) =>
      ({
        id,
        kind,
        enabled: true,
        createdAt: 1,
        bot: { id: '15550001111', name: 'Ada', phone: '+15550001111' },
        people: [],
        requests: [],
        blocked: 0,
        settings: { notifyRoutines: true, others: 'ignore' },
        health,
      }) as never;
    vi.spyOn(s.channels, 'list').mockResolvedValue({
      channels: [
        linked('whatsapp', 'ch_wa', { state: 'needs-token', message: 'WhatsApp unlinked Conch.' }),
        linked('signal', 'ch_sg', {
          state: 'error',
          message: 'Signal needs Java, which isn’t on this computer yet.',
          need: 'java',
        }),
      ],
      catalog: [],
    });
    vi.spyOn(s.channels, 'repair').mockImplementation(
      async (id) => (await s.channels.list()).channels.find((c) => c.id === id) as never,
    );
    const report = await s.doctor.run({ repair: true });
    expect(report.items.find((i) => i.id === 'channels:ch_wa')).toMatchObject({
      title: 'Ada on WhatsApp',
      state: 'needs-you',
      action: { kind: 'open', label: 'Link again', focus: 'ch_wa' },
    });
    expect(report.items.find((i) => i.id === 'channels:ch_sg')).toMatchObject({
      state: 'needs-you',
      action: { kind: 'need', need: 'java', mode: 'install' },
    });
  });
});

describe('Your providers', () => {
  const provider = (id: string, over: Partial<Provider> = {}) =>
    ({
      id,
      name: id,
      active: false,
      ready: false,
      hidden: false,
      status: { engine: id, label: id, state: 'signed-out', install: [], canSignIn: false },
      ...over,
    }) as Provider;

  async function report(providers: Provider[], connected: string[] = []) {
    const services = {
      providers: {
        list: async () => ({ providers }),
        connected: async () => new Set(connected),
      },
    } as unknown as Services;
    const items = await providersCheck(services).run({
      repair: false,
      signal: new AbortController().signal,
    });
    return Object.fromEntries(items.map((i) => [i.id, i.state]));
  }

  const ready = { ready: true, status: { ...provider('x').status, state: 'ready' as const } };

  it('leaves out providers you never set up', async () => {
    expect(
      await report([provider('claude-code', { active: true, ...ready }), provider('codex')]),
    ).toEqual({ 'providers:claude-code': 'ok' });
  });

  it('asks about one that worked before and doesn’t now', async () => {
    expect(
      await report(
        [provider('claude-code', { active: true, ...ready }), provider('codex')],
        ['codex'],
      ),
    ).toEqual({ 'providers:claude-code': 'ok', 'providers:codex': 'needs-you' });
  });

  it('offers to ask Conch to fix a provider an app brings that stopped working (ADR 0122)', async () => {
    const fireworks = provider('app-fireworks', {
      name: 'Fireworks AI',
      contributed: { app: 'fireworks', from: 'made', speaks: 'openai', reaches: [] },
      status: {
        ...provider('app-fireworks').status,
        state: 'error',
        message: 'Fireworks AI couldn’t answer that request.',
      },
    });
    const services = {
      providers: {
        list: async () => ({ providers: [fireworks] }),
        connected: async () => new Set(['app-fireworks']),
      },
    } as unknown as Services;
    const [item] = await providersCheck(services).run({
      repair: false,
      signal: new AbortController().signal,
    });
    expect(item).toMatchObject({
      state: 'needs-you',
      action: {
        kind: 'ask',
        label: 'Ask Conch to fix it',
        prompt: expect.stringMatching(
          /^Fix Fireworks AI: .*change the app fireworks with app_edit/,
        ),
      },
    });
  });

  it('says whose cloud sign-in ended, with the one press that signs in again', async () => {
    const bedrock = provider('bedrock', {
      cloud: 'aws',
      status: {
        ...provider('bedrock').status,
        message: 'Your AWS sign-in for “dev” has ended. Sign in to AWS again.',
      },
    });
    const services = {
      providers: {
        list: async () => ({ providers: [bedrock] }),
        connected: async () => new Set(['bedrock']),
      },
    } as unknown as Services;
    const [item] = await providersCheck(services).run({
      repair: false,
      signal: new AbortController().signal,
    });
    expect(item).toMatchObject({
      state: 'needs-you',
      message: 'Your AWS sign-in for “dev” has ended. Sign in to AWS again.',
      action: { kind: 'open', label: 'Sign in again', focus: 'bedrock' },
    });
  });

  it('offers to install the cloud’s own program, by its name', async () => {
    const vertex = provider('vertex', {
      cloud: 'gcp',
      status: {
        ...provider('vertex').status,
        state: 'not-installed',
        fix: { need: 'gcloud', kind: 'install' },
      },
    });
    const services = {
      providers: {
        list: async () => ({ providers: [vertex] }),
        connected: async () => new Set(['vertex']),
      },
    } as unknown as Services;
    const [item] = await providersCheck(services).run({
      repair: false,
      signal: new AbortController().signal,
    });
    expect(item?.action).toMatchObject({
      kind: 'need',
      label: 'Install the Google Cloud CLI',
      need: 'gcloud',
    });
  });

  it('says so when no provider works at all', async () => {
    expect(await report([provider('claude-code', { active: true }), provider('codex')])).toEqual({
      'providers:claude-code': 'needs-you',
    });
  });
});
