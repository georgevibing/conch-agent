import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Channel,
  ImportPlan,
  ImportResult,
  ImportSlackStatus,
  ImportStatus,
} from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { MockSlack } from '../channels/mock/slack';
import { hermesHome, openClawHome } from './fixtures';

const PASSWORD = 'a long enough sentence for conch';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(fixture: (home: string) => string = openClawHome) {
  const root = await mkdtemp(join(tmpdir(), 'conch-import-app-'));
  const home = join(root, 'conch');
  const source = join(root, 'home');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(source);
  fixture(source);
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
      CONCH_IMPORT_HOME: source,
    }),
  );
  const app = await buildApp(services);
  await app.ready();
  await vi.waitUntil(() => Boolean(services.mockVendor?.base && services.mockSlack?.base), {
    timeout: 5000,
  });
  close = async () => {
    services.integrations.stop();
    await services.mockVendor?.stop();
    await app.close();
  };
  const signedIn = await app.inject({
    method: 'PUT',
    url: '/api/access/password',
    payload: { username: 'ada', password: PASSWORD },
  });
  const cookie = String([signedIn.headers['set-cookie']].flat()[0]).split(';')[0] ?? '';
  return { app, services, cookie, home, source };
}

describe('Come home over HTTP', () => {
  it('finds OpenClaw, previews it without a secret, brings things over and takes them back', async () => {
    const { app, services, cookie, home, source } = await setup();
    const status = ImportStatus.parse(
      (await app.inject({ url: '/api/import', headers: { cookie } })).json(),
    );
    expect(status.sources.map((s) => s.id)).toEqual(['openclaw']);

    const planned = await app.inject({ url: '/api/import/openclaw', headers: { cookie } });
    expect(planned.body).not.toMatch(/not-real/);
    const plan = ImportPlan.parse(planned.json());
    const ticked = plan.items.filter((i) => i.checked).map((i) => i.id);
    expect(ticked).not.toContain('channel:telegram');
    expect(ticked).not.toContain('skill:solana-helper');

    const events: string[] = [];
    const off = services.broadcast.on((e) => {
      if (e.type === 'import.progress') events.push(e.current);
    });
    const ran = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { source: 'openclaw', items: [...ticked, 'key:openrouter'] },
    });
    off();
    expect(ran.statusCode).toBe(200);
    const result = ImportResult.parse(ran.json());
    expect(result).toMatchObject({
      undoable: true,
      counts: { memories: 3, skills: 1, routines: 1, keys: 0, channels: 0 },
    });
    expect(result.backupId).toBeTruthy();
    expect(events[0]).toBe('Backing up first');
    expect(events.at(-1)).toBe('Done');

    const routines = await services.routines.list();
    expect(routines).toEqual([
      expect.objectContaining({ title: 'Morning briefing', status: 'draft' }),
    ]);
    const skills = (await services.skills.store.list({ fresh: true })).skills;
    expect(skills.find((s) => s.name === 'weekly-review')).toMatchObject({ mode: 'off' });
    // A key is checked with its provider before it's kept: one it refuses says so, and stays out.
    expect(result.outcomes.find((o) => o.id === 'key:openrouter')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/refused/),
    });
    expect(await services.keys.describe('openrouter')).toBeFalsy();
    // The key is sealed in Conch's key file, never in the ledger.
    expect(readFileSync(join(home, 'import.json'), 'utf8')).not.toMatch(/not-real/);
    // The other app's folder is as it was.
    expect(await readdir(join(source, '.openclaw', 'workspace'))).toEqual(
      expect.arrayContaining(['MEMORY.md', 'SOUL.md']),
    );

    const undone = await app.inject({
      method: 'POST',
      url: '/api/import/undo',
      headers: { cookie },
      payload: {},
    });
    expect(undone.statusCode).toBe(200);
    expect(await services.routines.list()).toEqual([]);
    expect(await services.memory.list()).toEqual([]);
    expect(existsSync(join(home, 'skills', 'weekly-review'))).toBe(false);
  });

  it('needs a sign-in, a known app, and a recent password to bring things over', async () => {
    const { app, cookie } = await setup();
    expect((await app.inject({ url: '/api/import' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/import/claude-desktop', headers: { cookie } })).statusCode,
    ).toBe(404);
    const empty = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { source: 'openclaw', items: [] },
    });
    expect(empty.statusCode).toBe(400);
    const none = await app.inject({
      method: 'POST',
      url: '/api/import/undo',
      headers: { cookie },
      payload: {},
    });
    expect(none.json()).toMatchObject({ error: 'import-nothing' });
  });

  it('finishes a Slack bot Hermes had one key for, and Undo takes it back (ADR 0042)', async () => {
    const { app, services, cookie, home } = await setup(hermesHome);
    const status = ImportSlackStatus.parse(
      (await app.inject({ url: '/api/import/slack?source=hermes', headers: { cookie } })).json(),
    );
    expect(status.half).toMatchObject({ source: 'hermes', has: 'botToken', appId: 'A0MOCKAPP' });
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/import/hermes/slack',
      headers: { cookie },
      payload: { appToken: MockSlack.OTHER_APP_TOKEN },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({
      field: 'appToken',
      message: expect.stringMatching(/different Slack apps/),
    });
    const done = await app.inject({
      method: 'POST',
      url: '/api/import/hermes/slack',
      headers: { cookie },
      payload: { appToken: MockSlack.APP_TOKEN },
    });
    expect(done.statusCode).toBe(200);
    const channel = Channel.parse(done.json());
    expect(channel.kind).toBe('slack');
    expect(readFileSync(join(home, 'import.json'), 'utf8')).not.toMatch(/xoxb-|xapp-/);
    await app.inject({ method: 'POST', url: '/api/import/undo', headers: { cookie }, payload: {} });
    expect((await services.channels.list()).channels).toEqual([]);
  });
});
