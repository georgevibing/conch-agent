/**
 * The mock engine's pretend world for apps that bring a provider or a chat
 * app (ADR 0119), for `pnpm dev:mock`, the e2e journey and tests: a pretend
 * model company, **Pretend AI** (`api.pretend-ai.example`, OpenAI's chat
 * shape), and a pretend chat app, **Parley** (`chat.parley.example`, a bot
 * API anyone could write an adapter for), both on one server on this
 * computer. Only the mock engine routes those two exact hosts here; nothing
 * else ever does, and nothing here reaches the internet.
 *
 * Tests speak for people on Parley with `/__control/say`, read what the bot
 * sent with `/__control/sent`, and break things with `/__control/revoke`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The pretend company's key and the pretend bot's token, written in two parts (agreement 6). */
export const PRETEND_AI_KEY = 'pai-' + 'pretendpretendpretend0001';
export const PARLEY_TOKEN = 'parley-' + 'bottokenbottoken0001';

export const PRETEND_HOSTS = {
  'api.pretend-ai.example': 'pretend-ai',
  'chat.parley.example': 'parley',
} as const;

export const PRETEND_MODEL = 'pretend-1';

interface ParleyMessage {
  id: number;
  chat: string;
  from: { id: string; name: string };
  text: string;
}

export class PretendWorld {
  #server?: Server;
  #port = 0;
  /** What people wrote to the bot, in order. */
  #inbox: ParleyMessage[] = [];
  /** What the bot sent. */
  readonly sent: { chat: string; text: string }[] = [];
  #tokens = new Set([PARLEY_TOKEN]);
  #next = 1;

  /** Where a pretend host's request goes on this computer, or nothing for any other host. */
  route = (url: URL): string | undefined => {
    const key = PRETEND_HOSTS[url.hostname as keyof typeof PRETEND_HOSTS];
    if (!key || !this.#port || url.protocol !== 'https:') return undefined;
    return `http://127.0.0.1:${this.#port}/${key}${url.pathname}${url.search}`;
  };

  /** The control address, for tests and the mock's `/api/channels/mock`. */
  get base(): string {
    return this.#port ? `http://127.0.0.1:${this.#port}` : '';
  }

  async start(): Promise<string> {
    if (this.#server) return this.base;
    const server = createServer((req, res) => void this.#serve(req, res));
    this.#server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.#port = (server.address() as AddressInfo).port;
    server.unref();
    return this.base;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.#server ? this.#server.close(() => resolve()) : resolve(),
    );
    this.#server = undefined;
    this.#port = 0;
  }

  /** Someone writes to the bot on Parley. */
  say(from: { id: string; name: string }, text: string, chat = `dm-${from.id}`) {
    this.#inbox.push({ id: this.#next++, chat, from, text });
  }

  async #serve(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const body = await new Promise<string>((resolve) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += String(chunk)));
      req.on('end', () => resolve(raw));
    });
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const read = () => {
      try {
        return body ? (JSON.parse(body) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const path = url.pathname;

    // ── Control ──
    if (path === '/__control/say' && req.method === 'POST') {
      const given = read();
      const from = (given.from as { id?: string; name?: string } | undefined) ?? {};
      this.say(
        { id: String(from.id ?? 'ada'), name: String(from.name ?? 'Ada') },
        String(given.text ?? ''),
      );
      return json(200, { ok: true });
    }
    if (path === '/__control/sent') return json(200, this.sent);
    if (path === '/__control/revoke' && req.method === 'POST') {
      this.#tokens.clear();
      return json(200, { ok: true });
    }
    if (path === '/__control/reset' && req.method === 'POST') {
      this.#inbox = [];
      this.sent.length = 0;
      this.#tokens = new Set([PARLEY_TOKEN]);
      return json(200, { ok: true });
    }

    // ── Pretend AI: OpenAI's chat shape ──
    if (path.startsWith('/pretend-ai/')) {
      if (bearer !== PRETEND_AI_KEY)
        return json(401, { error: { message: 'Invalid API key.', code: 'invalid_api_key' } });
      const rest = path.slice('/pretend-ai'.length);
      if (req.method === 'GET' && rest === '/v1/models')
        return json(200, {
          object: 'list',
          data: [{ id: PRETEND_MODEL, object: 'model', owned_by: 'pretend-ai', created: 1 }],
        });
      if (req.method === 'POST' && rest === '/v1/chat/completions') {
        const request = read() as {
          messages?: { role?: string; content?: unknown }[];
          tools?: unknown[];
        };
        const asked = [...(request.messages ?? [])].reverse().find((m) => m.role === 'user');
        const said = typeof asked?.content === 'string' ? asked.content : '';
        const words = (
          /five words or fewer/i.test(said)
            ? 'Hello from Pretend AI!'
            : `Hello from Pretend AI. You said: “${said.slice(0, 80)}”.`
        ).split(' ');
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
        for (const [i, word] of words.entries())
          send({
            id: 'p1',
            object: 'chat.completion.chunk',
            model: PRETEND_MODEL,
            choices: [{ index: 0, delta: { content: i ? ` ${word}` : word } }],
          });
        send({
          id: 'p1',
          object: 'chat.completion.chunk',
          model: PRETEND_MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 20,
            completion_tokens: words.length,
            total_tokens: 20 + words.length,
          },
        });
        res.end('data: [DONE]\n\n');
        return;
      }
      return json(404, { error: { message: 'Not found' } });
    }

    // ── Parley: a small bot API ──
    if (path.startsWith('/parley/')) {
      if (!bearer || !this.#tokens.has(bearer))
        return json(401, { error: 'That token isn’t a Parley bot’s.' });
      const rest = path.slice('/parley'.length);
      if (req.method === 'GET' && rest === '/api/me')
        return json(200, { id: 'bot-1', name: 'Conch on Parley', handle: 'conch' });
      if (req.method === 'GET' && rest === '/api/updates') {
        const after = Number(url.searchParams.get('after') ?? 0) || 0;
        return json(200, { messages: this.#inbox.filter((m) => m.id > after).slice(0, 50) });
      }
      if (req.method === 'POST' && rest === '/api/messages') {
        const given = read();
        const sent = { chat: String(given.chat ?? ''), text: String(given.text ?? '') };
        this.sent.push(sent);
        return json(200, { id: `out-${this.sent.length}` });
      }
      return json(404, { error: 'Not found' });
    }
    return json(404, { error: 'Not found' });
  }
}

/** The pretend world's two apps, as the mock engine makes them (ADR 0119). */
export function pretendProviderFiles(): Record<string, string> {
  return {
    'conch-app.json': `${JSON.stringify(
      {
        conch: 1,
        id: 'pretend-ai',
        name: 'Pretend AI',
        tagline: 'A pretend model company, for trying things out',
        description:
          'Answers chats with Pretend One, in OpenAI’s chat shape. Nothing here is real.',
        version: '1.0.0',
        icon: { glyph: 'sparkles', color: 'violet' },
        kind: 'developer',
        reaches: ['api.pretend-ai.example'],
        provider: {
          speaks: 'openai',
          address: 'https://api.pretend-ai.example/v1',
          key: {
            label: 'Pretend AI key',
            help: 'Any key from your Pretend AI account page.',
            link: 'https://api.pretend-ai.example/keys',
          },
          models: [
            {
              id: PRETEND_MODEL,
              name: 'Pretend One',
              context: 128000,
              tools: true,
              price: { input: 0.2, output: 0.6 },
            },
          ],
          small: PRETEND_MODEL,
        },
        instructions: '',
        examples: [],
      },
      null,
      2,
    )}\n`,
    'README.md': '# Pretend AI\n\nA pretend provider for Conch. A Conch app.\n',
  };
}

export function parleyFiles(): Record<string, string> {
  return {
    'conch-app.json': `${JSON.stringify(
      {
        conch: 1,
        id: 'parley',
        name: 'Parley',
        tagline: 'Talk to your assistant on Parley',
        description: 'A pretend chat app: write to your assistant’s Parley bot from anywhere.',
        version: '1.0.0',
        icon: { glyph: 'message-circle', color: 'teal' },
        kind: 'personal',
        tools: 'channel.mjs',
        reaches: ['chat.parley.example'],
        channel: {
          name: 'Parley',
          receives: 'poll',
          fields: [
            {
              key: 'token',
              label: 'Parley bot token',
              help: 'Parley → Settings → Bots → New bot shows it once.',
              link: 'https://chat.parley.example/settings/bots',
            },
          ],
          steps: [
            'In Parley, open Settings → Bots and press New bot.',
            'Name it after your assistant, then copy its token.',
          ],
        },
        instructions: '',
        examples: [],
      },
      null,
      2,
    )}\n`,
    'channel.mjs': `// Parley, as a chat app for Conch. Conch keeps the token and calls these.
const API = 'https://chat.parley.example/api';
const ask = async (app, path, init = {}) => {
  const res = await app.fetch(API + path, {
    ...init,
    headers: { authorization: 'Bearer ' + app.keys.token, 'content-type': 'application/json' },
  });
  if (!res.ok) throw new Error('Parley said ' + res.status + (res.status === 401 ? ': it refused the token.' : '.'));
  return res.json();
};

export const channel = {
  async identify(app) {
    const me = await ask(app, '/me');
    return { id: me.id, name: me.name, username: me.handle };
  },
  async poll({ cursor }, app) {
    const { messages } = await ask(app, '/updates?after=' + encodeURIComponent(cursor ?? '0'));
    return {
      messages: messages.map((m) => ({
        chatId: m.chat,
        messageId: String(m.id),
        user: { id: m.from.id, name: m.from.name },
        text: m.text,
      })),
      cursor: messages.length ? String(messages.at(-1).id) : cursor ?? undefined,
    };
  },
  async send({ chatId, text }, app) {
    const sent = await ask(app, '/messages', {
      method: 'POST',
      body: JSON.stringify({ chat: chatId, text }),
    });
    return { messageId: sent.id };
  },
  async directChat({ userId }) {
    return 'dm-' + userId;
  },
};
`,
    'README.md': '# Parley\n\nTalk to your Conch assistant on Parley. A Conch app.\n',
  };
}
