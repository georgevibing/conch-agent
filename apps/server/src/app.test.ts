import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app';
import { loadConfig } from './config';
import { Services } from './services';

async function setup(env: Record<string, string> = {}) {
  process.env.CONCH_MOCK_SPEED = '0.05';
  const home = await mkdtemp(join(tmpdir(), 'conch-app-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
    ...env,
  });
  const services = new Services(config);
  const app = await buildApp(services);
  return { app, services, home };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('gateway HTTP', () => {
  it('serves app state and saves settings', async () => {
    const { app } = await setup();
    close = () => app.close();
    const state = (await app.inject('/api/state')).json();
    expect(state).toMatchObject({
      onboarded: false,
      persona: { name: 'Conch' },
      engine: { state: 'ready' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { onboarded: true, persona: { tone: 'playful' }, profile: { name: 'Ada' } },
    });
    expect(res.json()).toMatchObject({
      onboarded: true,
      persona: { name: 'Conch', tone: 'playful' },
      profile: { name: 'Ada' },
    });
  });

  it('rejects foreign hosts and cross-origin writes', async () => {
    const { app } = await setup();
    close = () => app.close();
    expect(
      (await app.inject({ url: '/api/state', headers: { host: 'evil.example' } })).statusCode,
    ).toBe(421);
    const cross = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { origin: 'https://evil.example' },
      payload: {},
    });
    expect(cross.statusCode).toBe(403);
    const same = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { origin: 'http://localhost:5173' },
      payload: {},
    });
    expect(same.statusCode).toBe(200);
  });

  it('requires the token in remote mode', async () => {
    const { app } = await setup({ CONCH_TOKEN: 'a-very-long-secret-token' });
    close = () => app.close();
    expect((await app.inject('/api/state')).statusCode).toBe(401);
    const ok = await app.inject('/api/state?token=a-very-long-secret-token');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['set-cookie']).toContain('HttpOnly');
  });

  it('manages memories', async () => {
    const { app } = await setup();
    close = () => app.close();
    const created = (
      await app.inject({ method: 'POST', url: '/api/memories', payload: { content: 'Likes tea' } })
    ).json();
    expect(created).toMatchObject({ content: 'Likes tea', source: 'user' });
    await app.inject({
      method: 'PATCH',
      url: `/api/memories/${created.id}`,
      payload: { content: 'Likes green tea' },
    });
    expect((await app.inject('/api/memories')).json()[0].content).toBe('Likes green tea');
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/memories/${created.id}` })).statusCode,
    ).toBe(200);
    expect((await app.inject('/api/memories')).json()).toEqual([]);
  });
});

describe('gateway WebSocket', () => {
  it('runs a full turn with memory, permission and streaming', async () => {
    const { app, services } = await setup();
    close = () => app.close();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const events: ServerEvent[] = [];
    const done = new Promise<void>((resolve) => {
      ws.onmessage = (msg) => {
        const event = ServerEvent.parse(JSON.parse(String(msg.data)));
        events.push(event);
        if (event.type === 'conversation.event' && event.event.type === 'permission.requested') {
          ws.send(
            JSON.stringify({
              type: 'permission.respond',
              conversationId: event.event.conversationId,
              permissionId: event.event.permissionId,
              decision: 'allow',
            }),
          );
        }
        if (event.type === 'conversation.event' && event.event.type === 'turn.completed') resolve();
      };
    });
    await new Promise((r) => (ws.onopen = r));
    ws.send(
      JSON.stringify({
        type: 'conversation.send',
        clientMessageId: 'u1',
        text: 'Remember that I love espresso, then list files',
      }),
    );
    await done;
    ws.close();

    const convoEvents = events.flatMap((e) => (e.type === 'conversation.event' ? [e.event] : []));
    const types = convoEvents.map((e) => e.type);
    expect(events[0]?.type).toBe('hello');
    expect(events.some((e) => e.type === 'conversation.created')).toBe(true);
    expect(types).toEqual(
      expect.arrayContaining([
        'user.message',
        'memory.saved',
        'permission.requested',
        'permission.resolved',
        'tool.started',
        'tool.finished',
        'assistant.delta',
        'turn.completed',
      ]),
    );
    expect(convoEvents.map((e) => e.seq)).toEqual(
      [...convoEvents.map((e) => e.seq)].sort((a, b) => a - b),
    );
    expect((await services.memory.list())[0]?.content).toContain('I love espresso');

    // History survives a restart of the manager (fresh Services on the same home).
    const [summary] = await services.conversations.list();
    const fresh = new Services(services.config);
    const detail = await fresh.conversations.detail(summary!.id);
    expect(detail.events.some((e) => e.type === 'assistant.delta')).toBe(true);
    expect(detail.conversation.status).toBe('idle');
  });

  it('refuses to send when the engine is not ready', async () => {
    process.env.CONCH_MOCK_STATE = 'signed-out';
    const { app } = await setup();
    delete process.env.CONCH_MOCK_STATE;
    close = () => app.close();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const error = new Promise<ServerEvent>((resolve) => {
      ws.onmessage = (msg) => {
        const event = ServerEvent.parse(JSON.parse(String(msg.data)));
        if (event.type === 'error') resolve(event);
      };
    });
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ type: 'conversation.send', clientMessageId: 'u1', text: 'hi' }));
    expect(await error).toMatchObject({ code: 'engine-unavailable', clientMessageId: 'u1' });
    ws.close();
  });
});
