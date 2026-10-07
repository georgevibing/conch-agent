/**
 * The bridge heals what passes by itself (working agreement 11, ADR 0101): a
 * connection that fails for a passing reason is tried once more, one that
 * drops mid-turn is opened again, a lookup it cut off is simply asked again,
 * and anything else goes back to the model in words it can act on.
 */
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import type { EngineMcpServer } from '../engines/types';
import { type BridgeClient, openBridge, passing } from './bridge';

const SERVER: EngineMcpServer = { type: 'stdio', command: 'ledger', args: [] };

/** A pretend app: its tools, and what each call does. */
function pretend(call: (name: string, n: number) => unknown) {
  let calls = 0;
  let closed = 0;
  const client: BridgeClient = {
    listTools: (async () => ({
      tools: [
        { name: 'find', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
        { name: 'pay', inputSchema: { type: 'object' } },
      ],
    })) as unknown as BridgeClient['listTools'],
    callTool: (async ({ name }: { name: string }) => {
      const result = call(name, ++calls);
      if (result instanceof Error) throw result;
      return result;
    }) as unknown as BridgeClient['callTool'],
    close: async () => {
      closed++;
    },
  };
  return { client, closed: () => closed };
}

const ok = (text: string) => ({ content: [{ type: 'text', text }] });
const drop = () => new McpError(ErrorCode.ConnectionClosed, 'Connection closed');

async function bridge(connect: () => Promise<BridgeClient>) {
  return openBridge(
    { ledger: SERVER },
    { disallowed: new Set(), fetch: () => undefined, connect, retryMs: 1 },
  );
}

describe('the bridge heals', () => {
  it('tries a connection that failed for a passing reason once more', async () => {
    let tries = 0;
    const app = pretend(() => ok('found'));
    const b = await bridge(async () => {
      if (++tries === 1) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      return app.client;
    });
    expect(b.failed).toEqual([]);
    expect(tries).toBe(2);
    expect(b.tools.map((t) => t.name)).toEqual(['mcp__ledger__find', 'mcp__ledger__pay']);
  });

  it('doesn’t make you wait twice for what won’t pass (a missing program, a refused sign-in)', async () => {
    let tries = 0;
    const b = await bridge(async () => {
      tries++;
      throw Object.assign(new Error('spawn ledger ENOENT'), { code: 'ENOENT' });
    });
    expect(tries).toBe(1);
    expect(b.failed).toEqual([expect.objectContaining({ name: 'ledger' })]);
    expect(passing(Object.assign(new Error('Unauthorized'), { code: 401 }))).toBe(false);
    expect(passing(Object.assign(new Error('Service Unavailable'), { code: 503 }))).toBe(true);
  });

  it('opens a dropped connection again, and asks a lookup again by itself', async () => {
    const first = pretend(() => drop());
    const second = pretend(() => ok('3 invoices'));
    let tries = 0;
    const b = await bridge(async () => (++tries === 1 ? first.client : second.client));
    const find = b.tools.find((t) => t.name === 'mcp__ledger__find');
    expect(await find?.call({})).toEqual({ text: '3 invoices', isError: false });
    expect(first.closed()).toBe(1);
    await b.close();
    expect(second.closed()).toBe(1);
  });

  it('never repeats a change by itself after a drop: it says so, and the next call works', async () => {
    let paid = 0;
    const first = pretend(() => drop());
    const second = pretend(() => ok(`paid ${++paid}`));
    let tries = 0;
    const b = await bridge(async () => (++tries === 1 ? first.client : second.client));
    const pay = b.tools.find((t) => t.name === 'mcp__ledger__pay');
    const after = await pay?.call({ amount: 5 });
    expect(after?.isError).toBe(true);
    expect(after?.text).toMatch(/dropped before it answered.*opened it again.*may or may not/);
    expect(paid).toBe(0);
    expect(await pay?.call({ amount: 5 })).toEqual({ text: 'paid 1', isError: false });
  });

  it('says a slow app may still be working on it', async () => {
    const app = pretend(() => new McpError(ErrorCode.RequestTimeout, 'Request timed out'));
    const b = await bridge(async () => app.client);
    const result = await b.tools[1]?.call({});
    expect(result).toMatchObject({ isError: true });
    expect(result?.text).toMatch(/didn’t answer in time.*check before you repeat a change/);
  });

  it('passes the app’s own error on as it was', async () => {
    const app = pretend(() => new Error('Customer “ACME” not found'));
    const b = await bridge(async () => app.client);
    expect(await b.tools[0]?.call({})).toEqual({
      text: 'Customer “ACME” not found',
      isError: true,
    });
  });

  it('says when a dropped app can’t be opened again', async () => {
    const first = pretend(() => drop());
    let tries = 0;
    const b = await bridge(async () => {
      if (++tries === 1) return first.client;
      throw Object.assign(new Error('spawn ledger ENOENT'), { code: 'ENOENT' });
    });
    const result = await b.tools[0]?.call({});
    expect(result?.isError).toBe(true);
    expect(result?.text).toMatch(/couldn’t be opened again.*carry on without them/);
  });
});
