/**
 * Conch apps over HTTP, through a whole gateway with the mock engine: the
 * maker's real path in a chat, the card pressed over HTTP, and the attacks —
 * a sealed page's `null` origin, a change that needs it to be you, a secret
 * that must never come back.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConchAppOffer, ConversationEvent } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { tallyFiles } from '../engines/mock/tally';
import { loadConfig } from '../config';
import { Services } from '../services';
import { fakePack, fakeParts, fakeSign, textFiles } from '../test/conchapps';
import { chat, cookieOf, PASSWORD } from '../test/session';

vi.setConfig({ testTimeout: 30_000 });

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const home = await mkdtemp(join(tmpdir(), 'conch-apps-http-'));
  const parts = fakeParts();
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
    { conchAppParts: parts },
  );
  const app = await buildApp(services);
  await app.ready();
  close = async () => {
    services.integrations.stop();
    await services.conchApps.stop();
    await services.mockVendor?.stop();
    await app.close();
  };
  return { home, app, services, parts };
}

const offersOf = (events: readonly ConversationEvent[]) => {
  const latest = new Map<string, ConchAppOffer>();
  for (const e of events) if (e.type === 'conch-app.offer') latest.set(e.offer.offerId, e.offer);
  return [...latest.values()];
};

/** "make me an app…" in a chat: the mock engine takes the maker's real path. */
async function made(g: Awaited<ReturnType<typeof setup>>) {
  const convo = await chat(g.services, 'make me an app that counts things');
  const events = (await g.services.conversations.detail(convo.id)).events;
  return { convo, events, offer: offersOf(events).find((o) => o.state === 'ready') };
}

const weather = () => {
  const manifest = {
    conch: 1,
    id: 'weather',
    name: 'Weather',
    tagline: 'The weather where you are',
    version: '1.0.0',
    icon: { glyph: 'cloud-sun', color: 'blue' },
    tools: 'tools.mjs',
    settings: [{ key: 'apiKey', label: 'API key', secret: true }],
  };
  return fakePack(
    fakeSign(
      textFiles({
        'conch-app.json': JSON.stringify(manifest),
        'tools.mjs':
          "export const tools = { now: { title: 'Read the weather', description: 'Reads it. Use when asked.', input: { type: 'object', properties: {} }, changes: false, async run() { return 'Sunny'; } } };",
      }),
      { fingerprint: 'BBBB', publisher: 'Bea' },
    ),
  ).toString('base64');
};

describe('making an app in a chat, end to end (ADR 0061)', () => {
  it('the assistant makes Tally, offers it, and the person adds it from the card', async () => {
    const g = await setup();
    const { convo, events, offer } = await made(g);
    expect(offer).toMatchObject({ action: 'add', from: 'draft', manifest: { id: 'tally' } });
    if (!offer) return;
    const said = events
      .flatMap((e) => (e.type === 'assistant.delta' && e.kind === 'text' ? [e.delta] : []))
      .join('');
    expect(said).toMatch(/I made Tally/);
    // Nothing is added until the press.
    expect((await g.app.inject({ method: 'GET', url: '/api/conch-apps' })).json().apps).toEqual([]);
    const accept = (body: Record<string, unknown>, offerId = offer.offerId) =>
      g.app.inject({
        method: 'POST',
        url: `/api/conch-apps/offers/${offerId}/accept`,
        payload: body,
      });
    expect((await accept({ conversationId: convo.id, extra: 1 })).statusCode).toBe(400);
    expect((await accept({ conversationId: convo.id }, '..%2Fsettings')).statusCode).toBe(404);
    const added = await accept({ conversationId: convo.id });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ id: 'tally', pinned: true });
    const after = offersOf((await g.services.conversations.detail(convo.id)).events);
    expect(after.find((o) => o.offerId === offer.offerId)?.state).toBe('added');
    const integrations = (
      await g.app.inject({ method: 'GET', url: '/api/integrations' })
    ).json() as {
      integrations: { id: string; policy: string }[];
    };
    expect(integrations.integrations).toContainEqual(
      expect.objectContaining({ id: 'capp_tally', policy: 'ask-writes' }),
    );
    // Its page, sealed, and its tools from that page.
    const frame = await g.app.inject({
      method: 'GET',
      url: '/api/conch-apps/tally/pages/main/frame?theme=dark',
    });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers['content-security-policy']).toMatch(/sandbox allow-scripts/);
    expect(frame.headers['content-security-policy']).toMatch(/connect-src 'none'/);
    expect(frame.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(frame.body).toContain('call:q');
    const call = (payload: Record<string, unknown>) =>
      g.app.inject({ method: 'POST', url: '/api/conch-apps/tally/call', payload });
    expect((await call({ tool: 'count', input: {} })).json()).toMatchObject({
      ok: false,
      reason: 'confirm',
    });
    expect((await call({ tool: 'count', input: { by: 2 }, confirmed: true })).json()).toMatchObject(
      { ok: true },
    );
    expect((await call({ tool: 'read_count' })).json()).toMatchObject({
      ok: true,
      json: { total: 2 },
    });
    // The next turn has its tools, and the prompt knows it.
    expect(g.services.conchApps.hosted.decide('mcp__conch__app_tally__read_count')).toBe('allow');
    // "change the app": a new card, an update with what changed.
    const changed = await chat(g.services, 'change the app so it counts by two');
    const update = offersOf((await g.services.conversations.detail(changed.id)).events).find(
      (o) => o.state === 'ready',
    );
    expect(update).toMatchObject({ action: 'update', changes: { from: '1.0.0', to: '1.1.0' } });
    // "put it on github": the share card, never published by the assistant.
    const shared = await chat(g.services, 'put it on github');
    expect((await g.services.conversations.detail(shared.id)).events).toContainEqual(
      expect.objectContaining({
        type: 'conch-app.share',
        share: { appId: 'tally', name: 'Tally' },
      }),
    );
    expect(g.parts.published.size).toBe(0);
  });

  it('a routine’s run gets no maker’s tools: nobody is there to press the card', async () => {
    const g = await setup();
    const { makerTools } = await import('./tools');
    expect(
      makerTools(g.services.conchApps, {
        conversationId: 'c',
        append: () => undefined,
        signal: new AbortController().signal,
        ask: async () => 'allow',
        unattended: true,
      }),
    ).toEqual([]);
  });
});

describe('Conch apps over HTTP: the attacks', () => {
  it('refuses a sealed page’s null origin on every route', async () => {
    const g = await setup();
    for (const [method, url] of [
      ['GET', '/api/conch-apps'],
      ['POST', '/api/conch-apps/tally/call'],
      ['POST', '/api/conch-apps/drafts/draft_x/call'],
      ['POST', '/api/conch-apps/preview'],
      ['PATCH', '/api/conch-apps/tally/settings'],
      ['POST', '/api/conch-apps/offers/capo_x/accept'],
    ] as const) {
      const res = await g.app.inject({
        method,
        url,
        headers: { origin: 'null' },
        payload: method === 'GET' ? undefined : {},
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('asks that it’s you to add an app made in a chat that read something from outside', async () => {
    const g = await setup();
    const signedIn = await g.app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    const cookie = cookieOf(signedIn);
    const convo = await chat(g.services, 'hello');
    await g.services.conversations.addTaint(convo.id, [{ kind: 'web', label: 'trains.example' }]);
    const apps = g.services.conchApps;
    const { draft } = await apps.newDraft(convo.id, { name: 'Tally', id: 'tally' });
    for (const [path, content] of Object.entries(tallyFiles()))
      await apps.write(draft.id, path, content);
    await apps.check(draft.id);
    await apps.tryTool(draft.id, 'count', {});
    await apps.tryTool(draft.id, 'read_count', {});
    await apps.check(draft.id);
    const offer = await apps.present(
      {
        conversationId: convo.id,
        append: (event) => {
          if (event.type === 'conch-app.offer')
            void g.services.conversations.noteAppOffer(convo.id, event.offer);
        },
      },
      draft.id,
      'Tally.',
    );
    await vi.waitUntil(
      async () =>
        (await apps.offerIn(convo.id, offer.offerId).catch(() => undefined)) !== undefined,
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    const accept = () =>
      g.app.inject({
        method: 'POST',
        url: `/api/conch-apps/offers/${offer.offerId}/accept`,
        headers: { cookie },
        payload: { conversationId: convo.id },
      });
    expect((await accept()).json().error).toBe('verify-required');
    vi.restoreAllMocks();
    expect((await accept()).json()).toMatchObject({
      id: 'tally',
      source: { afterReading: ['trains.example'] },
    });
  });

  it('asks that it’s you to add someone else’s app, update it, go back or publish; never echoes a secret', async () => {
    const g = await setup();
    const signedIn = await g.app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    const cookie = cookieOf(signedIn);
    const preview = await g.app.inject({
      method: 'POST',
      url: '/api/conch-apps/preview',
      headers: { cookie },
      payload: { file: weather(), name: 'weather.conchapp' },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    const { packageId, apps } = preview.json() as { packageId: string; apps: { hash: string }[] };
    const body = {
      packageId,
      appId: 'weather',
      hash: apps[0]?.hash,
      settings: { apiKey: 'sk-secret-value-123' },
    };
    // The Open dialog only on this computer.
    expect(
      (
        await g.app.inject({ method: 'POST', url: '/api/conch-apps/pick', headers: { cookie } })
      ).json(),
    ).toMatchObject({ error: 'not-here' });
    const later = Date.now() + 11 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const refused = await g.app.inject({
      method: 'POST',
      url: '/api/conch-apps/install',
      headers: { cookie },
      payload: body,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('verify-required');
    for (const url of ['/api/conch-apps/weather/update', '/api/conch-apps/weather/publish'])
      expect(
        (
          await g.app.inject({
            method: 'POST',
            url,
            headers: { cookie },
            payload: url.endsWith('update') ? { hash: 'h' } : {},
          })
        ).json().error,
      ).toBe('verify-required');
    // An update's press must say which files it means.
    expect(
      (
        await g.app.inject({
          method: 'POST',
          url: '/api/conch-apps/weather/update',
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    // Saving it as a file can sign with your key: it asks too.
    expect(
      (
        await g.app.inject({
          method: 'GET',
          url: '/api/conch-apps/weather/export',
          headers: { cookie },
        })
      ).json().error,
    ).toBe('verify-required');
    expect(
      (
        await g.app.inject({
          method: 'POST',
          url: '/api/conch-apps/weather/rollback',
          headers: { cookie },
          payload: { version: '0.9.0' },
        })
      ).json().error,
    ).toBe('verify-required');
    vi.restoreAllMocks();
    const added = await g.app.inject({
      method: 'POST',
      url: '/api/conch-apps/install',
      headers: { cookie },
      payload: body,
    });
    expect(added.statusCode).toBe(200);
    expect(added.body).not.toContain('sk-secret-value-123');
    expect(added.json()).toMatchObject({ saved: ['apiKey'], values: {}, missing: [] });
    const settings = await g.app.inject({
      method: 'PATCH',
      url: '/api/conch-apps/weather/settings',
      headers: { cookie },
      payload: { values: { apiKey: 'sk-another-secret-456' } },
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.body).not.toContain('sk-another-secret');
    const list = await g.app.inject({ method: 'GET', url: '/api/conch-apps', headers: { cookie } });
    expect(list.body).not.toContain('sk-another-secret');
    const exported = await g.app.inject({
      method: 'GET',
      url: '/api/conch-apps/weather/export',
      headers: { cookie },
    });
    expect(exported.headers['content-disposition']).toBe('attachment; filename="weather.conchapp"');
    expect(exported.headers['x-content-type-options']).toBe('nosniff');
    expect(exported.body).not.toContain('sk-another-secret');
    const removed = await g.app.inject({
      method: 'DELETE',
      url: '/api/conch-apps/weather?keepData=1',
      headers: { cookie },
    });
    expect(removed.json()).toEqual({ ok: true });
    expect(
      (await g.app.inject({ method: 'GET', url: '/api/conch-apps/weather', headers: { cookie } }))
        .statusCode,
    ).toBe(404);
  });

  it('an app at a link the person typed is shown as a card, and adding it from the chat works', async () => {
    const g = await setup();
    const link = 'https://github.com/bea/weather';
    g.parts.options.links = new Map([
      [
        link,
        {
          archive: Buffer.from(weather(), 'base64'),
          source: { kind: 'github', owner: 'bea', repo: 'weather', url: link, commit: 'c1' },
        },
      ],
    ]);
    const shown = await chat(g.services, `add the app at ${link}`);
    const [offer] = offersOf((await g.services.conversations.detail(shown.id)).events);
    expect(offer).toMatchObject({
      from: 'package',
      state: 'ready',
      signature: { publisher: 'Bea' },
    });
    if (!offer) return;
    const added = await g.app.inject({
      method: 'POST',
      url: `/api/conch-apps/offers/${offer.offerId}/accept`,
      payload: { conversationId: shown.id, settings: { apiKey: 'sk-typed-into-card' } },
    });
    expect(added.statusCode).toBe(200);
    expect(added.body).not.toContain('sk-typed-into-card');
    expect(added.json()).toMatchObject({ source: { kind: 'github' }, saved: ['apiKey'] });
    expect((await g.services.conchApps.hosted.get('capp_weather')).policy).toBe('ask');
  });
});
