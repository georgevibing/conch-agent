import { createHash } from 'node:crypto';

import type { IntegrationHealth } from '@conch/protocol';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { EngineMcpServer } from '../engines/types';
import { SERVER_VERSION } from '../version';
import { EndpointError } from './net';
import type { StoredTool } from './store';

/** A fully resolved MCP server, secrets included. Never leaves the gateway. */
export type RuntimeServer = EngineMcpServer;

export type ProbeResult =
  | { ok: true; tools: StoredTool[]; serverName?: string }
  | { ok: false; health: IntegrationHealth; unauthorized?: boolean };

const HTTP_TIMEOUT_MS = 20_000;
/** `npx` may download the server the first time. */
const STDIO_TIMEOUT_MS = 120_000;
const MAX_TOOLS = 500;

export function toolHash(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        tool.name,
        tool.description ?? '',
        tool.inputSchema ?? null,
        tool.annotations ?? null,
      ]),
    )
    .digest('base64url')
    .slice(0, 22);
}

/** Error text without anything that looks like a credential. */
export function scrub(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 6) out = out.replaceAll(secret, '••••');
  return out
    .replace(/(bearer\s+)[\w.~+/-]+=*/gi, '$1••••')
    .replace(/\b(gh[pousr]_|github_pat_|sk-|xox[abpr]-)[\w-]+/g, '$1••••')
    .slice(0, 600);
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof StreamableHTTPError) return error.code;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

/** Turn whatever went wrong into one sentence a person can act on. */
export function explain(
  error: unknown,
  server: RuntimeServer,
  secrets: string[] = [],
): ProbeResult {
  const detail = scrub(error instanceof Error ? error.message : String(error), secrets);
  const fail = (
    health: Omit<IntegrationHealth, 'checkedAt'>,
    unauthorized = false,
  ): ProbeResult => ({
    ok: false,
    unauthorized,
    health: { ...health, detail, checkedAt: Date.now() },
  });
  if (error instanceof EndpointError)
    return fail({ state: 'error', message: error.message, action: 'edit' });
  const status = httpStatus(error);
  if (
    error instanceof UnauthorizedError ||
    status === 401 ||
    /\b401\b|unauthori[sz]ed/i.test(detail)
  )
    return fail(
      { state: 'needs-auth', message: 'Sign in again to keep using it.', action: 'reconnect' },
      true,
    );
  if (status === 403 || /\b403\b|forbidden/i.test(detail))
    return fail(
      {
        state: 'needs-auth',
        message:
          'Your account doesn’t allow this. Check the token or sign in with another account.',
        action: 'reconnect',
      },
      true,
    );
  const code =
    (error as NodeJS.ErrnoException).code ?? (error as { cause?: { code?: string } }).cause?.code;
  if (server.type === 'stdio') {
    if (code === 'ENOENT')
      return fail({
        state: 'error',
        message:
          server.command === 'npx' || server.command === 'node'
            ? 'Node.js isn’t installed on this computer. Install it from nodejs.org, then try again.'
            : `Couldn’t find “${server.command}” on this computer.`,
        action: 'retry',
      });
    if (
      /chrom(e|ium).*(not found|isn’t installed|is not installed)|executable doesn't exist/i.test(
        detail,
      )
    )
      return fail({
        state: 'error',
        message: 'This needs Google Chrome. Install it, then try again.',
        action: 'retry',
      });
    if (/timed? ?out/i.test(detail))
      return fail({
        state: 'error',
        message: 'It took too long to start. Try again in a moment.',
        action: 'retry',
      });
    return fail({ state: 'error', message: 'It stopped while starting up.', action: 'retry' });
  }
  const host = (() => {
    try {
      return new URL(server.url).host;
    } catch {
      return 'the server';
    }
  })();
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return fail({
      state: 'error',
      message: `Couldn’t find ${host}. Check your internet connection.`,
      action: 'retry',
    });
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ECONNRESET')
    return fail({
      state: 'error',
      message: `${host} isn’t answering. Is it running?`,
      action: 'retry',
    });
  if (/timed? ?out|aborted/i.test(detail) || code === 'UND_ERR_CONNECT_TIMEOUT')
    return fail({ state: 'error', message: `${host} took too long to answer.`, action: 'retry' });
  if (status === 404)
    return fail({
      state: 'error',
      message: `There’s no integration at that address on ${host}.`,
      action: 'edit',
    });
  if (status !== undefined && status >= 500)
    return fail({
      state: 'error',
      message: `${host} is having problems right now. Try again later.`,
      action: 'retry',
    });
  return fail({ state: 'error', message: `Couldn’t connect to ${host}.`, action: 'retry' });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function listTools(client: Client): Promise<StoredTool[]> {
  const tools: StoredTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    for (const tool of page.tools) {
      const hints = tool.annotations ?? {};
      tools.push({
        name: tool.name,
        title: tool.title ?? hints.title,
        description: (tool.description ?? '').slice(0, 4000),
        access: hints.readOnlyHint === true ? 'read' : 'write',
        destructive: hints.readOnlyHint !== true && hints.destructiveHint === true,
        hash: toolHash(tool),
      });
    }
    cursor = page.nextCursor;
  } while (cursor && tools.length < MAX_TOOLS);
  return tools;
}

/**
 * Open an MCP session the way Claude Code would: stdio for programs,
 * Streamable HTTP for addresses (falling back to SSE for older servers).
 * The caller closes the client.
 */
export async function connectClient(
  server: RuntimeServer,
  options: { fetch?: typeof fetch; cwd?: string } = {},
): Promise<Client> {
  const open = async (transport: Transport) => {
    const client = new Client({ name: 'conch', version: SERVER_VERSION });
    try {
      await client.connect(transport);
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  };

  if (server.type === 'stdio') {
    let stderr = '';
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...getDefaultEnvironment(), ...server.env },
      stderr: 'pipe',
      cwd: options.cwd,
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    try {
      return await withTimeout(open(transport), STDIO_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(stderr ? `${message}\n${stderr}` : message), {
        code: (error as NodeJS.ErrnoException).code,
      });
    }
  }
  const url = new URL(server.url);
  const requestInit = { headers: server.headers ?? {} };
  try {
    return await withTimeout(
      open(new StreamableHTTPClientTransport(url, { requestInit, fetch: options.fetch })),
      HTTP_TIMEOUT_MS,
    );
  } catch (error) {
    // Older servers only speak the SSE transport.
    const status = httpStatus(error);
    if (status !== 404 && status !== 405) throw error;
    return await withTimeout(
      open(new SSEClientTransport(url, { requestInit, fetch: options.fetch })),
      HTTP_TIMEOUT_MS,
    );
  }
}

/**
 * Connect to an integration the way the engine will, list its tools, and
 * hang up. Nothing is called; this only reads the tool list.
 */
export async function probe(
  server: RuntimeServer,
  options: { fetch?: typeof fetch; cwd?: string; secrets?: string[] } = {},
): Promise<ProbeResult> {
  let client: Client | undefined;
  try {
    client = await connectClient(server, options);
    const tools = await listTools(client);
    return { ok: true, tools, serverName: client.getServerVersion()?.name };
  } catch (error) {
    return explain(error, server, options.secrets);
  } finally {
    await client?.close().catch(() => undefined);
  }
}
