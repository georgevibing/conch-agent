/**
 * Conch's launcher as an app starts it (ADR 0073): a real Node process
 * speaking MCP over stdio, carrying each message to a real gateway.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { recordGateway } from '../port';
import { Services } from '../services';
import { onThisComputer } from '../test/here';

vi.setConfig({ testTimeout: 60_000 });

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

async function running() {
  const home = await mkdtemp(join(tmpdir(), 'conch-mcp-launcher-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  await app.listen({ host: '127.0.0.1', port: 0 });
  closers.push(() => app.close());
  const { port } = app.server.address() as AddressInfo;
  await recordGateway(home, { pid: process.pid, host: '127.0.0.1', port, startedAt: Date.now() });
  await services.memory.add({ content: 'Ada’s dentist is on Friday', source: 'user' });
  const paired = await app.inject({
    method: 'POST',
    url: '/api/mcp/clients',
    payload: { app: 'other', name: 'An editor', scopes: ['memory.read'] },
  });
  expect(paired.statusCode, paired.body).toBe(200);
  const { client, setup } = paired.json() as {
    client: { id: string };
    setup: { command: string; args: string[] };
  };
  return { home, app, services, client, setup };
}

/** Start the launcher as an app would, and talk to it a line at a time. */
function launch(command: string, args: string[], home: string) {
  const child = spawn(command, args, {
    env: { ...process.env, CONCH_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  closers.push(async () => child.kill());
  const answers = new Map<number, (message: Record<string, unknown>) => void>();
  const early = new Map<number, Record<string, unknown>>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    const id = message.id as number;
    const waiting = answers.get(id);
    if (waiting) waiting(message);
    else early.set(id, message);
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const ask = (message: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = message.id as number;
      const got = early.get(id);
      if (got) return resolve(got);
      answers.set(id, resolve);
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  const tell = (message: Record<string, unknown>) =>
    child.stdin.write(`${JSON.stringify(message)}\n`);
  return { child, ask, tell, stderr: () => stderr };
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
};

describe('the launcher an app starts', () => {
  it('carries an app’s whole conversation to Conch and back', async () => {
    const { home, setup } = await running();
    expect(setup.args[0]).toBe(join(home, 'mcp', 'launcher.mjs'));
    const app = launch(setup.command, setup.args, home);
    const init = await app.ask(INIT);
    expect(init).toMatchObject({ result: { serverInfo: { name: 'conch' } } });
    app.tell({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = await app.ask({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect((list.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual([
      'search_memory',
    ]);
    const found = await app.ask({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search_memory', arguments: { query: 'dentist' } },
    });
    expect(JSON.stringify(found.result)).toContain('dentist is on Friday');
    // Its logs never carry the key or the session.
    expect(app.stderr()).not.toMatch(/cmcp\.|Bearer/);
  });

  it('works with the MCP SDK’s own client, as Claude Desktop and Cursor use it', async () => {
    const { home, setup } = await running();
    const client = new Client({ name: 'an-editor', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: setup.command,
      args: setup.args,
      env: { ...(process.env as Record<string, string>), CONCH_HOME: home },
      stderr: 'pipe',
    });
    closers.push(() => client.close());
    await client.connect(transport);
    expect(client.getServerVersion()?.name).toBe('conch');
    expect(client.getInstructions()).toMatch(/what the user allowed this app to use/);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['search_memory']);
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true });
    const result = await client.callTool({
      name: 'search_memory',
      arguments: { query: 'dentist' },
    });
    expect(JSON.stringify(result.content)).toContain('dentist is on Friday');
    const refused = await client.callTool({
      name: 'browser_open',
      arguments: { url: 'https://x.example' },
    });
    expect(refused.isError).toBe(true);
  });

  it('an app paired for HTTP talks to the door directly, with its key', async () => {
    const { app } = await running();
    const paired = await app.inject({
      method: 'POST',
      url: '/api/mcp/clients',
      payload: { app: 'other', name: 'A script', scopes: ['memory.read'], http: true },
    });
    const { setup } = paired.json() as { setup: { url: string; key: string } };
    const { port } = app.server.address() as AddressInfo;
    const client = new Client({ name: 'a-script', version: '1.0.0' });
    closers.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${setup.key}` } },
      }),
    );
    expect(setup.url).toMatch(/\/mcp$/);
    const result = await client.callTool({
      name: 'search_memory',
      arguments: { query: 'dentist' },
    });
    expect(JSON.stringify(result.content)).toContain('dentist is on Friday');
  });

  it('says plainly when Conch isn’t running', async () => {
    const { home, setup } = await running();
    await rm(join(home, 'gateway.json'));
    const app = launch(setup.command, setup.args, home);
    const init = await app.ask(INIT);
    expect(init).toMatchObject({
      error: { message: 'Conch isn’t running on this computer. Open Conch, then try again.' },
    });
  });

  it('says plainly when the app was removed in Conch', async () => {
    const { home, app: gateway, client, setup } = await running();
    await gateway.inject({ method: 'DELETE', url: `/api/mcp/clients/${client.id}` });
    const app = launch(setup.command, setup.args, home);
    const init = await app.ask(INIT);
    expect(String((init.error as { message: string }).message)).toMatch(
      /isn’t paired with Conch any more/,
    );
  });

  it('proves itself again when its session ends (Conch restarted)', async () => {
    const { home, services, client, setup } = await running();
    const app = launch(setup.command, setup.args, home);
    await app.ask(INIT);
    // A restart forgets every session; the launcher's next message proves itself afresh.
    services.mcpSessions.forget(client.id);
    const list = await app.ask({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(list.result).toBeDefined();
  });
});
