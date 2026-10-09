/**
 * Providers and chat apps made with Conch (ADR 0122), end to end on the
 * real parts: a whole gateway with the mock engine as the maker, the sealed
 * runtime, the quality bar, and the pretend world's model company and chat
 * app. The person asks, the card's **Test it** runs a real one-line answer
 * (or says who the bot is), **Add** keeps what they typed where Conch keeps
 * its own, the provider answers a chat, and a hello comes through the chat
 * app into the same channel service every built-in uses.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConchAppOffer, ConversationEvent, ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { onThisComputer } from '../test/here';
import { chat } from '../test/session';
import { PARLEY_TOKEN, PRETEND_AI_KEY, PRETEND_MODEL } from './pretend';

vi.setConfig({ testTimeout: 90_000 });

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-extensions-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  delete process.env.CONCH_MOCK_STATE;
  const app = onThisComputer(await buildApp(services), services);
  await app.ready();
  await services.start();
  close = async () => {
    services.stop();
    await services.conchApps.stop();
    await app.close();
  };
  const world = services.pretendWorld;
  if (!world) throw new Error('no pretend world');
  await world.start();
  return { home, app, services, world };
}

const offerIn = (events: readonly ConversationEvent[]) => {
  const latest = new Map<string, ConchAppOffer>();
  for (const e of events) if (e.type === 'conch-app.offer') latest.set(e.offer.offerId, e.offer);
  return [...latest.values()].find((o) => o.state === 'ready');
};

async function until<T>(fn: () => T | Promise<T>, what: string, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** What the assistant said in a chat, as one string. */
const said = (events: readonly ConversationEvent[]) =>
  events
    .flatMap((e) => (e.type === 'assistant.delta' && e.kind === 'text' ? [e.delta] : []))
    .join('');

describe('a provider made with Conch', () => {
  it('is made from a sentence, tested with a real line, added, and answers a chat', async () => {
    const g = await setup();
    const convo = await chat(g.services, 'add Pretend AI as a provider');
    const events = (await g.services.conversations.detail(convo.id)).events;
    const offer = offerIn(events);
    expect(said(events)).toMatch(/Paste your Pretend AI key into the card, press Test it/);
    expect(offer?.manifest.provider).toMatchObject({ speaks: 'openai' });
    if (!offer) return;
    // Nothing is a provider before the press.
    expect(g.services.providers.listed()).not.toContain('app-pretend-ai');

    const test = (key: string) =>
      g.app.inject({
        method: 'POST',
        url: `/api/conch-apps/offers/${offer.offerId}/test`,
        payload: { conversationId: convo.id, key },
      });
    expect((await test('pai-' + 'wrong')).json()).toMatchObject({
      ok: false,
      part: 'provider',
      message: expect.stringMatching(/refused your key/),
    });
    expect((await test(PRETEND_AI_KEY)).json()).toMatchObject({
      ok: true,
      said: 'Hello from Pretend AI!',
      model: PRETEND_MODEL,
    });

    const added = await g.app.inject({
      method: 'POST',
      url: `/api/conch-apps/offers/${offer.offerId}/accept`,
      payload: { conversationId: convo.id, parts: { key: PRETEND_AI_KEY } },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).not.toHaveProperty('partProblem');

    // A provider like any other: Settings → Providers, ready, marked as made here.
    const providers = (await g.app.inject({ method: 'GET', url: '/api/providers' })).json() as {
      providers: { id: string; ready: boolean; contributed?: unknown; key?: { hint: string } }[];
    };
    const mine = providers.providers.find((p) => p.id === 'app-pretend-ai');
    expect(mine).toMatchObject({
      ready: true,
      contributed: { app: 'pretend-ai', from: 'made', speaks: 'openai' },
    });
    // Its key is kept with every provider key, and never comes back whole.
    expect(mine?.key?.hint).toMatch(/0001$/);
    expect(JSON.stringify(providers)).not.toContain(PRETEND_AI_KEY);

    // The model picker lists its model, and it answers a chat with Conch's tools.
    const catalog = await g.services.providers.models();
    expect(catalog.providers.find((p) => p.engine === 'app-pretend-ai')?.models).toEqual([
      expect.objectContaining({ id: PRETEND_MODEL, label: 'Pretend One' }),
    ]);
    const answered = new Promise<string>((resolve) => {
      let text = '';
      const off = g.services.conversations.events.on((event: ServerEvent) => {
        if (event.type !== 'conversation.event') return;
        const e = event.event;
        if (e.type === 'assistant.delta' && e.kind === 'text') text += e.delta;
        if (e.type === 'turn.completed') {
          off();
          resolve(text);
        }
      });
    });
    await g.services.conversations.send({
      clientMessageId: 'm-pretend',
      text: 'hi there',
      options: { engine: 'app-pretend-ai', model: PRETEND_MODEL },
    });
    expect(await answered).toMatch(/Hello from Pretend AI\. You said: “hi there”/);

    // Taking the app away takes its provider, and its key.
    await g.app.inject({ method: 'DELETE', url: '/api/conch-apps/pretend-ai' });
    await until(() => !g.services.providers.listed().includes('app-pretend-ai'), 'provider gone');
    expect(await g.services.keys.has('app-pretend-ai')).toBe(false);
  });
});

describe('a chat app made with Conch', () => {
  it('is made, tested with the bot’s token, added, and a hello comes through it', async () => {
    const g = await setup();
    const convo = await chat(g.services, 'connect me on Parley');
    const offer = offerIn((await g.services.conversations.detail(convo.id)).events);
    expect(offer?.manifest.channel).toMatchObject({ name: 'Parley', receives: 'poll' });
    if (!offer) return;
    const test = (token: string) =>
      g.app.inject({
        method: 'POST',
        url: `/api/conch-apps/offers/${offer.offerId}/test`,
        payload: { conversationId: convo.id, fields: { token } },
      });
    expect((await test('parley-' + 'wrong')).json()).toMatchObject({
      ok: false,
      part: 'channel',
      message: expect.stringMatching(/refused the token|401/),
    });
    expect((await test(PARLEY_TOKEN)).json()).toMatchObject({
      ok: true,
      said: 'Connected as Conch on Parley (@conch)',
    });

    const added = await g.app.inject({
      method: 'POST',
      url: `/api/conch-apps/offers/${offer.offerId}/accept`,
      payload: { conversationId: convo.id, parts: { fields: { token: PARLEY_TOKEN } } },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).not.toHaveProperty('partProblem');

    // A channel like any other, on the app's own card, with its tile in Talk to me here.
    const list = await g.services.channels.list();
    const channel = list.channels.find((c) => c.kind === 'app');
    expect(channel).toMatchObject({
      app: 'capp_parley',
      contributed: { app: 'parley', name: 'Parley' },
      bot: { name: 'Conch on Parley', username: 'conch' },
    });
    expect(list.catalog.find((c) => c.id === 'app:parley')?.contributed?.from).toBe('made');
    if (!channel) return;
    await until(
      async () => (await g.services.channels.get(channel.id)).health.state === 'online',
      'online',
    );
    // Its token stays with the channel's keys, never on the page.
    expect(JSON.stringify(list)).not.toContain(PARLEY_TOKEN);

    // Nobody gets in by default: the first hello is a request, until you say it's you.
    g.world.say({ id: 'ada', name: 'Ada' }, 'hello');
    const request = await until(
      async () => (await g.services.channels.get(channel.id)).requests[0],
      'the hello',
    );
    expect(request).toMatchObject({ name: 'Ada', preview: 'hello' });
    await g.services.channels.answer(channel.id, request.id, 'allow');
    await until(() => g.world.sent.some((m) => /Hi Ada!/.test(m.text)), 'the welcome');
    expect(g.world.sent.at(-1)?.chat).toBe('dm-ada');

    // Then a message is a chat, answered back through Parley.
    const before = g.world.sent.length;
    g.world.say({ id: 'ada', name: 'Ada' }, 'What can you do?');
    await until(() => g.world.sent.length > before, 'an answer');
    const conversations = await g.services.conversations.list();
    expect(
      conversations.find((c) => c.origin?.kind === 'channel' && c.origin.channel === 'app'),
    ).toBeTruthy();

    // A refused token: the channel says so and stops, rather than knocking forever.
    await fetch(`${g.world.base}/__control/revoke`, { method: 'POST' });
    await until(
      async () => (await g.services.channels.get(channel.id)).health.state === 'needs-token',
      'needs-token',
    );
  });
});

/** Parley made in a chat, added with its token, and the owner let in. */
async function parley(g: Awaited<ReturnType<typeof setup>>) {
  const convo = await chat(g.services, 'connect me on Parley');
  const offer = offerIn((await g.services.conversations.detail(convo.id)).events);
  if (!offer) throw new Error('no card');
  await g.app.inject({
    method: 'POST',
    url: `/api/conch-apps/offers/${offer.offerId}/accept`,
    payload: { conversationId: convo.id, parts: { fields: { token: PARLEY_TOKEN } } },
  });
  const channel = (await g.services.channels.list()).channels.find((c) => c.kind === 'app');
  if (!channel) throw new Error('no channel');
  g.world.say({ id: 'ada', name: 'Ada' }, 'hello');
  const request = await until(
    async () => (await g.services.channels.get(channel.id)).requests[0],
    'the hello',
  );
  await g.services.channels.answer(channel.id, request.id, 'allow');
  await until(() => g.world.sent.some((m) => /Hi Ada!/.test(m.text)), 'the welcome');
  return channel;
}

const resolved = async (g: Awaited<ReturnType<typeof setup>>) => {
  const conversation = (await g.services.conversations.list()).find(
    (c) => c.origin?.kind === 'channel' && c.origin.channel === 'app',
  );
  const events = conversation ? await g.services.conversations.eventsAfter(conversation.id) : [];
  return events.filter((e) => e.type === 'permission.resolved');
};

describe('approvals in a chat app from an app', () => {
  it('made here: asks with numbered answers, and a reply of 1 allows', async () => {
    const g = await setup();
    await parley(g);
    const before = g.world.sent.length;
    g.world.say({ id: 'ada', name: 'Ada' }, 'please run the tests');
    const question = await until(
      () => g.world.sent.slice(before).find((m) => /would like to/.test(m.text)),
      'the question',
    );
    expect(question.text).toMatch(/Reply with a number: \*\*1\*\* Allow/);
    g.world.say({ id: 'ada', name: 'Ada' }, '1');
    await until(
      async () =>
        (await resolved(g)).some((e) => e.type === 'permission.resolved' && e.decision === 'allow'),
      'allowed',
    );
  });

  it('from someone else: its code could press for you, so questions and settings wait in Conch', async () => {
    const g = await setup();
    await parley(g);
    // As if Parley had come from a link: its code says who's writing, so it isn't the owner's word.
    vi.spyOn(g.services.extensions, 'trusted').mockReturnValue(false);
    const before = g.world.sent.length;
    g.world.say({ id: 'ada', name: 'Ada' }, 'please run the tests');
    const question = await until(
      () => g.world.sent.slice(before).find((m) => /would like to/.test(m.text)),
      'the question',
    );
    expect(question.text).toMatch(/Answer it in Conch: Parley comes from someone else/);
    expect(question.text).not.toMatch(/Reply with a number/);
    // A forged "1" (or "yes") from the chat app answers nothing.
    g.world.say({ id: 'ada', name: 'Ada' }, '1');
    g.world.say({ id: 'ada', name: 'Ada' }, 'yes');
    await new Promise((r) => setTimeout(r, 600));
    expect(await resolved(g)).toEqual([]);
    // Settings that grant trust aren't taken from it either.
    const sent = g.world.sent.length;
    g.world.say({ id: 'ada', name: 'Ada' }, '/mode full');
    await until(
      () => g.world.sent.slice(sent).find((m) => /settings are changed in Conch/.test(m.text)),
      'refused the setting',
    );
  });
});
