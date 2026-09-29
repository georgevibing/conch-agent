import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

/**
 * A pretend SaaS vendor for tests, E2E and `pnpm dev:mock`: an OAuth 2.1
 * authorization server (RFC 8414 metadata, RFC 7591 registration, PKCE S256,
 * refresh-token rotation) in front of MCP servers, plus a token-checked
 * endpoint for token integrations. Conch talks to it with exactly the code
 * it uses for Notion or Linear.
 *
 * Every vendor path is `/<vendor>/mcp`. Controls, for tests:
 * - `POST /__control/revoke` — every access token stops working (as if expired);
 * - `POST /__control/down` / `up` — the MCP endpoints return 503;
 * - `?deny=1` on /authorize — the user presses "Deny".
 */
export class MockVendor {
  #server?: Server;
  #clients = new Map<string, string[]>();
  #codes = new Map<
    string,
    { clientId: string; challenge: string; redirect: string; vendor: string }
  >();
  #access = new Map<string, string>();
  #refresh = new Map<string, string>();
  #down = false;
  /** Tokens a token-integration vendor accepts, by vendor. */
  readonly validTokens = new Map<string, string>();
  /** Seconds an access token lasts. */
  tokenLifetime = 3600;
  /** Approve sign-ins without showing the consent page (tests). */
  autoApprove = false;

  base = '';

  async start(port = 0): Promise<string> {
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => {
        res.writeHead(500).end(String(error));
      });
    });
    await new Promise<void>((resolve) => this.#server?.listen(port, '127.0.0.1', resolve));
    const address = this.#server.address() as AddressInfo;
    this.base = `http://127.0.0.1:${address.port}`;
    return this.base;
  }

  async stop() {
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  url(vendor: string) {
    return `${this.base}/${vendor}/mcp`;
  }

  revokeAll() {
    this.#access.clear();
  }

  async #handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.base);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      res
        .writeHead(status, { 'content-type': 'application/json', ...headers })
        .end(JSON.stringify(body));
    const body = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    };

    if (url.pathname === '/__control/revoke') {
      this.revokeAll();
      return json(200, { ok: true });
    }
    if (url.pathname === '/__control/down' || url.pathname === '/__control/up') {
      this.#down = url.pathname.endsWith('down');
      return json(200, { ok: true });
    }

    const prm = /^\/\.well-known\/oauth-protected-resource\/([a-z-]+)\/mcp$/.exec(url.pathname);
    if (prm) {
      return json(200, {
        resource: this.url(prm[1] ?? ''),
        authorization_servers: [this.base],
        scopes_supported: ['read', 'write'],
      });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, {
        issuer: this.base,
        authorization_endpoint: `${this.base}/authorize`,
        token_endpoint: `${this.base}/token`,
        registration_endpoint: `${this.base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (url.pathname === '/register' && req.method === 'POST') {
      const meta = JSON.parse(await body()) as { redirect_uris?: string[] };
      const clientId = `client_${randomBytes(8).toString('hex')}`;
      this.#clients.set(clientId, meta.redirect_uris ?? []);
      return json(201, {
        ...meta,
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      });
    }
    if (url.pathname === '/authorize') return this.#authorize(url, req, res, await body());
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await body());
      return this.#token(form, json);
    }

    const mcp = /^\/([a-z-]+)\/mcp$/.exec(url.pathname);
    if (mcp?.[1]) {
      if (this.#down) return json(503, { error: 'unavailable' });
      const vendor = mcp[1];
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const expected = this.validTokens.get(vendor);
      const ok = expected
        ? bearer === expected
        : bearer !== undefined && this.#access.get(bearer) === vendor;
      if (!ok) {
        return json(
          401,
          { error: 'invalid_token' },
          {
            'www-authenticate': `Bearer resource_metadata="${this.base}/.well-known/oauth-protected-resource/${vendor}/mcp"`,
          },
        );
      }
      const server = vendorServer(vendor);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      const raw = req.method === 'POST' ? await body() : '';
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
      return;
    }
    json(404, { error: 'not_found' });
  }

  async #authorize(url: URL, req: IncomingMessage, res: ServerResponse, form: string) {
    const params = req.method === 'POST' ? new URLSearchParams(form) : url.searchParams;
    const clientId = params.get('client_id') ?? '';
    const redirect = params.get('redirect_uri') ?? '';
    const state = params.get('state') ?? '';
    const vendor = /\/([a-z-]+)\/mcp$/.exec(params.get('resource') ?? '')?.[1] ?? 'app';
    if (!this.#clients.get(clientId)?.includes(redirect)) {
      res.writeHead(400).end('Unknown client or redirect URI');
      return;
    }
    const decision =
      req.method === 'POST'
        ? params.get('decision')
        : this.autoApprove
          ? 'allow'
          : url.searchParams.get('deny')
            ? 'deny'
            : undefined;
    if (!decision) {
      const hidden = [...params]
        .map(([k, v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`)
        .join('');
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(
          `<!doctype html><title>Sign in to ${escape(vendor)}</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh"><form method="post" action="/authorize">${hidden}<h1>Allow Conch to use your ${escape(vendor)} account?</h1><button name="decision" value="allow">Allow</button> <button name="decision" value="deny">Deny</button></form></body>`,
        );
      return;
    }
    const back = new URL(redirect);
    back.searchParams.set('state', state);
    if (decision !== 'allow') {
      back.searchParams.set('error', 'access_denied');
    } else {
      const code = randomBytes(16).toString('hex');
      this.#codes.set(code, {
        clientId,
        challenge: params.get('code_challenge') ?? '',
        redirect,
        vendor,
      });
      back.searchParams.set('code', code);
    }
    res.writeHead(302, { location: back.href }).end();
  }

  #token(form: URLSearchParams, json: (status: number, body: unknown) => void) {
    const issue = (vendor: string) => {
      const access = `at_${randomBytes(16).toString('hex')}`;
      const refresh = `rt_${randomBytes(16).toString('hex')}`;
      this.#access.set(access, vendor);
      this.#refresh.set(refresh, vendor);
      return json(200, {
        access_token: access,
        token_type: 'Bearer',
        expires_in: this.tokenLifetime,
        refresh_token: refresh,
      });
    };
    if (form.get('grant_type') === 'authorization_code') {
      const code = this.#codes.get(form.get('code') ?? '');
      this.#codes.delete(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!code || code.challenge !== challenge || code.redirect !== form.get('redirect_uri'))
        return json(400, { error: 'invalid_grant' });
      return issue(code.vendor);
    }
    if (form.get('grant_type') === 'refresh_token') {
      const token = form.get('refresh_token') ?? '';
      const vendor = this.#refresh.get(token);
      // Rotation: a refresh token works once.
      this.#refresh.delete(token);
      if (!vendor) return json(400, { error: 'invalid_grant' });
      return issue(vendor);
    }
    json(400, { error: 'unsupported_grant_type' });
  }
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function vendorServer(vendor: string): McpServer {
  const server = new McpServer({ name: `${vendor}-mock`, version: '1.0.0' });
  server.registerTool(
    'search',
    {
      title: 'Search',
      description: `Search your ${vendor} workspace.`,
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => ({
      content: [{ type: 'text', text: `3 results in ${vendor} for “${query}”.` }],
    }),
  );
  server.registerTool(
    'create_page',
    {
      title: 'Create a page',
      description: `Create a new page in ${vendor}.`,
      inputSchema: { title: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ title }) => ({ content: [{ type: 'text', text: `Created “${title}”.` }] }),
  );
  server.registerTool(
    'delete_page',
    {
      title: 'Delete a page',
      description: `Delete a page from ${vendor}.`,
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async () => ({ content: [{ type: 'text', text: 'Deleted.' }] }),
  );
  return server;
}
