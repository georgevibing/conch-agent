/**
 * Quiet learning end to end (ADR 0087): the real gateway with the mock
 * engine, whose quick look at a chat turns "no, I meant X" into a preference.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LearningStatus, type ConversationEvent, type ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { onThisComputer } from '../test/here';

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const services = new Services(
    loadConfig({
      CONCH_HOME: await mkdtemp(join(tmpdir(), 'conch-quiet-api-')),
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  open.push(app);
  services.learning.stop();
  return { services, app };
}

function send(services: Services, text: string, conversationId?: string) {
  return new Promise<string>((resolve) => {
    const off = services.broadcast.on((event: ServerEvent) => {
      if (event.type === 'conversation.event' && event.event.type === 'turn.completed') {
        off();
        resolve(event.event.conversationId);
      }
    });
    void services.conversations.send({
      clientMessageId: `m${Math.random()}`,
      text,
      ...(conversationId && { conversationId }),
    });
  });
}

describe('quiet learning through the gateway (ADR 0087)', () => {
  it('learns a correction, says so in the chat, and Undo takes it back for good', async () => {
    const { services, app } = await setup();
    const id = await send(services, 'Write me a script to rename photos');
    await send(services, 'No, I meant TypeScript.', id);
    const result = await services.learning.review(id, { trigger: 'idle' });
    expect('learned' in result && result.learned.map((e) => e.after.content)).toEqual([
      'Prefers TypeScript',
    ]);

    const status = LearningStatus.parse(
      JSON.parse((await app.inject({ method: 'GET', url: '/api/learning' })).body),
    );
    expect(status.entries[0]).toMatchObject({ state: 'applied', from: { conversationId: id } });
    const { events } = await services.conversations.detail(id);
    const noted = events.find(
      (e): e is Extract<ConversationEvent, { type: 'learning.noted' }> =>
        e.type === 'learning.noted',
    );
    expect(noted?.items[0]).toMatchObject({ text: 'Prefers TypeScript', state: 'applied' });

    const undo = await app.inject({
      method: 'POST',
      url: '/api/learning/answer',
      payload: { entryId: status.entries[0]?.id, answer: 'undo' },
    });
    expect(undo.statusCode).toBe(200);
    expect(JSON.parse(undo.body).state).toBe('undone');
    expect((await services.memory.list()).some((m) => m.content === 'Prefers TypeScript')).toBe(
      false,
    );
    const after = LearningStatus.parse(
      JSON.parse((await app.inject({ method: 'GET', url: '/api/learning' })).body),
    );
    expect(after.never.map((n) => n.text)).toEqual(['Prefers TypeScript']);
    // Let it be learned again.
    const removed = await app.inject({
      method: 'POST',
      url: '/api/learning/never/remove',
      payload: { id: after.never[0]?.id },
    });
    expect(JSON.parse(removed.body)).toEqual({ removed: true });
  });

  it('a chat marked not to learn from stays out', async () => {
    const { services, app } = await setup();
    const id = await send(services, 'Write a poem');
    await send(services, 'No, I meant a haiku.', id);
    const quiet = await app.inject({
      method: 'PUT',
      url: `/api/learning/chats/${id}`,
      payload: { quiet: true },
    });
    expect(JSON.parse(quiet.body)).toEqual({ quiet: true });
    expect(await services.learning.review(id, { trigger: 'idle' })).toEqual({ why: 'quiet' });
    const status = LearningStatus.parse(
      JSON.parse((await app.inject({ method: 'GET', url: '/api/learning' })).body),
    );
    expect(status.quiet).toEqual([id]);
  });

  it('only a person sets what learning may spend; bad answers are refused', async () => {
    const { app } = await setup();
    const set = await app.inject({
      method: 'PUT',
      url: '/api/learning/spending',
      payload: { limitUsd: 3 },
    });
    expect(JSON.parse(set.body)).toMatchObject({ limitUsd: 3, isDefault: false });
    for (const [method, url, payload] of [
      ['PUT', '/api/learning/spending', { limitUsd: -1 }],
      ['PUT', '/api/learning/spending', { limitUsd: 2, sneaky: true }],
      ['POST', '/api/learning/answer', { entryId: 'le_1', answer: 'apply' }],
      ['PUT', '/api/learning/chats/c1', { quiet: 'yes' }],
      ['POST', '/api/learning/never/remove', {}],
    ] as const)
      expect((await app.inject({ method, url, payload })).statusCode, url).toBe(400);
    // Something that isn't a chat's id is refused before it's written anywhere.
    const odd = await app.inject({
      method: 'PUT',
      url: '/api/learning/chats/not%20a%20chat!',
      payload: { quiet: true },
    });
    expect(odd.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/learning/answer',
          payload: { entryId: 'le_missing', answer: 'undo' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('Repair everything says how learning is doing', async () => {
    const { services } = await setup();
    const report = await services.doctor.run({ repair: false });
    const item = report.items.find((i) => i.id === 'learning:record');
    expect(item).toMatchObject({ state: 'ok', group: 'Your data' });
  });
});
