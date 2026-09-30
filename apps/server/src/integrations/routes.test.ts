import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';

const PASSWORD = 'a long enough sentence for conch';

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.05';
  const home = await mkdtemp(join(tmpdir(), 'conch-int-app-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
  });
  const services = new Services(config);
  const app = await buildApp(services);
  // The mock vendor starts in the background.
  await vi.waitUntil(() => Boolean(services.mockVendor?.base), { timeout: 5000 });
  close = async () => {
    services.integrations.stop();
    await services.mockVendor?.stop();
    await app.close();
  };
  return { app, services };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

describe('integrations over HTTP', () => {
  it('connects Notion end to end, and the redirect spends the code', async () => {
    const { app, services } = await setup();
    const list = (await app.inject('/api/integrations')).json();
    expect(list.catalog.map((c: { id: string }) => c.id)).toContain('notion');
    expect(JSON.stringify(list.catalog)).not.toContain('blueprint');

    const created = await app.inject({
      method: 'POST',
      url: '/api/integrations?display=popup',
      headers: { host: 'localhost:4317' },
      payload: { catalogId: 'notion' },
    });
    expect(created.statusCode).toBe(200);
    const { integration, authorizeUrl } = created.json();
    expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(
      'http://localhost:4317/oauth/callback',
    );

    // Press "Allow" on the vendor's consent page.
    const vendorBase = services.mockVendor?.base ?? '';
    const form = new URLSearchParams([
      ...new URL(authorizeUrl).searchParams,
      ['decision', 'allow'],
    ]);
    const consent = await fetch(`${vendorBase}/authorize`, {
      method: 'POST',
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });
    const back = new URL(consent.headers.get('location') ?? '');

    // The redirect is a cross-site navigation, and still lands.
    const callback = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe(
      `/integrations/done?id=${integration.id}&result=connected`,
    );
    const replay = await app.inject(`${back.pathname}${back.search}`);
    expect(replay.headers.location).toBe('/integrations?result=expired');

    const detail = (await app.inject(`/api/integrations/${integration.id}`)).json();
    expect(detail.health.state).toBe('ok');
    expect(detail.tools).toHaveLength(3);
  });

  it('sends a denied sign-in back with a reason', async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/integrations?display=tab',
      payload: { catalogId: 'linear' },
    });
    const { integration, authorizeUrl } = created.json();
    const state = new URL(authorizeUrl).searchParams.get('state');
    const res = await app.inject(`/oauth/callback?state=${state}&error=access_denied`);
    expect(res.headers.location).toBe(
      `/integrations/${integration.id}?id=${integration.id}&result=denied`,
    );
  });

  it('refuses anything cross-site on the API', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      payload: { catalogId: 'notion' },
    });
    expect(res.statusCode).toBe(403);
    const read = await app.inject({
      url: '/api/integrations',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(read.statusCode).toBe(403);
  });

  it('rejects junk on the callback without touching anything', async () => {
    const { app } = await setup();
    expect((await app.inject('/oauth/callback')).headers.location).toBe(
      '/integrations?result=expired',
    );
    expect(
      (await app.inject(`/oauth/callback?state=${'x'.repeat(300)}&code=abc`)).headers.location,
    ).toBe('/integrations?result=expired');
  });

  it('asks you to confirm before adding a command or trusting an integration', async () => {
    const { app } = await setup();
    const signedIn = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    const cookie = String([signedIn.headers['set-cookie']].flat()[0]).split(';')[0] ?? '';
    const github = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers: { cookie },
      payload: { catalogId: 'github', values: { token: 'github_pat_mock_0123456789abcdefghij' } },
    });
    const id = github.json().integration.id;

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    const command = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      headers: { cookie },
      payload: { custom: { type: 'stdio', name: 'Shell', command: 'sh', args: ['-c', 'id'] } },
    });
    expect(command.statusCode).toBe(403);
    expect(command.json().error).toBe('verify-required');
    const trust = await app.inject({
      method: 'PATCH',
      url: `/api/integrations/${id}`,
      headers: { cookie },
      payload: { policy: 'trust' },
    });
    expect(trust.json().error).toBe('verify-required');
    // Installing software runs a package manager as you.
    const install = await app.inject({
      method: 'POST',
      url: '/api/integrations/catalog/1password/needs/1password-app/install',
      headers: { cookie },
      payload: {},
    });
    expect(install.json().error).toBe('verify-required');
    for (const action of ['install', 'update']) {
      const provider = await app.inject({
        method: 'POST',
        url: `/api/needs/codex/${action}`,
        headers: { cookie },
        payload: {},
      });
      expect(provider.json().error).toBe('verify-required');
    }
    // Only what Conch knows how to get exists at all.
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/needs/..%2F..%2Fcalc/open',
      headers: { cookie },
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);
    expect((await app.inject({ url: '/api/needs/nope', headers: { cookie } })).statusCode).toBe(
      404,
    );
    // Everyday changes don't ask.
    const ask = await app.inject({
      method: 'PATCH',
      url: `/api/integrations/${id}`,
      headers: { cookie },
      payload: { policy: 'ask', enabled: false },
    });
    expect(ask.statusCode).toBe(200);
    expect(ask.json().health.state).toBe('off');
  });

  it('warns in the security checkup about integrations that never ask', async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/integrations',
      payload: { catalogId: 'github', values: { token: 'github_pat_mock_0123456789abcdefghij' } },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/integrations/${created.json().integration.id}`,
      payload: { policy: 'trust' },
    });
    const { checkup } = (await app.inject('/api/access')).json();
    const item = checkup.find((c: { id: string }) => c.id === 'trusted-integrations');
    expect(item).toMatchObject({
      level: 'warn',
      title: 'GitHub acts without asking',
      fix: { kind: 'act', action: 'integrations-ask', label: 'Ask before changes' },
    });

    // One click takes it back to asking — no password needed to take trust away.
    const fixed = await app.inject({
      method: 'POST',
      url: '/api/access/fix',
      payload: { action: 'integrations-ask' },
    });
    expect(fixed.statusCode).toBe(200);
    expect(fixed.json().done).toBe('GitHub asks before changes now.');
    expect(fixed.json().access.checkup.map((c: { id: string }) => c.id)).not.toContain(
      'trusted-integrations',
    );
    const after = await app.inject(`/api/integrations/${created.json().integration.id}`);
    expect(after.json().policy).toBe('ask-writes');
  });

  it('lets a conversation use an integration, and asks before it changes things', async () => {
    const { app, services } = await setup();
    await app.inject({
      method: 'POST',
      url: '/api/integrations',
      payload: { catalogId: 'github', values: { token: 'github_pat_mock_0123456789abcdefghij' } },
    });
    const chat = async (text: string) => {
      await services.conversations.send({ clientMessageId: text, text });
      const [latest] = (await services.conversations.list()).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
      return latest?.id ?? '';
    };
    const events = async (id: string) => (await services.conversations.detail(id)).events;

    const read = await chat('search github for bugs');
    await vi.waitUntil(async () => (await events(read)).some((e) => e.type === 'turn.completed'), {
      timeout: 5000,
    });
    expect((await events(read)).some((e) => e.type === 'permission.requested')).toBe(false);
    expect(await events(read)).toContainEqual(
      expect.objectContaining({ type: 'tool.finished', status: 'success' }),
    );

    const write = await chat('create a page in github');
    await vi.waitUntil(
      async () => (await events(write)).some((e) => e.type === 'permission.requested'),
      { timeout: 5000 },
    );
    const asked = (await events(write)).find((e) => e.type === 'permission.requested');
    expect(asked).toMatchObject({ summary: 'create a page in GitHub' });
    await services.conversations.interrupt(write);
  });
});
