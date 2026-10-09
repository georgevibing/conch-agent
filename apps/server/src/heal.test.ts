/**
 * Every JSON store Conch owns heals itself (AGENTS.md agreement 11): a damaged
 * file is kept as `<name>.broken-<time>.json`, what still reads carries on,
 * the rest goes back to its default, and exactly one "fixed on its own" note
 * says so. `access.json` is the exception that fails closed: see auth.test.ts.
 */
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEvent, HealArea } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from './app';
import { onThisComputer } from './test/here';
import { BrowserStore } from './browser/store';
import { loadConfig } from './config';
import { ConversationStore } from './conversations/store';
import type { Engine } from './engines/types';
import { IntegrationStore, type StoredIntegration } from './integrations/store';
import { isBrokenCopy, type Heal } from './lib/recover';
import { RoutineStore, type StoredRoutine } from './routines/store';
import { Services } from './services';
import { SettingsStore } from './settings/store';
import { SkillStore } from './skills/store';
import { TerminalService } from './terminal/service';
import { UsageService } from './usage/service';

const GARBAGE = '{"this": is not json';

async function home() {
  return mkdtemp(join(tmpdir(), 'conch-heal-'));
}

function notes() {
  const told: { area: HealArea; message: string }[] = [];
  const heal: Heal = (area, message) => void told.push({ area, message });
  return { told, heal };
}

/** The damaged copies kept for `name` (e.g. `settings`) in `dir`. */
async function copies(dir: string, name: string) {
  const names = (await readdir(dir)).filter((n) => n.startsWith(`${name}.broken-`));
  expect(names.every(isBrokenCopy)).toBe(true);
  return Promise.all(names.map((n) => readFile(join(dir, n), 'utf8')));
}

const integration = (id: string, name: string): StoredIntegration => ({
  id,
  name,
  server: name.toLowerCase(),
  transport: { type: 'http', url: 'https://mcp.example.com' },
  auth: 'none',
  enabled: true,
  policy: 'ask',
  health: { state: 'ok' },
  tools: [],
  values: {},
  secrets: [],
  createdAt: 1,
  updatedAt: 1,
});

describe('settings.json', () => {
  it('goes back to the defaults, keeps a copy and says so once', async () => {
    const dir = await home();
    await writeFile(join(dir, 'settings.json'), GARBAGE);
    const { told, heal } = notes();
    const settings = await new SettingsStore(dir, heal).get();
    expect(settings.persona.name).toBe('Conch');
    // The default a new install has (ADR 0119): Auto, which still asks before anything risky.
    expect(settings.preferences.permissionMode).toBe('auto');
    expect(await copies(dir, 'settings')).toEqual([GARBAGE]);
    expect(told).toEqual([{ area: 'settings', message: expect.stringContaining('defaults') }]);
    // Started again: nothing more to repair.
    await new SettingsStore(dir, heal).get();
    expect(told).toHaveLength(1);
  });

  it('keeps every setting that still reads', async () => {
    const dir = await home();
    const damaged = JSON.stringify({
      onboarded: true,
      persona: { name: 'Ada', tone: 'grumpy' },
      preferences: { engine: 'no-such-provider', autoTitle: false },
    });
    await writeFile(join(dir, 'settings.json'), damaged);
    const { told, heal } = notes();
    const settings = await new SettingsStore(dir, heal).get();
    expect(settings).toMatchObject({
      onboarded: true,
      persona: { name: 'Ada', tone: 'warm' },
      preferences: { engine: 'claude-code', autoTitle: false },
    });
    expect(await copies(dir, 'settings')).toEqual([damaged]);
    expect(told.map((n) => n.message)).toEqual([
      expect.stringMatching(/damaged part of your settings/),
    ]);
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toMatchObject({
      persona: { name: 'Ada' },
    });
  });
});

describe('secrets.json', () => {
  it('keeps the keys that still read, and never logs one in the note', async () => {
    const dir = await home();
    const damaged = JSON.stringify({
      providers: {
        openrouter: { source: 'conch', value: 'sk-or-good-key', savedAt: 1 },
        'anthropic-api': { source: 'nowhere' },
      },
    });
    await writeFile(join(dir, 'secrets.json'), damaged);
    const { told, heal } = notes();
    const store = new SettingsStore(dir, heal);
    expect(await store.providerSecret('openrouter')).toMatchObject({ value: 'sk-or-good-key' });
    expect(await store.providerSecret('anthropic-api')).toBeUndefined();
    expect(await copies(dir, 'secrets')).toEqual([damaged]);
    expect(told).toEqual([{ area: 'secrets', message: expect.any(String) }]);
    expect(told[0]?.message).not.toContain('sk-or');
  });

  it('starts a new list when none of it reads', async () => {
    const dir = await home();
    await writeFile(join(dir, 'secrets.json'), GARBAGE);
    const { told, heal } = notes();
    expect(await new SettingsStore(dir, heal).secrets()).toEqual({ providers: {} });
    expect(told).toHaveLength(1);
  });
});

describe('integrations', () => {
  it('carries on with the integrations that still read', async () => {
    const dir = await home();
    const damaged = JSON.stringify({
      version: 1,
      integrations: [integration('int_a', 'Notion'), { id: 'int_b', name: 42 }],
    });
    await writeFile(join(dir, 'integrations.json'), damaged);
    const { told, heal } = notes();
    const all = await new IntegrationStore(dir, heal).all();
    expect(all.map((i) => i.name)).toEqual(['Notion']);
    expect(await copies(dir, 'integrations')).toEqual([damaged]);
    expect(told).toEqual([
      { area: 'integrations', message: expect.stringMatching(/an app’s damaged settings/) },
    ]);
  });

  it('starts new lists when the files won’t parse', async () => {
    const dir = await home();
    await writeFile(join(dir, 'integrations.json'), GARBAGE);
    await writeFile(join(dir, 'integrations.secrets.json'), GARBAGE);
    const { told, heal } = notes();
    const store = new IntegrationStore(dir, heal);
    expect(await store.all()).toEqual([]);
    expect(await store.secrets('int_a')).toEqual({ values: {} });
    expect(await copies(dir, 'integrations')).toEqual([GARBAGE]);
    expect(await copies(dir, 'integrations.secrets')).toEqual([GARBAGE]);
    expect(told).toHaveLength(2);
  });
});

describe('browser.json', () => {
  it('goes back to the careful defaults', async () => {
    const dir = await home();
    await writeFile(join(dir, 'browser.json'), GARBAGE);
    const { told, heal } = notes();
    const settings = await new BrowserStore(dir, heal).settings();
    expect(settings).toMatchObject({ enabled: true, allowLocal: false });
    expect(await copies(dir, 'browser')).toEqual([GARBAGE]);
    expect(told).toEqual([{ area: 'browser', message: expect.stringContaining('defaults') }]);
  });
});

describe('terminal.json', () => {
  it('goes back to the careful defaults: only this computer may open one', async () => {
    const dir = await home();
    await writeFile(join(dir, 'terminal.json'), GARBAGE);
    const { told, heal } = notes();
    const terminal = new TerminalService({
      home: dir,
      workspace: async () => dir,
      emit: () => undefined,
      heal,
    });
    expect(await terminal.settings()).toMatchObject({ allowRemote: false });
    expect(await copies(dir, 'terminal')).toEqual([GARBAGE]);
    expect(told).toEqual([{ area: 'terminal', message: expect.any(String) }]);
  });

  it('lists the terminal’s own repairs under Health → Fixed on its own', async () => {
    const dir = await home();
    const { told, heal } = notes();
    const terminal = new TerminalService({
      home: dir,
      workspace: async () => dir,
      emit: () => undefined,
      heal,
    });
    terminal.heal('Switched terminals to basic mode. Commands work; full-screen programs don’t.');
    expect(told).toEqual([
      {
        area: 'terminal',
        message: 'Switched terminals to basic mode. Commands work; full-screen programs don’t.',
      },
    ]);
    terminal.stop();
  });
});

describe('skills.json', () => {
  it('lists skills with their own defaults', async () => {
    const dir = await home();
    await writeFile(join(dir, 'skills.json'), GARBAGE);
    const { told, heal } = notes();
    const store = new SkillStore(dir, [], () => new Map(), heal);
    await expect(store.list()).resolves.toBeDefined();
    expect(await copies(dir, 'skills')).toEqual([GARBAGE]);
    expect(told).toEqual([{ area: 'skills', message: expect.any(String) }]);
  });
});

describe('usage.json', () => {
  it('rebuilds the spending record from the chats', async () => {
    const dir = await home();
    await writeFile(join(dir, 'usage.json'), GARBAGE);
    const { told, heal } = notes();
    const at = Date.parse('2026-09-29T12:00:00');
    const engine = { label: 'Mock', usage: undefined } as unknown as Engine;
    const usage = new UsageService({
      home: dir,
      engine: () => engine,
      now: () => at,
      history: async () => [
        { at, costUsd: 0.25 },
        { at, costUsd: 0.5 },
      ],
      heal,
    });
    const snapshot = await usage.refresh();
    expect(snapshot.spend?.today).toBeCloseTo(0.75);
    expect(await copies(dir, 'usage')).toEqual([GARBAGE]);
    expect(told).toEqual([{ area: 'usage', message: expect.stringContaining('Rebuilt') }]);
  });
});

describe('conversations/index.json', () => {
  const log = (id: string, events: Partial<ConversationEvent>[]) =>
    events
      .map((e, seq) => JSON.stringify({ conversationId: id, seq, at: 1000 + seq, ...e }))
      .join('\n');

  it('rebuilds the list of chats from the chats themselves', async () => {
    const dir = join(await home(), 'conversations');
    await mkdir(dir);
    await writeFile(join(dir, 'index.json'), GARBAGE);
    await writeFile(
      join(dir, 'c_one.jsonl'),
      log('c_one', [
        { type: 'user.message', messageId: 'm1', text: 'Plan the garden for spring' },
        { type: 'title', title: 'Garden plan' },
        { type: 'turn.completed', outcome: 'success', engine: 'codex-cli' },
      ]),
    );
    await writeFile(
      join(dir, 'c_two.jsonl'),
      // A line cut short by a crash doesn't lose the chat.
      `${log('c_two', [{ type: 'user.message', messageId: 'm1', text: 'What is a monad?' }])}\n{"conv`,
    );
    const { told, heal } = notes();
    const store = new ConversationStore(dir, heal);
    const list = await store.list();
    expect(list.map((c) => [c.id, c.title, c.engine])).toEqual(
      expect.arrayContaining([
        ['c_one', 'Garden plan', 'codex-cli'],
        ['c_two', 'What is a monad?', 'claude-code'],
      ]),
    );
    expect(await copies(dir, 'index')).toEqual([GARBAGE]);
    expect(told).toEqual([{ area: 'conversations', message: expect.stringContaining('Rebuilt') }]);
    // Saved: the next start reads it straight away.
    const again = notes();
    expect(await new ConversationStore(dir, again.heal).list()).toHaveLength(2);
    expect(again.told).toEqual([]);
  });

  it('keeps the chats that still read and finds the rest', async () => {
    const dir = join(await home(), 'conversations');
    await mkdir(dir);
    const kept = {
      id: 'c_one',
      title: 'Kept title',
      preview: '',
      createdAt: 1,
      updatedAt: 2,
      status: 'running',
      options: {},
      engine: 'mock',
    };
    await writeFile(join(dir, 'index.json'), JSON.stringify([kept, { title: 'no id' }]));
    await writeFile(
      join(dir, 'c_two.jsonl'),
      log('c_two', [{ type: 'user.message', messageId: 'm1', text: 'Second chat' }]),
    );
    const { told, heal } = notes();
    const list = await new ConversationStore(dir, heal).list();
    expect(list.map((c) => [c.id, c.title, c.status])).toEqual(
      expect.arrayContaining([
        ['c_one', 'Kept title', 'idle'],
        ['c_two', 'Second chat', 'idle'],
      ]),
    );
    expect(told).toHaveLength(1);
  });
});

describe('routines', () => {
  const routine: StoredRoutine = {
    id: 'r_good',
    title: 'Morning briefing',
    summary: 'Today at a glance.',
    prompt: 'Summarise my day.',
    schedule: { type: 'daily', time: '08:00' },
    timezone: 'Europe/Athens',
    status: 'active',
    trust: 'ask',
    catchUp: true,
    options: {},
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
  };

  it('sets aside a routine that won’t read, whole, so it never runs wrong', async () => {
    const dir = join(await home(), 'routines');
    await mkdir(dir);
    await writeFile(join(dir, 'r_good.json'), JSON.stringify(routine));
    const damaged = JSON.stringify({ ...routine, id: 'r_bad', title: 'Pay rent', schedule: 'x' });
    await writeFile(join(dir, 'r_bad.json'), damaged);
    await writeFile(join(dir, 'r_worse.json'), GARBAGE);
    const { told, heal } = notes();
    const all = await new RoutineStore(dir, heal).all();
    expect(all.map((r) => r.id)).toEqual(['r_good']);
    expect(await copies(dir, 'r_bad')).toEqual([damaged]);
    expect(await copies(dir, 'r_worse')).toEqual([GARBAGE]);
    expect(told.map((n) => n.message).sort()).toEqual([
      'Set aside a damaged routine rather than run it wrong',
      'Set aside the damaged routine “Pay rent” rather than run it wrong',
    ]);
    // The copies aren't read back as routines.
    const again = notes();
    expect((await new RoutineStore(dir, again.heal).all()).map((r) => r.id)).toEqual(['r_good']);
    expect(again.told).toEqual([]);
  });
});

describe('the whole gateway', () => {
  it('starts with a damaged settings file and lists the repair under “Fixed on its own”', async () => {
    const dir = await home();
    await writeFile(join(dir, 'settings.json'), GARBAGE);
    const services = new Services(
      loadConfig({
        CONCH_HOME: dir,
        CONCH_ENGINE: 'mock',
        CONCH_LOG_LEVEL: 'silent',
        CONCH_WEB_DIST: '/nonexistent',
      }),
    );
    const app = onThisComputer(await buildApp(services), services);
    try {
      expect((await app.inject('/api/state')).statusCode).toBe(200);
      await vi.waitFor(async () => {
        const { notes: healed } = (await app.inject('/api/healed')).json() as {
          notes: { area: string }[];
        };
        expect(healed.map((n) => n.area)).toContain('settings');
      });
    } finally {
      await app.close();
    }
  });
});
