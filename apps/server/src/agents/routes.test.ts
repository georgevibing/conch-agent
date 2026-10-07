import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Agent,
  AgentList,
  AvatarGeneration,
  type ConversationEvent,
  FIRST_AGENT_ID,
  GeneratedAvatar,
  type ConversationSummary,
  type ServerEvent,
} from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { carriesSecret, jpeg, png } from '../test/faces';
import { NOT_HERE, onThisComputer } from '../test/here';
import { facePrompt } from './routes';

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  const home = await mkdtemp(join(tmpdir(), 'conch-agent-routes-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const events: ServerEvent[] = [];
  services.broadcast.on((e: ServerEvent) => events.push(e));
  const app = onThisComputer(await buildApp(services), services);
  await app.ready();
  return { services, app, events, home };
}

type App = Awaited<ReturnType<typeof setup>>['app'];
const json = (
  app: App,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) => app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }) });

async function until(services: Services, id: string) {
  for (let i = 0; i < 300; i++) {
    const { conversation } = await services.conversations.detail(id);
    if (conversation.status === 'idle' && !conversation.titling) return conversation;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('never idle');
}

afterEach(() => vi.restoreAllMocks());

describe('the agents routes', () => {
  it('list, make, change, order and choose the default, and tell every tab', async () => {
    const { app, events, services } = await setup();
    const listed = AgentList.parse((await json(app, 'GET', '/api/agents')).json());
    expect(listed.agents.map((a) => a.id)).toEqual([FIRST_AGENT_ID]);

    const made = await json(app, 'POST', '/api/agents', {
      name: 'Sage',
      role: 'Plans trips',
      persona: { tone: 'calm', personality: 'Unhurried' },
      instructions: 'Give two options.',
    });
    expect(made.statusCode).toBe(200);
    const sage = Agent.parse(made.json());
    expect(events.some((e) => e.type === 'agents.changed')).toBe(true);

    const got = Agent.parse((await json(app, 'GET', `/api/agents/${sage.id}`)).json());
    expect(got.name).toBe('Sage');
    expect((await json(app, 'GET', '/api/agents/ag_never_was')).statusCode).toBe(404);

    const changed = await json(app, 'PATCH', `/api/agents/${sage.id}`, { name: 'Sage II' });
    expect(Agent.parse(changed.json()).name).toBe('Sage II');

    const ordered = await json(app, 'PUT', '/api/agents/order', { ids: [sage.id, FIRST_AGENT_ID] });
    expect(AgentList.parse(ordered.json()).agents[0]?.id).toBe(sage.id);
    const chosen = await json(app, 'PUT', '/api/agents/default', { id: sage.id });
    expect(AgentList.parse(chosen.json()).defaultId).toBe(sage.id);

    // The older Settings read the default agent as `persona`.
    const state = (await json(app, 'GET', '/api/state')).json() as { persona: { name: string } };
    expect(state.persona.name).toBe('Sage II');

    // Setup and the older Settings change the default agent through `persona`; the file an
    // older Conch reads keeps a tone it knows.
    const set = await json(app, 'PATCH', '/api/settings', { persona: { tone: 'calm' } });
    expect((set.json() as { persona: { tone: string } }).persona.tone).toBe('calm');
    expect((await services.agents.default()).persona.tone).toBe('calm');
    expect((await services.settings.get()).persona.tone).toBe('warm');
    expect(
      (await json(app, 'PATCH', '/api/settings', { persona: { name: 'conch' } })).statusCode,
    ).toBe(409);

    expect((await json(app, 'DELETE', `/api/agents/${sage.id}`)).json()).toEqual({ ok: true });
    expect((await json(app, 'DELETE', `/api/agents/${FIRST_AGENT_ID}`)).statusCode).toBe(409);
  });

  it('checks every body: unknown fields, limits, Full trust, a name that’s taken, an id that’s a path', async () => {
    const { app } = await setup();
    const bad = async (method: 'POST' | 'PATCH' | 'PUT', url: string, payload: unknown) =>
      (await json(app, method, url, payload)).statusCode;
    expect(await bad('POST', '/api/agents', { name: '' })).toBe(400);
    expect(await bad('POST', '/api/agents', { name: 'x'.repeat(41) })).toBe(400);
    expect(await bad('POST', '/api/agents', { name: 'A', instructions: 'x'.repeat(8001) })).toBe(
      400,
    );
    expect(await bad('POST', '/api/agents', { name: 'A', isAdmin: true })).toBe(400);
    expect(
      await bad('POST', '/api/agents', {
        name: 'A',
        defaults: { permissionMode: 'bypassPermissions' },
      }),
    ).toBe(400);
    // A picture of its own only through its route: never an address the page makes up.
    expect(
      await bad('POST', '/api/agents', {
        name: 'A',
        avatar: { kind: 'image', id: 'im_abcd', type: 'image/png', url: 'https://evil.example/x' },
      }),
    ).toBe(400);
    expect(await bad('POST', '/api/agents', { name: 'conch' })).toBe(409);
    expect(await bad('PATCH', `/api/agents/${FIRST_AGENT_ID}`, {})).toBe(400);
    expect(await bad('PUT', '/api/agents/order', { ids: ['ag_never_was'] })).toBe(409);
    expect((await json(app, 'GET', '/api/agents/..%2F..%2Fsecrets')).statusCode).toBe(404);
  });

  it('answers nobody who isn’t signed in', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['GET', '/api/agents'],
      ['POST', '/api/agents'],
      ['PUT', `/api/agents/${FIRST_AGENT_ID}/avatar`],
      ['POST', '/api/agents/avatar/generate'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { [NOT_HERE]: '1' },
        payload: { name: 'Sneaky' },
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('keeps a picture without its metadata and serves it only as the picture it is', async () => {
    const { app } = await setup();
    const put = await json(app, 'PUT', `/api/agents/${FIRST_AGENT_ID}/avatar`, {
      data: jpeg(64, { exif: true }).toString('base64'),
    });
    expect(put.statusCode).toBe(200);
    const agent = Agent.parse(put.json());
    if (agent.avatar.kind !== 'image') throw new Error('no image');
    const served = await app.inject(agent.avatar.url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe("default-src 'none'");
    expect(carriesSecret(served.rawPayload)).toBe(false);
    // Not to someone who isn't signed in.
    expect(
      (await app.inject({ url: agent.avatar.url, headers: { [NOT_HERE]: '1' } })).statusCode,
    ).toBe(401);

    const svg = await json(app, 'PUT', `/api/agents/${FIRST_AGENT_ID}/avatar`, {
      data: Buffer.from('<svg onload="alert(1)"/>').toString('base64'),
    });
    expect(svg.statusCode).toBe(400);
    expect(svg.json().message).toMatch(/document/);
    const huge = await json(app, 'PUT', `/api/agents/${FIRST_AGENT_ID}/avatar`, {
      data: 'A'.repeat(1_200_000),
    });
    expect([400, 413]).toContain(huge.statusCode);
  });

  it('makes a picture only when a provider can, and hands back only a clean picture', async () => {
    const { app, services } = await setup();
    const none = AvatarGeneration.parse(
      (await json(app, 'GET', '/api/agents/avatar/generate')).json(),
    );
    expect(none.available).toBe(false);
    expect(none.reason).toMatch(/OpenRouter/);
    expect(
      (await json(app, 'POST', '/api/agents/avatar/generate', { prompt: 'an owl' })).statusCode,
    ).toBe(409);

    vi.spyOn(services.images, 'canMake').mockResolvedValue(true);
    const face = vi
      .spyOn(services.images, 'face')
      .mockResolvedValue({ bytes: png(64, { text: true }), mimeType: 'image/png', costUsd: 0.04 });
    expect(
      AvatarGeneration.parse((await json(app, 'GET', '/api/agents/avatar/generate')).json()),
    ).toMatchObject({ available: true, by: 'OpenRouter', paid: true });
    const made = await json(app, 'POST', '/api/agents/avatar/generate', {
      prompt: 'a friendly owl',
      name: 'Sage',
      tone: 'calm',
    });
    expect(made.statusCode).toBe(200);
    const picture = GeneratedAvatar.parse(made.json());
    expect(picture).toMatchObject({ type: 'image/png', costUsd: 0.04 });
    expect(carriesSecret(Buffer.from(picture.data, 'base64'))).toBe(false);
    expect(face.mock.calls[0]?.[0]).toBe(
      facePrompt({ prompt: 'a friendly owl', name: 'Sage', tone: 'calm' }),
    );

    // Something that isn't a picture never reaches the page.
    face.mockResolvedValueOnce({ bytes: Buffer.from('<svg/>'), mimeType: 'image/png' });
    expect(
      (await json(app, 'POST', '/api/agents/avatar/generate', { prompt: 'x' })).statusCode,
    ).toBe(502);
    expect(
      (await json(app, 'POST', '/api/agents/avatar/generate', { prompt: '' })).statusCode,
    ).toBe(400);
  });

  it('frames what the model is asked to draw', () => {
    const prompt = facePrompt({ prompt: 'a fox in a scarf', name: 'Milo', tone: 'playful' });
    expect(prompt).toMatch(/square avatar/);
    expect(prompt).toMatch(/Milo/);
    expect(prompt).toMatch(/a fox in a scarf/);
    expect(prompt).toMatch(/No text/);
  });
});

describe('a chat’s agent', () => {
  it('starts with the agent chosen, and its choices of provider and mode', async () => {
    const { services } = await setup();
    const sage = await services.agents.create({
      name: 'Sage',
      defaults: { engine: 'mock', permissionMode: 'acceptEdits' },
    });
    const chat = await services.conversations.send({
      clientMessageId: 'u-1',
      text: 'hello',
      agentId: sage.id,
    });
    expect(chat.agentId).toBe(sage.id);
    expect(chat.options).toMatchObject({ engine: 'mock', permissionMode: 'acceptEdits' });
    await until(services, chat.id);
    // What the message chose wins over the agent's.
    const other = await services.conversations.send({
      clientMessageId: 'u-2',
      text: 'hi',
      agentId: sage.id,
      options: { permissionMode: 'plan' },
    });
    expect(other.options.permissionMode).toBe('plan');
    await until(services, other.id);
  });

  it('starts with the default agent when none is chosen, or the chosen one is gone', async () => {
    const { services } = await setup();
    const plain = await services.conversations.send({ clientMessageId: 'u-1', text: 'hello' });
    expect(plain.agentId).toBe(FIRST_AGENT_ID);
    await until(services, plain.id);
    const gone = await services.conversations.send({
      clientMessageId: 'u-2',
      text: 'hello',
      agentId: 'ag_never_was',
    });
    expect(gone.agentId).toBe(FIRST_AGENT_ID);
    await until(services, gone.id);
  });

  it('changes mid-chat with a divider that says who answered before, the first time', async () => {
    const { app, services } = await setup();
    const sage = await services.agents.create({ name: 'Sage' });
    const milo = await services.agents.create({ name: 'Milo' });
    const chat = await services.conversations.send({ clientMessageId: 'u-1', text: 'hello' });
    await until(services, chat.id);

    const patch = (agentId: string) =>
      app.inject({ method: 'PATCH', url: `/api/conversations/${chat.id}`, payload: { agentId } });
    expect((await patch(sage.id)).statusCode).toBe(200);
    expect((await patch(sage.id)).statusCode).toBe(200);
    expect((await patch(milo.id)).statusCode).toBe(200);
    expect((await patch('ag_never_was')).statusCode).toBe(404);
    expect((await patch('../escape')).statusCode).toBe(400);

    const { conversation, events } = await services.conversations.detail(chat.id);
    expect((conversation as ConversationSummary).agentId).toBe(milo.id);
    const dividers = events.filter(
      (e): e is Extract<ConversationEvent, { type: 'agent' }> => e.type === 'agent',
    );
    expect(dividers.map((d) => [d.agentId, d.name, d.from?.name])).toEqual([
      [sage.id, 'Sage', 'Conch'],
      [milo.id, 'Milo', undefined],
    ]);
    // Kept across a restart.
    const again = new Services(services.config);
    expect((await again.conversations.detail(chat.id)).conversation.agentId).toBe(milo.id);
  });
});
