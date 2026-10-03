import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, describe, expect, it } from 'vitest';

import type { ToolContext } from '../../conversations/manager';
import { gateway, type Gateway } from '../../test/session';
import type { HostTool } from '../types';

/**
 * Claude Code gets Conch's tools as one in-process MCP server (`conch`). When
 * a single tool's input can't be written as JSON Schema, listing the server
 * fails and Claude Code is left with none of them: no memory, no skills, no
 * browser, no `offer`. (`z.record` did that, from `app_try`.) So every tool a
 * chat gets must list.
 */
describe('Conch’s tools, as Claude Code lists them', () => {
  let g: Gateway | undefined;
  afterAll(() => g?.app.close());

  it('lists every one, with nothing lost', async () => {
    g = await gateway();
    const deps = (
      g.services.conversations as unknown as { deps: { tools?: (ctx: ToolContext) => HostTool[] } }
    ).deps;
    const ctx: ToolContext = {
      conversationId: 'c_tools',
      append: () => undefined,
      engine: g.services.providers.engineFor('mock'),
      permissionMode: 'default',
      ask: async () => 'deny',
      signal: new AbortController().signal,
    };
    const tools = deps.tools?.(ctx) ?? [];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['offer', 'ask', 'app_try']));

    const server = createSdkMcpServer({
      name: 'conch',
      version: '1.0.0',
      tools: tools.map((t) =>
        tool(t.name, t.description, t.input, async () => ({ content: [] }), {
          alwaysLoad: t.alwaysLoad,
          searchHint: t.searchHint,
        }),
      ),
    });
    const [ours, theirs] = InMemoryTransport.createLinkedPair();
    await (server.instance as unknown as { connect(t: unknown): Promise<void> }).connect(ours);
    const client = new Client({ name: 'claude-code', version: '1' });
    await client.connect(theirs);
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
    await client.close();
  });
});
