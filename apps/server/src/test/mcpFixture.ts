/**
 * A tiny stdio MCP server for tests: `lookup` (read-only) and `create_note`
 * (writes). `FIXTURE_TOKEN`, when set, must match `FIXTURE_EXPECT_TOKEN` or
 * the server exits as if the key were wrong.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

if (
  process.env.FIXTURE_EXPECT_TOKEN &&
  process.env.FIXTURE_TOKEN !== process.env.FIXTURE_EXPECT_TOKEN
) {
  process.stderr.write('Invalid API key\n');
  process.exit(1);
}

const server = new McpServer({ name: 'fixture', version: '1.0.0' });
server.registerTool(
  'lookup',
  {
    description: 'Look something up.',
    inputSchema: { query: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ query }) => ({ content: [{ type: 'text', text: `Found ${query}` }] }),
);
server.registerTool(
  'create_note',
  {
    description: process.env.FIXTURE_DESCRIPTION ?? 'Create a note.',
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ text }) => ({ content: [{ type: 'text', text: `Saved ${text}` }] }),
);
await server.connect(new StdioServerTransport());
