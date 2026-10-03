/**
 * Conch's tools, handed to an agent program for one turn (ADR 0053).
 *
 * An agent that speaks ACP (Copilot, Gemini CLI, Grok Build) runs MCP servers
 * it's given when a session starts. So for each turn Conch opens a door: an MCP
 * server over HTTP on this computer's loopback address, on a port chosen by the
 * system, behind a key made for that turn. Behind it are exactly the tools the
 * turn has — Conch's sealed file and command tools, memory, the browser, the
 * apps you connected — each still going through Conch's permission rules and
 * the guard, the same as with every other provider. The door closes when the
 * turn ends.
 *
 * Who can knock: only something on this computer that knows the key. A web
 * page can't — browsers always send `Origin` on a cross-site request and the
 * door refuses any request that has one; a rebinding name can't — the `Host`
 * must be the loopback address itself; and a guess can't — the key is 256
 * random bits, compared in constant time.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { ToolStatus, ToolView } from '@conch/protocol';

import type { Callable } from '../api/engine';

/** A request body bigger than this is not a tool call. */
const MAX_BODY = 4 * 1024 * 1024;
/** The name the agent knows the door by: its tools read `conch/<tool>` or `mcp__conch__<tool>`. */
export const DOOR_NAME = 'conch';

export interface DoorEvents {
  start(call: { id: string; name: string; input: unknown }): void | Promise<void>;
  /** `view`: what a host tool found, for the person only (ADR 0055); the agent gets `output`. */
  end(call: {
    id: string;
    status: ToolStatus;
    output: string;
    view?: ToolView;
  }): void | Promise<void>;
}

export interface Door {
  /** `http://127.0.0.1:<port>/mcp` */
  url: string;
  /** The headers the agent must send, as ACP's `mcpServers` takes them. */
  headers: { name: string; value: string }[];
  close(): Promise<void>;
}

function sameKey(given: string | undefined, key: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += piece.length;
    if (size > MAX_BODY) throw new Error('too large');
    chunks.push(piece);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as unknown) : undefined;
}

/** Open the door for one turn's tools. */
export async function openDoor(
  tools: ReadonlyMap<string, Callable>,
  events: DoorEvents,
  signal: AbortSignal,
): Promise<Door> {
  const key = randomBytes(32).toString('base64url');
  let calls = 0;

  const mcp = () => {
    const server = new Server(
      { name: DOOR_NAME, version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...tools.values()].map((tool) => ({
        name: tool.spec.name,
        description: tool.spec.description,
        inputSchema: { type: 'object' as const, ...tool.spec.schema },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.get(request.params.name);
      const id = `door_${++calls}_${randomBytes(4).toString('hex')}`;
      const args =
        request.params.arguments && typeof request.params.arguments === 'object'
          ? (request.params.arguments as Record<string, unknown>)
          : {};
      if (!tool)
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'That tool isn’t part of this conversation.' }],
        };
      await events.start({ id, name: tool.display, input: args });
      let text = 'The tool could not complete. Check the action and try again.';
      let isError = true;
      let view: ToolView | undefined;
      try {
        signal.throwIfAborted();
        ({ text, isError, view } = await tool.run(args, id));
      } catch {
        if (signal.aborted) text = 'Stopped.';
      }
      await events.end({
        id,
        status: isError ? 'error' : 'success',
        output: text,
        ...(view && !isError && { view }),
      });
      return { isError, content: [{ type: 'text' as const, text }] };
    });
    return server;
  };

  const http: HttpServer = createServer((req, res) => {
    const deny = (status: number, message: string) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    const address = http.address() as AddressInfo | null;
    const host = address ? `127.0.0.1:${address.port}` : '';
    // Browsers name where a request came from; the agent's own process doesn't.
    if (req.headers.origin !== undefined) return deny(403, 'forbidden');
    if (req.headers.host !== host) return deny(403, 'forbidden');
    if (!sameKey(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1], key))
      return deny(401, 'unauthorized');
    if (new URL(req.url ?? '/', `http://${host}`).pathname !== '/mcp')
      return deny(404, 'not found');
    void (async () => {
      const server = mcp();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      try {
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch {
        if (!res.headersSent) deny(400, 'bad request');
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = http.address() as AddressInfo;
  const close = () =>
    new Promise<void>((resolve) => {
      http.closeAllConnections?.();
      http.close(() => resolve());
    });
  signal.addEventListener('abort', () => void close(), { once: true });
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    headers: [{ name: 'Authorization', value: `Bearer ${key}` }],
    close,
  };
}
