import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { EngineMcpServer } from '../engines/types';
import { connectClient, scrub } from './probe';

export interface BridgeTool {
  /** `mcp__<server>__<tool>`, exactly what a native engine would call it. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
}

export interface Bridge {
  tools: BridgeTool[];
  failed: { name: string; error: string }[];
  close(): Promise<void>;
}

/** Keep tool output to a size any model's context can take. */
const MAX_RESULT = 100_000;

function textOf(result: unknown): string {
  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return JSON.stringify(result).slice(0, MAX_RESULT);
  return content
    .map((part) => {
      const p = part as {
        type?: string;
        text?: string;
        resource?: { text?: string; uri?: string };
      };
      if (p.type === 'text') return p.text ?? '';
      if (p.type === 'resource') return p.resource?.text ?? `[resource ${p.resource?.uri ?? ''}]`;
      if (p.type === 'image' || p.type === 'audio') return `[${p.type} omitted]`;
      return JSON.stringify(p);
    })
    .join('\n')
    .slice(0, MAX_RESULT);
}

/**
 * For engines that can't run MCP servers themselves (plain model APIs such
 * as OpenRouter or the Anthropic API): Conch connects to every integration
 * for the turn and offers their tools under the same names a native engine
 * would use, so permissions, policies and the UI work identically.
 */
export async function openBridge(
  servers: Record<string, EngineMcpServer>,
  options: {
    disallowed: Set<string>;
    fetch: (server: EngineMcpServer) => typeof fetch | undefined;
    cwd?: string;
  },
): Promise<Bridge> {
  const clients: Client[] = [];
  const tools: BridgeTool[] = [];
  const failed: { name: string; error: string }[] = [];

  await Promise.all(
    Object.entries(servers).map(async ([name, server]) => {
      try {
        const client = await connectClient(server, {
          fetch: options.fetch(server),
          cwd: options.cwd,
        });
        clients.push(client);
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          for (const tool of page.tools) {
            const full = `mcp__${name}__${tool.name}`;
            if (options.disallowed.has(full)) continue;
            tools.push({
              name: full,
              description: tool.description ?? '',
              inputSchema: tool.inputSchema as Record<string, unknown>,
              call: async (args) => {
                try {
                  const result = await client.callTool({ name: tool.name, arguments: args });
                  return { text: textOf(result), isError: Boolean(result.isError) };
                } catch (error) {
                  return { text: scrub((error as Error).message), isError: true };
                }
              },
            });
          }
          cursor = page.nextCursor;
        } while (cursor);
      } catch (error) {
        failed.push({ name, error: scrub((error as Error).message) });
      }
    }),
  );

  return {
    tools,
    failed,
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
    },
  };
}
