import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ServerEvent, UsageSnapshot } from '@conch/protocol';
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

  it('lists providers, and refuses a made-up one', async () => {
    const { app } = await setup();
    close = () => app.close();
    const list = (await app.inject('/api/providers')).json();
    // CONCH_ENGINE=mock pins the choice, so the list says so instead of offering a switch.
    expect(list).toMatchObject({ active: 'mock', pinned: expect.stringContaining('CONCH_ENGINE') });
    expect((await app.inject({ method: 'POST', url: '/api/providers/nope/use' })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: 'POST', url: '/api/providers/claude-code/use' })).statusCode,
    ).toBe(409);
  });

  it('takes a provider key without ever giving it back', async () => {
    const { app, home } = await setup();
    close = () => app.close();
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/providers/mock/key',
      payload: { value: 'sk-mock-0123456789' },
    });
    // The mock provider takes no key at all, and says so rather than pretending.
    expect(saved.statusCode).toBe(400);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/providers/openrouter/key',
      payload: { value: 'short' },
    });
    expect(bad.statusCode).toBe(400);
    expect(await readFile(join(home, 'secrets.json'), 'utf8').catch(() => '')).not.toContain(
      'short',
    );
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
      headers: { host: 'localhost:5173', origin: 'http://localhost:5173' },
      payload: {},
    });
    expect(same.statusCode).toBe(200);
  });

  it('treats a legacy CONCH_TOKEN as an access key', async () => {
    const { app } = await setup({ CONCH_TOKEN: 'a-very-long-secret-token' });
    close = () => app.close();
    expect((await app.inject('/api/state')).statusCode).toBe(401);
    // Never accepted in the URL, where it would land in logs and history.
    expect((await app.inject('/api/state?token=a-very-long-secret-token')).statusCode).toBe(401);
    const bearer = await app.inject({
      url: '/api/state',
      headers: { authorization: 'Bearer a-very-long-secret-token' },
    });
    expect(bearer.statusCode).toBe(200);
  });

  it('never turns a URL into a path outside its folder', async () => {
    const { app, home } = await setup();
    close = () => app.close();
    const victim = join(home, 'victim.md');
    await writeFile(victim, 'keep me');
    for (const url of [
      '/api/commands/..%2Fvictim',
      '/api/conversations/..%2Fvictim',
      '/api/memories/..%2F..%2Fvictim',
      '/api/routines/..%2Fvictim',
    ]) {
      const res = await app.inject({ method: 'DELETE', url });
      expect(res.statusCode, url).toBeGreaterThanOrEqual(400);
    }
    expect(await readFile(victim, 'utf8')).toBe('keep me');
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

describe('gateway capabilities and commands', () => {
  it('lists models, modes and custom commands', async () => {
    const { app } = await setup();
    close = () => app.close();
    const caps = (await app.inject('/api/capabilities')).json();
    expect(caps.models.map((m: { id: string }) => m.id)).toContain('opus');
    expect(caps.permissionModes).toContain('bypassPermissions');
    expect(
      (await app.inject('/api/commands')).json().map((c: { name: string }) => c.name),
    ).toContain('tldr');
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/commands/standup',
      payload: { description: 'd', prompt: 'p' },
    });
    expect(saved.json()).toMatchObject({ name: 'standup', prompt: 'p' });
    expect(
      (await app.inject({ method: 'PUT', url: '/api/commands/Bad Name', payload: { prompt: 'p' } }))
        .statusCode,
    ).toBe(400);
  });
});

describe('gateway usage', () => {
  it('reports plan limits and validates budgets', async () => {
    const { app, services } = await setup();
    close = async () => {
      services.usage.stop();
      await app.close();
    };
    const usage = UsageSnapshot.parse((await app.inject('/api/usage')).json());
    expect(usage).toMatchObject({ kind: 'plan', source: 'Claude Max' });
    expect(usage.windows.map((w) => w.id)).toEqual(['session', 'weekly', 'weekly-opus']);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/usage/budget',
      payload: { budget: -1 },
    });
    expect(bad.statusCode).toBe(400);
    const set = await app.inject({
      method: 'PUT',
      url: '/api/usage/budget',
      payload: { budget: 50 },
    });
    expect(UsageSnapshot.parse(set.json()).spend.budget).toBe(50);
  });

  it('switches to spend tracking for metered sign-ins', async () => {
    process.env.CONCH_MOCK_USAGE = 'metered';
    const { app, services } = await setup();
    delete process.env.CONCH_MOCK_USAGE;
    close = async () => {
      services.usage.stop();
      await app.close();
    };
    const usage = UsageSnapshot.parse((await app.inject('/api/usage?refresh=1')).json());
    expect(usage).toMatchObject({ kind: 'metered', source: 'Amazon Bedrock', windows: [] });
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
    const detail = await fresh.conversations.detail(summary?.id ?? '');
    expect(detail.events.some((e) => e.type === 'assistant.delta')).toBe(true);
    expect(detail.conversation.status).toBe('idle');
  });

  it('applies per-conversation options and shows retry notices', async () => {
    const { app, services } = await setup();
    await services.settings.update({ preferences: { model: 'sonnet', effort: 'high' } });
    close = () => app.close();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const events: ServerEvent[] = [];
    const done = new Promise<void>((resolve) => {
      ws.onmessage = (msg) => {
        const event = ServerEvent.parse(JSON.parse(String(msg.data)));
        events.push(event);
        if (event.type === 'conversation.event' && event.event.type === 'turn.completed') resolve();
      };
    });
    await new Promise((r) => (ws.onopen = r));
    ws.send(
      JSON.stringify({
        type: 'conversation.send',
        clientMessageId: 'u1',
        text: 'please retry this',
        options: { fastMode: true, permissionMode: 'plan' },
      }),
    );
    await done;
    ws.close();
    const convo = events.flatMap((e) => (e.type === 'conversation.event' ? [e.event] : []));
    expect(convo.some((e) => e.type === 'notice' && e.code === 'retry')).toBe(true);
    const text = convo
      .flatMap((e) => (e.type === 'assistant.delta' && e.kind === 'text' ? [e.delta] : []))
      .join('');
    // Defaults (sonnet/high) merged with this conversation's overrides (fast/plan).
    expect(text).toContain('sonnet · high effort · fast · plan');
    const [summary] = await services.conversations.list();
    expect(summary?.options).toEqual({ fastMode: true, permissionMode: 'plan' });
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
