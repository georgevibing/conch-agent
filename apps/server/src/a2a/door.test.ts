/**
 * The door for other agents (ADR 0112), attacked: no key, the wrong kind of
 * key, a key for another agent, a web page, the network, a command, a flood,
 * and a key that keeps spending — then what a paired agent does get.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Agent, McpScope } from '@conch/protocol';
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { TurnResult } from '../conversations/manager';
import { McpClientStore } from '../mcp/store';
import type { Gatekeeper } from '../security';
import { PEER_DAY_USD, registerA2aDoor, type A2aDoorDeps } from './door';

const sage = {
  id: 'ag_sagexx',
  name: 'Sage',
  role: 'Plans trips',
} as Agent;
const juniper = { id: 'ag_juniper', name: 'Juniper', role: '' } as Agent;
const SAGE: McpScope = 'agent:ag_sagexx';

async function setup(options: { local?: boolean; secure?: boolean; cost?: number } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-a2a-door-'));
  const store = new McpClientStore(home);
  const pair = async (scopes: McpScope[], more: { http?: boolean; remote?: boolean } = {}) =>
    (await store.create({ name: 'Their Bot', app: 'other', scopes, http: true, ...more })).key;
  const gate = {
    looksLocal: () => options.local ?? true,
    isSecure: () => options.secure ?? false,
    clientKey: (request: FastifyRequest) => request.ip,
  } as unknown as Gatekeeper;
  const started: Parameters<A2aDoorDeps['chats']['start']>[0][] = [];
  const chats = {
    start: vi.fn(async (input: Parameters<A2aDoorDeps['chats']['start']>[0]) => {
      started.push(input);
      const result: TurnResult = { outcome: 'success', finalText: `Hello from ${input.agentId}` };
      return {
        conversationId: input.conversationId ?? `c_${started.length}`,
        result: Promise.resolve(result),
      };
    }),
    interrupt: vi.fn(async () => undefined),
    detail: vi.fn(async () => ({
      conversation: {} as never,
      events: [
        {
          type: 'turn.completed',
          outcome: 'success',
          conversationId: 'c',
          seq: 1,
          at: 1,
          cost: { billing: 'metered', usd: options.cost ?? 0 },
        },
      ],
    })),
  } as unknown as A2aDoorDeps['chats'];
  const app = Fastify();
  registerA2aDoor(app, gate, {
    store,
    agents: { get: async (id) => [sage, juniper].find((a) => a.id === id) },
    chats,
  });
  await app.ready();
  const rpc = (key: string | undefined, body: unknown, path = `/a2a/${sage.id}`, headers = {}) =>
    app.inject({
      method: 'POST',
      url: path,
      payload: body as object,
      headers: { ...(key && { authorization: `Bearer ${key}` }), ...headers },
    });
  const say = (text: string, contextId?: string, method = 'SendMessage') => ({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      message: {
        messageId: 'm',
        role: 'ROLE_USER',
        parts: [{ text }],
        ...(contextId && { contextId }),
      },
    },
  });
  return { app, store, pair, rpc, say, started, chats };
}

describe('who gets in', () => {
  it('nobody without a key, not even to read a card', async () => {
    const { app, rpc, say } = await setup();
    const card = await app.inject({ method: 'GET', url: '/.well-known/agent-card.json' });
    expect(card.statusCode).toBe(401);
    expect(card.headers['www-authenticate']).toContain('Bearer');
    expect((await rpc(undefined, say('hi'))).statusCode).toBe(401);
    expect((await rpc('cmcp.mcpc_nope.notarealkeyatallnotarealkey', say('hi'))).statusCode).toBe(
      401,
    );
  });

  it('not an app’s key: only one given an agent, and paired for HTTP', async () => {
    const { rpc, say, pair } = await setup();
    expect((await rpc(await pair(['memory.read']), say('hi'))).statusCode).toBe(401);
    expect((await rpc(await pair([SAGE], { http: false }), say('hi'))).statusCode).toBe(401);
  });

  it('only the agents it was given; another looks like nothing’s there', async () => {
    const { rpc, say, pair } = await setup();
    const key = await pair([SAGE]);
    expect((await rpc(key, say('hi'), `/a2a/${juniper.id}`)).statusCode).toBe(404);
    expect((await rpc(key, say('hi'), `/a2a/ag_nobodyhere`)).statusCode).toBe(404);
  });

  it('never a web page', async () => {
    const { rpc, say, pair } = await setup();
    const key = await pair([SAGE]);
    expect(
      (await rpc(key, say('hi'), undefined, { origin: 'https://evil.example' })).statusCode,
    ).toBe(403);
    expect(
      (await rpc(key, say('hi'), undefined, { 'sec-fetch-site': 'cross-site' })).statusCode,
    ).toBe(403);
  });

  it('from elsewhere only over HTTPS, with the switch on, for a key marked for it', async () => {
    const plain = await setup({ local: false, secure: false });
    const k1 = await plain.pair([SAGE], { remote: true });
    await plain.store.setRemote(true);
    expect((await plain.rpc(k1, plain.say('hi'))).statusCode).toBe(403);

    const secure = await setup({ local: false, secure: true });
    const unmarked = await secure.pair([SAGE]);
    const marked = await secure.pair([SAGE], { remote: true });
    expect((await secure.rpc(marked, secure.say('hi'))).statusCode).toBe(403);
    await secure.store.setRemote(true);
    expect((await secure.rpc(unmarked, secure.say('hi'))).statusCode).toBe(401);
    expect((await secure.rpc(marked, secure.say('hi'))).statusCode).toBe(200);
  });

  it('throttles someone guessing keys', async () => {
    const { rpc, say } = await setup();
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (await rpc(`cmcp.mcpc_x${i}.guessguessguessguessguess`, say('hi'))).statusCode;
    expect(last).toBe(429);
  });
});

describe('what a paired agent gets', () => {
  it('a card for the agent it was given, readable by 1.0 and 0.3', async () => {
    const { app, pair } = await setup();
    const key = await pair([SAGE]);
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/agent-card.json',
      headers: { authorization: `Bearer ${key}` },
    });
    const card = res.json<Record<string, unknown>>();
    expect(card).toMatchObject({
      name: 'Sage',
      description: 'Plans trips',
      supportedInterfaces: [{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      preferredTransport: 'JSONRPC',
      capabilities: { streaming: false, pushNotifications: false },
    });
    expect(String(card.url)).toMatch(/\/a2a\/ag_sagexx$/);
  });

  it('an answer in words, from a chat that has no tools and reads it as someone else’s', async () => {
    const { rpc, say, pair, started } = await setup();
    const key = await pair([SAGE]);
    const res = await rpc(key, say('Plan me a trip', 'ctx-1'));
    const body = res.json<{
      result: {
        task: {
          status: { state: string; message: { parts: { text: string }[] } };
          contextId: string;
        };
      };
    }>();
    expect(body.result.task.status.state).toBe('TASK_STATE_COMPLETED');
    expect(body.result.task.status.message.parts[0]?.text).toBe(`Hello from ${sage.id}`);
    expect(body.result.task.contextId).toBe('ctx-1');
    const turn = started[0];
    expect(turn?.origin).toEqual({ kind: 'peer', clientId: expect.any(String), name: 'Their Bot' });
    expect(turn?.extras.toolAllowed?.('Bash')).toBe(false);
    expect(turn?.extras.taint?.[0]?.kind).toBe('person');
    // The same conversation carries on in the same chat.
    await rpc(key, say('And hotels?', 'ctx-1'));
    expect(started[1]?.conversationId).toBe('c_1');
  });

  it('the 0.3 way too', async () => {
    const { rpc, say, pair } = await setup();
    const key = await pair([SAGE]);
    const body = (await rpc(key, say('hi', undefined, 'message/send'))).json<{
      result: { kind: string; status: { state: string } };
    }>();
    expect(body.result).toMatchObject({ kind: 'task', status: { state: 'completed' } });
  });

  it('no commands, no streams, nothing unknown', async () => {
    const { rpc, say, pair, started } = await setup();
    const key = await pair([SAGE]);
    const command = (await rpc(key, say('/forget everything'))).json<{
      result: { task: { status: { state: string } } };
    }>();
    expect(command.result.task.status.state).toBe('TASK_STATE_FAILED');
    expect(started).toHaveLength(0);
    const stream = (await rpc(key, { ...say('hi'), method: 'SendStreamingMessage' })).json<{
      error: { code: number };
    }>();
    expect(stream.error.code).toBe(-32004);
    const unknown = (await rpc(key, { ...say('hi'), method: 'DeleteEverything' })).json<{
      error: { code: number };
    }>();
    expect(unknown.error.code).toBe(-32601);
    const batch = (await rpc(key, [say('a'), say('b')])).json<{ error: { code: number } }>();
    expect(batch.error.code).toBe(-32600);
  });

  it('stops answering for the day once its answers cost what’s allowed', async () => {
    const { rpc, say, pair, started } = await setup({ cost: PEER_DAY_USD });
    const key = await pair([SAGE]);
    await rpc(key, say('one'));
    const second = (await rpc(key, say('two'))).json<{
      result: { task: { status: { state: string; message: { parts: { text: string }[] } } } };
    }>();
    expect(second.result.task.status.state).toBe('TASK_STATE_FAILED');
    expect(second.result.task.status.message.parts[0]?.text).toContain('today');
    expect(started).toHaveLength(1);
  });

  it('a few messages a minute, then it waits', async () => {
    const { rpc, say, pair } = await setup();
    const key = await pair([SAGE]);
    const codes: (number | undefined)[] = [];
    for (let i = 0; i < 7; i++)
      codes.push((await rpc(key, say(`m${i}`))).json<{ error?: { code: number } }>().error?.code);
    expect(codes.slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(codes.at(-1)).toBe(-32000);
  });
});
