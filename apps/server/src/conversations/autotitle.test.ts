import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationSummary, ServerEvent } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import type { MockEngine } from '../engines/mock/engine';
import { Services } from '../services';

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const home = await mkdtemp(join(tmpdir(), 'conch-title-'));
  const services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  const events: ServerEvent[] = [];
  services.conversations.events.on((e) => events.push(e));
  return { services, events, engine: services.engine() as MockEngine };
}

/** Resolves with the summary once the conversation stops titling. */
function titled(events: ServerEvent[], services: Services, id: string) {
  return new Promise<ConversationSummary>((resolve) => {
    const check = (e: ServerEvent) => {
      if (e.type === 'conversation.updated' && e.conversation.id === id && !e.conversation.titling)
        resolve(e.conversation);
    };
    services.conversations.events.on(check);
  });
}

async function idle(services: Services, id: string) {
  while ((await services.conversations.detail(id)).conversation.status !== 'idle') {
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function send(services: Services, text: string) {
  return services.conversations.send({ clientMessageId: 'u1', text });
}

describe('automatic titles', () => {
  it('shows the first line while titling, then a descriptive title', async () => {
    const { services, events, engine } = await setup();
    const convo = await send(services, 'Hi conch how are you');
    expect(convo).toMatchObject({ title: 'Hi conch how are you', titling: true });
    const created = events.find((e) => e.type === 'conversation.created');
    expect(created?.type === 'conversation.created' && created.conversation.titling).toBe(true);

    const done = await titled(events, services, convo.id);
    expect(done.title).toBe('Friendly check-in');
    expect(engine.completions).toEqual(['haiku']);

    // Saved: a fresh process sees the new title, not a stuck spinner.
    await new Promise((r) => setTimeout(r, 200));
    const fresh = new Services(services.config);
    const detail = await fresh.conversations.detail(convo.id);
    expect(detail.conversation.title).toBe('Friendly check-in');
    expect(detail.conversation.titling).toBeUndefined();
    expect(detail.events.some((e) => e.type === 'title' && e.title === 'Friendly check-in')).toBe(
      true,
    );
  });

  it('keeps the first line when the title is not good enough or fails', async () => {
    const { services, events } = await setup();
    for (const text of ['untitled please', 'title-fail now']) {
      const convo = await send(services, text);
      const done = await titled(events, services, convo.id);
      expect(done.title).toBe(text);
      expect(done.titling).toBeUndefined();
    }
  });

  it("lets the user's rename win over a title still being written", async () => {
    const { services, events } = await setup();
    const convo = await send(services, 'Help me plan a trip to Lisbon');
    await services.conversations.rename(convo.id, 'Lisbon!');
    await new Promise((r) => setTimeout(r, 200));
    const [summary] = await services.conversations.list();
    expect(summary).toMatchObject({ title: 'Lisbon!' });
    expect(summary?.titling).toBeUndefined();
    const titles = events.flatMap((e) =>
      e.type === 'conversation.event' && e.event.type === 'title' ? [e.event.title] : [],
    );
    expect(titles).toEqual(['Lisbon!']);
  });

  it('only titles new chats, and not when turned off', async () => {
    const { services, events, engine } = await setup();
    const first = await send(services, 'Explain monads simply');
    const done = await titled(events, services, first.id);
    expect(done.title).toBe('Explain monads simply');
    await idle(services, first.id);
    await services.conversations.send({
      conversationId: first.id,
      clientMessageId: 'u2',
      text: 'now with an example',
    });
    expect(engine.completions).toHaveLength(1);

    await services.settings.update({ preferences: { autoTitle: false } });
    const off = await send(services, 'Rewrite my cover letter');
    expect(off.titling).toBeUndefined();
    expect(off.title).toBe('Rewrite my cover letter');
    expect(engine.completions).toHaveLength(1);
  });

  it('adds what titling cost to the spend ledger, on a key you pay as you go', async () => {
    process.env.CONCH_MOCK_USAGE = 'metered';
    try {
      const { services, events } = await setup();
      const convo = await send(services, 'Hello there');
      await titled(events, services, convo.id);
      await new Promise((r) => setTimeout(r, 300));
      const snapshot = await services.usage.snapshot();
      expect(snapshot.spend.today).toBeGreaterThanOrEqual(0.0002);
    } finally {
      delete process.env.CONCH_MOCK_USAGE;
    }
  });

  it('counts no money for titling on a plan (ADR 0073)', async () => {
    const { services, events } = await setup();
    const convo = await send(services, 'Hello there');
    await titled(events, services, convo.id);
    await idle(services, convo.id);
    await new Promise((r) => setTimeout(r, 300));
    const snapshot = await services.usage.snapshot();
    expect(snapshot.spend.today).toBe(0);
  });
});
