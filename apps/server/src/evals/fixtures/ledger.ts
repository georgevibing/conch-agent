/**
 * "Ledger", a pretend app for the eval suite (ADR 0071): a stdio MCP server
 * added to Conch the way a person adds their own. `find_invoices` is a tidy
 * tool; `record_payment` has the kind of schema real servers ship — a `$ref`,
 * a type list, a `null` in an enum, an array without `items`, an object
 * without properties, and a required field that doesn't exist — so the suite
 * shows whether every provider can still call it. Each call is appended to
 * `LEDGER_LOG` as a line of JSON, which the checkers read.
 *
 * Run by Node directly (type stripping), so only erasable TypeScript here.
 */
import { appendFileSync } from 'node:fs';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const INVOICES = [
  { id: 'INV-101', customer: 'Globex', amount: 400.0, currency: 'EUR', status: 'unpaid' },
  { id: 'INV-102', customer: 'Globex', amount: 834.5, currency: 'EUR', status: 'unpaid' },
  { id: 'INV-103', customer: 'Globex', amount: 1200.0, currency: 'EUR', status: 'paid' },
  { id: 'INV-201', customer: 'Initech', amount: 99.0, currency: 'EUR', status: 'unpaid' },
];

/** The malformed schema, exactly as a careless server would send it. */
const MALFORMED_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  definitions: { Money: { type: ['number', 'string'], description: 'An amount of money' } },
  properties: {
    customer: { type: 'string', format: 'customer-name', nullable: true },
    amount: { $ref: '#/definitions/Money' },
    currency: { enum: ['EUR', 'USD', null], default: 'EUR' },
    memo: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    tags: { type: 'array' },
    meta: { type: 'object' },
  },
  required: ['customer', 'amount', 'ledger_id'],
  additionalProperties: true,
};

const log = (entry: unknown) => {
  const path = process.env.LEDGER_LOG;
  if (path) appendFileSync(path, `${JSON.stringify(entry)}\n`);
};

const server = new Server({ name: 'ledger', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: 'find_invoices',
      description:
        'Find a customer’s invoices in the ledger, with their amounts and whether they are paid.',
      inputSchema: {
        type: 'object',
        properties: {
          customer: { type: 'string', description: 'The customer’s name, e.g. "Globex".' },
          status: { type: 'string', enum: ['paid', 'unpaid', 'any'] },
        },
        required: ['customer'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'record_payment',
      description: 'Record a payment received from a customer in the ledger.',
      inputSchema: MALFORMED_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  log({ tool: request.params.name, args, at: Date.now() });
  if (request.params.name === 'find_invoices') {
    const who = String(args.customer ?? '').toLowerCase();
    const status = String(args.status ?? 'any');
    const found = INVOICES.filter(
      (i) => i.customer.toLowerCase() === who && (status === 'any' || i.status === status),
    );
    return { content: [{ type: 'text', text: JSON.stringify({ invoices: found }) }] };
  }
  if (request.params.name === 'record_payment') {
    const amount = Number(args.amount);
    if (!args.customer || !Number.isFinite(amount))
      return {
        isError: true,
        content: [{ type: 'text', text: 'Give the customer and the amount as a number.' }],
      };
    return {
      content: [
        {
          type: 'text',
          text: `Recorded a payment of ${amount} ${String(args.currency ?? 'EUR')} from ${String(args.customer)} (receipt PAY-7781).`,
        },
      ],
    };
  }
  return { isError: true, content: [{ type: 'text', text: 'No such tool.' }] };
});

await server.connect(new StdioServerTransport());
