/**
 * Talking to an outside agent (ADR 0112): what a paste is, reading a card of
 * either A2A version, answers of every shape, and the abuse cases — a card
 * pointing elsewhere, answers that are far too big, a key sent only where it
 * belongs, and addresses Conch never connects to.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  A2aClient,
  A2aError,
  cardPlaces,
  KeyNeeded,
  readAnswer,
  readCard,
  readPaste,
  stateOf,
} from './client';

const HOST = 'https://203.0.113.5';
const v1Card = {
  name: 'Travel',
  description: 'Finds flights.',
  version: '2.1',
  supportedInterfaces: [
    { url: `${HOST}/grpc`, protocolBinding: 'GRPC', protocolVersion: '1.0' },
    { url: `${HOST}/a2a/v1`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
  ],
  capabilities: { streaming: true },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'f', name: 'Flights', description: 'Finds flights', tags: [] }],
  provider: { organization: 'Example Travel', url: 'https://example.com' },
  securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'bearer' } } },
};
const v03Card = {
  name: 'Old Agent',
  description: 'Speaks 0.3',
  url: `${HOST}/rpc`,
  protocolVersion: '0.3.0',
  preferredTransport: 'JSONRPC',
  skills: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('a paste', () => {
  it('finds the address and the key, whatever is around them', () => {
    const conch = readPaste(`Address: ${HOST}/a2a/ag_sage\nKey: cmcp.mcpc_abc.${'x'.repeat(43)}`);
    expect(conch.url?.href).toBe(`${HOST}/a2a/ag_sage`);
    expect(conch.key).toBe(`cmcp.mcpc_abc.${'x'.repeat(43)}`);
    expect(readPaste(`${HOST}/agent token=abcdefghijklmnopqrstuvwxyz`).key).toBe(
      'abcdefghijklmnopqrstuvwxyz',
    );
    expect(readPaste(`see ${HOST}/x.`).url?.href).toBe(`${HOST}/x`);
    expect(readPaste('just words').url).toBeUndefined();
  });

  it('looks for the card where it lives, then in the well-known places', () => {
    expect(cardPlaces(new URL(`${HOST}/a2a/ag_sage`)).map((u) => u.pathname)).toEqual([
      '/a2a/ag_sage/.well-known/agent-card.json',
      '/.well-known/agent-card.json',
      '/.well-known/agent.json',
    ]);
    expect(cardPlaces(new URL(`${HOST}/my/card.json`)).map((u) => u.pathname)).toEqual([
      '/my/card.json',
    ]);
  });
});

describe('a card', () => {
  it('reads A2A 1.0: the first JSON-RPC interface', () => {
    const card = readCard(v1Card, new URL(`${HOST}/.well-known/agent-card.json`));
    expect(card).toMatchObject({
      name: 'Travel',
      protocol: '1.0',
      by: 'Example Travel',
      wantsKey: true,
      skills: [{ name: 'Flights', description: 'Finds flights' }],
    });
    expect(card.endpoint.href).toBe(`${HOST}/a2a/v1`);
  });

  it('reads A2A 0.3', () => {
    const card = readCard(v03Card, new URL(`${HOST}/.well-known/agent-card.json`));
    expect(card).toMatchObject({ protocol: '0.3', wantsKey: false });
    expect(card.endpoint.href).toBe(`${HOST}/rpc`);
  });

  it('won’t send messages, or a key, anywhere but where it lives', () => {
    expect(() =>
      readCard({ ...v03Card, url: 'http://169.254.169.254/latest' }, new URL(`${HOST}/c.json`)),
    ).toThrow(/send messages to 169\.254\.169\.254/);
    expect(() =>
      readCard({ ...v03Card, url: `https://user:pw@203.0.113.5/rpc` }, new URL(`${HOST}/c.json`)),
    ).toThrow(/password/);
  });

  it('says plainly what it can’t use', () => {
    expect(() =>
      readCard(
        { name: 'X', supportedInterfaces: [{ url: HOST, protocolBinding: 'GRPC' }] },
        new URL(HOST),
      ),
    ).toThrow(/gRPC or REST/);
    expect(() => readCard({ hello: 1 }, new URL(HOST))).toThrow(/not with an agent’s card/);
  });

  it('cleans what it shows: control characters out, lengths kept', () => {
    const card = readCard(
      { ...v03Card, name: `Evil\u0000\u001b[31m${'n'.repeat(200)}`, description: 'd'.repeat(5000) },
      new URL(`${HOST}/c.json`),
    );
    expect(card.name).not.toMatch(/\p{Cc}/u);
    expect(card.name.length).toBeLessThanOrEqual(60);
    expect(card.description.length).toBeLessThanOrEqual(400);
  });
});

describe('answers', () => {
  it('reads a message, a finished task, and both versions’ spellings', () => {
    expect(readAnswer({ message: { parts: [{ text: 'Hi' }], contextId: 'c' } }, 'T')).toEqual({
      kind: 'done',
      text: 'Hi',
      contextId: 'c',
    });
    expect(
      readAnswer(
        {
          task: {
            id: 't',
            contextId: 'c',
            status: { state: 'TASK_STATE_COMPLETED' },
            artifacts: [{ parts: [{ text: 'Flights at 9' }] }],
          },
        },
        'T',
      ),
    ).toMatchObject({ kind: 'done', text: 'Flights at 9' });
    expect(
      readAnswer(
        {
          kind: 'task',
          id: 't',
          status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'ok' }] } },
        },
        'T',
      ),
    ).toMatchObject({ kind: 'done', text: 'ok' });
    expect(stateOf('TASK_STATE_INPUT_REQUIRED')).toBe('input-required');
  });

  it('says what a task that didn’t finish wants', () => {
    expect(() =>
      readAnswer({ task: { id: 't', status: { state: 'TASK_STATE_AUTH_REQUIRED' } } }, 'T'),
    ).toThrow(/sign in/);
    expect(() =>
      readAnswer(
        {
          task: {
            id: 't',
            status: { state: 'TASK_STATE_FAILED', message: { parts: [{ text: 'no seats' }] } },
          },
        },
        'T',
      ),
    ).toThrow(/no seats/);
    expect(
      readAnswer(
        {
          task: {
            id: 't',
            status: {
              state: 'TASK_STATE_INPUT_REQUIRED',
              message: { parts: [{ text: 'Which day?' }] },
            },
          },
        },
        'T',
      ),
    ).toMatchObject({
      kind: 'done',
      text: expect.stringContaining('mention it again'),
    });
  });
});

describe('the client', () => {
  it('reads the card with the key, at the host it was pasted for only', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      if (String(url).endsWith('/a2a/ag_x/.well-known/agent-card.json'))
        return auth === 'Bearer k' ? json(v1Card) : json({}, 401);
      return json({}, 404);
    });
    const client = new A2aClient(fetch as unknown as typeof globalThis.fetch);
    const read = await client.card(new URL(`${HOST}/a2a/ag_x`), 'k');
    expect(read.card.name).toBe('Travel');
    expect(read.reach).toBe('public');
    await expect(client.card(new URL(`${HOST}/a2a/ag_x`))).rejects.toBeInstanceOf(KeyNeeded);
  });

  it('never connects to cloud metadata or link-local addresses', async () => {
    const fetch = vi.fn(async () => json(v03Card));
    const client = new A2aClient(fetch as unknown as typeof globalThis.fetch);
    await expect(client.card(new URL('http://169.254.169.254/'))).rejects.toThrow(A2aError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a card far too big to be one', async () => {
    const fetch = vi.fn(async () => new Response('x'.repeat(300 * 1024)));
    const client = new A2aClient(fetch as unknown as typeof globalThis.fetch);
    await expect(client.card(new URL(`${HOST}/card.json`))).rejects.toThrow(/too big/);
  });

  it('sends A2A 1.0, follows a task until it’s done, and keeps the conversation', async () => {
    const bodies: { method: string; params: Record<string, unknown> }[] = [];
    let polls = 0;
    const fetch = vi.fn(async (_url: URL | string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      bodies.push(body);
      expect(new Headers(init?.headers).get('a2a-version')).toBe('1.0');
      if (body.method === 'SendMessage')
        return json({
          jsonrpc: '2.0',
          id: body.id,
          result: { task: { id: 't1', contextId: 'c1', status: { state: 'TASK_STATE_WORKING' } } },
        });
      polls++;
      return json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          id: 't1',
          contextId: 'c1',
          status: {
            state: polls > 1 ? 'TASK_STATE_COMPLETED' : 'TASK_STATE_WORKING',
            message: { parts: [{ text: 'Done: 9am' }] },
          },
        },
      });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 200 });
    try {
      const client = new A2aClient(fetch as unknown as typeof globalThis.fetch);
      const answer = await client.send(
        { name: 'Travel', endpoint: `${HOST}/a2a/v1`, protocol: '1.0', reach: 'public' },
        { text: 'flights?', contextId: 'c1', signal: new AbortController().signal },
      );
      expect(answer).toEqual({ text: 'Done: 9am', contextId: 'c1' });
    } finally {
      vi.useRealTimers();
    }
    const sent = bodies[0]?.params.message as {
      role: string;
      parts: { text: string }[];
      contextId: string;
    };
    expect(sent).toMatchObject({
      role: 'ROLE_USER',
      parts: [{ text: 'flights?' }],
      contextId: 'c1',
    });
    expect(bodies.slice(1).every((b) => b.method === 'GetTask')).toBe(true);
  });

  it('asks again the 0.3 way when an agent doesn’t know 1.0’s names', async () => {
    const methods: string[] = [];
    const fetch = vi.fn(async (_url: URL | string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: string; method: string };
      methods.push(body.method);
      if (body.method === 'SendMessage')
        return json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Method not found' },
        });
      return json({
        jsonrpc: '2.0',
        id: body.id,
        result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: 'hello' }] },
      });
    });
    const client = new A2aClient(fetch as unknown as typeof globalThis.fetch);
    const answer = await client.send(
      { name: 'T', endpoint: `${HOST}/rpc`, protocol: '1.0', reach: 'public' },
      { text: 'hi', signal: new AbortController().signal },
    );
    expect(answer.text).toBe('hello');
    expect(methods).toEqual(['SendMessage', 'message/send']);
  });

  it('turns refusals into words, and tries a passing failure once more', async () => {
    const refused = new A2aClient((async () =>
      json({}, 401)) as unknown as typeof globalThis.fetch);
    await expect(
      refused.send(
        { name: 'T', endpoint: `${HOST}/rpc`, protocol: '0.3', reach: 'public' },
        { text: 'hi', signal: new AbortController().signal },
      ),
    ).rejects.toThrow(/didn’t accept Conch’s key/);
    let calls = 0;
    const flaky = new A2aClient((async (_u: unknown, init?: RequestInit) => {
      calls++;
      const id = (JSON.parse(String(init?.body)) as { id: string }).id;
      return calls === 1
        ? json({}, 503)
        : json({ jsonrpc: '2.0', id, result: { message: { parts: [{ text: 'back' }] } } });
    }) as unknown as typeof globalThis.fetch);
    const answer = await flaky.send(
      { name: 'T', endpoint: `${HOST}/rpc`, protocol: '1.0', reach: 'public' },
      { text: 'hi', signal: new AbortController().signal },
    );
    expect(answer.text).toBe('back');
    expect(calls).toBe(2);
  });

  it('cuts an answer that says too much, and says so', async () => {
    const client = new A2aClient((async (_u: unknown, init?: RequestInit) => {
      const id = (JSON.parse(String(init?.body)) as { id: string }).id;
      return json({
        jsonrpc: '2.0',
        id,
        result: { message: { parts: [{ text: 'y'.repeat(30_000) }] } },
      });
    }) as unknown as typeof globalThis.fetch);
    const answer = await client.send(
      { name: 'T', endpoint: `${HOST}/rpc`, protocol: '1.0', reach: 'public' },
      { text: 'hi', signal: new AbortController().signal },
    );
    expect(answer.text.length).toBeLessThan(20_200);
    expect(answer.text).toContain('T said more');
  });
});
