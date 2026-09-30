import type { AddressInfo } from 'node:net';

import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

export interface MockSlackMessage {
  channel: string;
  ts: string;
  text: string;
  blocks: {
    type: string;
    text?: unknown;
    elements?: { action_id: string; value: string; style?: string; text: { text: string } }[];
  }[];
  updated?: boolean;
}

interface Socket {
  send(data: string): void;
  close(code?: number): void;
  readyState: number;
  on(event: 'message', listener: (raw: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
}

/**
 * A pretend Slack for tests, E2E and `pnpm dev:mock`: the Web API methods
 * Conch calls, and Socket Mode (a WebSocket that says hello, wants every
 * envelope acknowledged, and sometimes asks for a fresh connection).
 *
 * Tests speak for the person with `say()` / `press()`, and break things:
 * `revoke()`, `refresh()` (Slack's routine reconnect), `disableSocketMode()`,
 * `noMarkdownBlocks` (an older workspace).
 */
export class MockSlack {
  #app?: FastifyInstance;
  #sockets = new Set<Socket>();
  #nextTs = 1;
  #envelope = 1;
  base = '';
  static readonly BOT_TOKEN = 'xoxb-' + '1111111111-2222222222-mockmockmockmockmockmock';
  static readonly APP_TOKEN = 'xapp-1-A0MOCKAPP-3333333333-mockmockmockmockmockmockmock';
  static readonly OTHER_APP_TOKEN = 'xapp-1-A0OTHERAPP-4444444444-mockmockmockmockmockmockmock';
  static readonly OWNER = { id: 'U0ADA', name: 'ada', real_name: 'Ada Lovelace' };
  readonly botTokens = new Set([MockSlack.BOT_TOKEN]);
  readonly appTokens = new Map([
    [MockSlack.APP_TOKEN, 'A0MOCKAPP'],
    [MockSlack.OTHER_APP_TOKEN, 'A0OTHERAPP'],
  ]);
  readonly sent: MockSlackMessage[] = [];
  readonly calls: { method: string; params: Record<string, string> }[] = [];
  readonly acked = new Set<string>();
  readonly reactions: { name: string; added: boolean; ts: string }[] = [];
  noMarkdownBlocks = false;
  connections = 0;

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false });
    this.#app = app;
    await app.register(fastifyWebsocket);
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    app.post<{ Params: { method: string } }>('/api/:method', (request) =>
      this.#method(
        request.params.method,
        (request.body ?? {}) as Record<string, string>,
        request.headers.authorization?.replace(/^Bearer /, '') ?? '',
      ),
    );
    app.get('/socket', { websocket: true }, (socket) => this.#socket(socket as unknown as Socket));
    app.post<{ Params: { action: string } }>('/__control/:action', (request) => {
      const body = (request.body ?? {}) as { text?: string; value?: string; ts?: string };
      if (request.params.action === 'say') this.say(body.text ?? '');
      else if (request.params.action === 'press') this.press(body.value ?? '', body.ts ?? '');
      else if (request.params.action === 'sent') return this.sent;
      return { ok: true };
    });
    await app.listen({ port, host: '127.0.0.1' });
    this.base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    return this.base;
  }

  async stop() {
    for (const socket of this.#sockets) socket.close(1001);
    await this.#app?.close();
  }

  get api() {
    return `${this.base}/api`;
  }

  // ── The person's side ──────────────────────────────────────────────────

  say(text: string, from = MockSlack.OWNER.id, extra: Record<string, unknown> = {}) {
    this.#envelopeOut('events_api', {
      event: {
        type: 'message',
        channel_type: 'im',
        channel: `D${from}`,
        user: from,
        text,
        ts: `${Date.now() / 1000}`,
        ...extra,
      },
    });
  }

  press(value: string, ts: string, from = MockSlack.OWNER.id) {
    this.#envelopeOut('interactive', {
      type: 'block_actions',
      user: { id: from, name: 'ada' },
      channel: { id: `D${from}` },
      message: { ts },
      actions: [{ action_id: value, value, type: 'button' }],
    });
  }

  last(channel = `D${MockSlack.OWNER.id}`) {
    return this.sent.filter((m) => m.channel === channel).at(-1);
  }

  // ── Breaking it on purpose ─────────────────────────────────────────────

  revoke() {
    this.botTokens.clear();
    this.appTokens.clear();
    for (const socket of this.#sockets) socket.close(1000);
  }

  /** Slack's routine "please reconnect". */
  refresh() {
    for (const socket of this.#sockets)
      socket.send(JSON.stringify({ type: 'disconnect', reason: 'refresh_requested' }));
  }

  disableSocketMode() {
    for (const socket of this.#sockets)
      socket.send(JSON.stringify({ type: 'disconnect', reason: 'link_disabled' }));
  }

  // ── Wire ───────────────────────────────────────────────────────────────

  #envelopeOut(type: string, payload: unknown) {
    const envelope = JSON.stringify({ envelope_id: `env${this.#envelope++}`, type, payload });
    for (const socket of this.#sockets) if (socket.readyState === 1) socket.send(envelope);
  }

  #socket(socket: Socket) {
    this.connections++;
    this.#sockets.add(socket);
    socket.on('close', () => this.#sockets.delete(socket));
    socket.on('message', (raw) => {
      const ack = JSON.parse(raw.toString()) as { envelope_id?: string };
      if (ack.envelope_id) this.acked.add(ack.envelope_id);
    });
    socket.send(
      JSON.stringify({
        type: 'hello',
        connection_info: { app_id: 'A0MOCKAPP' },
        num_connections: 1,
      }),
    );
  }

  #method(method: string, params: Record<string, string>, token: string) {
    this.calls.push({ method, params });
    if (method === 'apps.connections.open') {
      const app = this.appTokens.get(token);
      if (!app) return { ok: false, error: 'invalid_auth' };
      return { ok: true, url: `${this.base.replace('http', 'ws')}/socket?ticket=t&app_id=${app}` };
    }
    if (!this.botTokens.has(token)) return { ok: false, error: 'invalid_auth' };
    switch (method) {
      case 'auth.test':
        return {
          ok: true,
          url: 'https://mock.slack.com/',
          team: 'Mock Workspace',
          team_id: 'T0MOCK',
          user: 'conch',
          user_id: 'U0BOT',
          bot_id: 'B0BOT',
        };
      case 'bots.info':
        return { ok: true, bot: { id: 'B0BOT', app_id: 'A0MOCKAPP', name: 'Conch', icons: {} } };
      case 'users.info':
        return {
          ok: true,
          user: {
            id: params.user,
            name: MockSlack.OWNER.name,
            real_name: MockSlack.OWNER.real_name,
            profile: { real_name: MockSlack.OWNER.real_name },
          },
        };
      case 'conversations.open':
        return { ok: true, channel: { id: `D${params.users}` } };
      case 'chat.postMessage':
      case 'chat.update': {
        const blocks = JSON.parse(params.blocks ?? '[]') as MockSlackMessage['blocks'];
        if (this.noMarkdownBlocks && blocks.some((b) => b.type === 'markdown'))
          return { ok: false, error: 'invalid_blocks' };
        const ts = method === 'chat.postMessage' ? `${this.#nextTs++}.000100` : (params.ts ?? '');
        this.sent.push({
          channel: params.channel ?? '',
          ts,
          text: params.text ?? '',
          blocks,
          ...(method === 'chat.update' && { updated: true }),
        });
        return { ok: true, ts, channel: params.channel };
      }
      case 'reactions.add':
      case 'reactions.remove':
        this.reactions.push({
          name: params.name ?? '',
          added: method === 'reactions.add',
          ts: params.timestamp ?? '',
        });
        return { ok: true };
      default:
        return { ok: false, error: 'unknown_method' };
    }
  }
}
