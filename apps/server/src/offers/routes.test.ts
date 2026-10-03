import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEvent } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { onThisComputer } from '../test/here';
import { loadConfig } from '../config';
import { Services } from '../services';

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.05';
  const home = await mkdtemp(join(tmpdir(), 'conch-offers-app-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
  });
  const services = new Services(config);
  const app = onThisComputer(await buildApp(services), services);
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
  await close?.();
  close = undefined;
});

const said = (events: readonly ConversationEvent[]) =>
  events
    .flatMap((e) => (e.type === 'assistant.delta' && e.kind === 'text' ? [e.delta] : []))
    .join('');

describe('offers over HTTP (ADR 0060)', () => {
  it('the assistant offers Linear; connecting it on a phone comes back to the chat, which carries on once', async () => {
    const { app, services } = await setup();
    const sent = await services.conversations.send({
      clientMessageId: 'ask',
      text: 'what’s on my plate this week?',
    });
    const events = async () => (await services.conversations.detail(sent.id)).events;
    const turns = async () => (await events()).filter((e) => e.type === 'turn.completed').length;
    await vi.waitUntil(async () => (await turns()) === 1, { timeout: 5000 });

    const offer = (await events()).flatMap((e) => (e.type === 'offer' ? [e.offer] : []))[0];
    expect(offer).toMatchObject({
      kind: 'app',
      target: 'linear',
      name: 'Linear',
      by: 'assistant',
      why: 'Your Linear issues would show what’s on your plate.',
      resume: { request: 'what’s on my plate this week?' },
    });
    if (!offer) return;
    expect(said(await events())).toMatch(/Connect Linear and I’ll look/);

    const accept = (body: unknown = {}, offerId = offer.offerId, id = sent.id) =>
      app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/offers/${offerId}/accept`,
        payload: body as Record<string, unknown>,
      });
    // Not connected yet: nothing carries on.
    const early = await accept();
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: 'not-ready' });
    // The words on the wire are checked.
    expect((await accept({ skill: 'always' })).statusCode).toBe(400);
    expect((await accept({ extra: true })).statusCode).toBe(400);
    expect((await accept({}, '..%2Fsettings')).statusCode).toBe(404);
    expect((await accept({}, 'of_nothing')).statusCode).toBe(404);
    expect((await accept({}, offer.offerId, 'c_nothing')).statusCode).toBe(404);

    // Sign in in this tab, as a phone does: the way back is the chat, with the offer.
    const created = await app.inject({
      method: 'POST',
      url: `/api/integrations?display=tab&chat=${sent.id}&offer=${offer.offerId}`,
      headers: { host: 'localhost:4317' },
      payload: { catalogId: 'linear' },
    });
    expect(created.statusCode).toBe(200);
    const { authorizeUrl } = created.json();
    const form = new URLSearchParams([
      ...new URL(authorizeUrl).searchParams,
      ['decision', 'allow'],
    ]);
    const consent = await fetch(`${services.mockVendor?.base ?? ''}/authorize`, {
      method: 'POST',
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });
    const back = new URL(consent.headers.get('location') ?? '');
    const callback = await app.inject({ url: `${back.pathname}${back.search}` });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe(`/c/${sent.id}?offer=${offer.offerId}&result=connected`);

    // Two devices press it at once: it carries on once.
    const [one, two] = await Promise.all([accept(), accept()]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect([one.json().state, two.json().state].sort()).toEqual(['done', 'started']);
    await vi.waitUntil(async () => (await turns()) === 2, { timeout: 5000 });
    expect((await accept()).json()).toMatchObject({ ok: true, state: 'done' });

    const log = await events();
    expect(log.filter((e) => e.type === 'offer.resolved')).toEqual([
      expect.objectContaining({ offerId: offer.offerId, outcome: 'accepted' }),
    ]);
    // No new message of yours: the request ran again, and used Linear.
    expect(log.filter((e) => e.type === 'user.message')).toHaveLength(1);
    expect(said(log)).toMatch(/I found \*\*3 results\*\*/);
    // Put away after it was taken: nothing changes.
    const late = await app.inject({
      method: 'POST',
      url: `/api/conversations/${sent.id}/offers/${offer.offerId}/dismiss`,
      payload: {},
    });
    expect(late.statusCode).toBe(200);
    expect((await events()).filter((e) => e.type === 'offer.resolved')).toHaveLength(1);
  });

  it('a newer message overtakes an offer nobody answered, and it never carries on from it', async () => {
    const { app, services } = await setup();
    const sent = await services.conversations.send({
      clientMessageId: 'ask',
      text: 'what’s on my plate this week?',
    });
    const events = async () => (await services.conversations.detail(sent.id)).events;
    const idle = () =>
      vi.waitUntil(
        async () => (await services.conversations.detail(sent.id)).conversation.status === 'idle',
        { timeout: 5000 },
      );
    await idle();
    const offer = (await events()).flatMap((e) => (e.type === 'offer' ? [e.offer] : []))[0];
    await services.conversations.send({
      conversationId: sent.id,
      clientMessageId: 'next',
      text: 'never mind, tell me a joke',
    });
    await idle();
    expect(await events()).toContainEqual(
      expect.objectContaining({
        type: 'offer.resolved',
        offerId: offer?.offerId,
        outcome: 'expired',
      }),
    );
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/conversations/${sent.id}/offers/${offer?.offerId}/accept`,
      payload: {},
    });
    expect(accepted.statusCode).toBe(409);
    expect(accepted.json()).toMatchObject({ error: 'gone' });
  });

  it('the map is in the system text for providers with tools, and the offer tool only with someone there', async () => {
    const { services } = await setup();
    const engine = services.providers.engine();
    const section = await services.offers.section(engine);
    expect(section).toMatch(/^## What Conch can turn on/);
    expect(section).toContain('- app `linear`: Linear (Issues and projects)');
    expect(section.length).toBeLessThanOrEqual(2400);
    // A routine's run gets none of it.
    const run = await services.conversations.start({
      title: 'Morning check',
      text: 'what’s on my plate this week?',
      origin: { kind: 'routine', routineId: 'r1', runId: 'run1' },
      extras: {},
    });
    await run.result;
    expect(await services.offers.section(engine, run.conversationId)).toBe('');
    const log = (await services.conversations.detail(run.conversationId)).events;
    expect(log.some((e) => e.type === 'offer')).toBe(false);
  });
});
