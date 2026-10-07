import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

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

/** What the bridge needs of an MCP client: listing tools, calling one, hanging up. */
export type BridgeClient = Pick<Client, 'listTools' | 'callTool' | 'close'>;

/** Keep tool output to a size any model's context can take. */
const MAX_RESULT = 100_000;

/** How long to wait before the one retry of a connection that failed for a passing reason. */
const RETRY_MS = 750;
/** Only a connection that failed this quickly is tried again. */
const QUICK_MS = 10_000;

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
 * A failure that usually clears by itself (a server still starting, a dropped
 * connection, a busy service), worth one quiet retry. A missing program, a
 * refused sign-in or a bad address is not: retrying would only make the
 * person wait for the same answer.
 */
export function passing(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOENT' || code === 'EACCES') return false;
  if (code === ErrorCode.ConnectionClosed || code === ErrorCode.RequestTimeout) return true;
  if (typeof code === 'number' && code >= 400 && code < 600)
    return code === 408 || code === 429 || code >= 500;
  if (
    typeof code === 'string' &&
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN)$/.test(code)
  )
    return true;
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(401|403|404|unauthori[sz]ed|forbidden|not found)\b/i.test(message)) return false;
  return /connection closed|socket hang up|timed? ?out|ECONNRESET|ECONNREFUSED|\b50[234]\b|\b429\b|temporarily/i.test(
    message,
  );
}

/** The connection itself went away (the program exited, the stream closed), not the tool. */
function dropped(error: unknown): boolean {
  if (error instanceof McpError) return error.code === ErrorCode.ConnectionClosed;
  const message = error instanceof Error ? error.message : String(error);
  return /connection closed|not connected|socket hang up|ECONNRESET|EPIPE/i.test(message);
}

/** The app took longer than the request may. */
function timedOut(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * For engines that can't run MCP servers themselves (plain model APIs such
 * as OpenRouter or the Anthropic API): Conch connects to every integration
 * for the turn and offers their tools under the same names a native engine
 * would use, so permissions, policies and the UI work identically.
 *
 * It heals what passes by itself (working agreement 11, ADR 0101): a
 * connection that fails for a passing reason is tried once more before the
 * app counts as unreachable, and one that drops mid-turn is opened again for
 * the next call. A lookup (`readOnlyHint`) that the drop cut off is simply
 * asked again; anything else is handed back to the model in words it can act
 * on, because Conch can't tell whether the app did it before the drop.
 */
export async function openBridge(
  servers: Record<string, EngineMcpServer>,
  options: {
    disallowed: Set<string>;
    fetch: (server: EngineMcpServer) => typeof fetch | undefined;
    cwd?: string;
    /** How to connect; tests pass a pretend client. */
    connect?: (server: EngineMcpServer) => Promise<BridgeClient>;
    retryMs?: number;
  },
): Promise<Bridge> {
  const clients = new Set<BridgeClient>();
  const tools: BridgeTool[] = [];
  const failed: { name: string; error: string }[] = [];
  const retryMs = options.retryMs ?? RETRY_MS;
  const open = async (server: EngineMcpServer): Promise<BridgeClient> => {
    const client = options.connect
      ? await options.connect(server)
      : await connectClient(server, { fetch: options.fetch(server), cwd: options.cwd });
    clients.add(client);
    return client;
  };
  /** Connect, and once more after a moment when the first failure was a passing one. */
  const openPatiently = async (server: EngineMcpServer): Promise<BridgeClient> => {
    const began = Date.now();
    try {
      return await open(server);
    } catch (error) {
      // One that took its whole time to fail would only make the turn wait as long again.
      if (!passing(error) || Date.now() - began > QUICK_MS) throw error;
      await sleep(retryMs);
      return await open(server);
    }
  };

  await Promise.all(
    Object.entries(servers).map(async ([name, server]) => {
      try {
        let client = await openPatiently(server);
        /** One reconnect at a time, shared by every call that saw the same drop. */
        let reopening: Promise<BridgeClient> | undefined;
        const reopen = (gone: BridgeClient) => {
          if (client !== gone) return Promise.resolve(client);
          reopening ??= (async () => {
            clients.delete(gone);
            await gone.close().catch(() => undefined);
            client = await openPatiently(server);
            return client;
          })().finally(() => {
            reopening = undefined;
          });
          return reopening;
        };
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          for (const tool of page.tools) {
            const full = `mcp__${name}__${tool.name}`;
            if (options.disallowed.has(full)) continue;
            const lookup = tool.annotations?.readOnlyHint === true;
            const once = async (via: BridgeClient, given: Record<string, unknown>) => {
              const result = await via.callTool({ name: tool.name, arguments: given });
              return { text: textOf(result), isError: Boolean(result.isError) };
            };
            tools.push({
              name: full,
              description: tool.description ?? '',
              inputSchema: tool.inputSchema as Record<string, unknown>,
              call: async (given) => {
                const via = client;
                try {
                  return await once(via, given);
                } catch (error) {
                  if (timedOut(error))
                    return {
                      text: `${name} didn’t answer in time. It may still be doing it: check before you repeat a change; a lookup can simply be asked again, perhaps for less at once.`,
                      isError: true,
                    };
                  if (!dropped(error))
                    return { text: scrub((error as Error).message), isError: true };
                  let again: BridgeClient;
                  try {
                    again = await reopen(via);
                  } catch (reason) {
                    return {
                      text: `The connection to ${name} dropped, and it couldn’t be opened again (${scrub((reason as Error).message)}). Its tools won’t work for now: carry on without them, or tell the person.`,
                      isError: true,
                    };
                  }
                  // A lookup changes nothing, so asking again is safe.
                  if (lookup) {
                    try {
                      return await once(again, given);
                    } catch (second) {
                      return { text: scrub((second as Error).message), isError: true };
                    }
                  }
                  return {
                    text: `The connection to ${name} dropped before it answered, and Conch has opened it again. It may or may not have done this: check first if you can, and call it again only if doing it twice would be harmless.`,
                    isError: true,
                  };
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
      await Promise.all([...clients].map((c) => c.close().catch(() => undefined)));
    },
  };
}
