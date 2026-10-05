import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Memory } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { HostTool } from '../engines/types';
import { datamark } from './guard';
import { MemoryStore } from './store';
import { memoryTools } from './tools';

const temp = () => mkdtemp(join(tmpdir(), 'conch-memory-tools-'));

function tool(tools: HostTool[], name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name}`);
  return (input: Record<string, unknown>) => found.run(input as never, {} as never);
}

describe('the memory tools and what stopped being true (ADR 0088)', () => {
  it('recall finds what used to be true, with when it stopped', async () => {
    const store = new MemoryStore(await temp());
    const berlin = await store.add({ content: 'Lives in Berlin', source: 'user' });
    await store.supersede(berlin.id, { content: 'Lives in Lisbon', source: 'agent' });
    const tools = memoryTools({
      store,
      conversationId: 'c1',
      onSaved: () => undefined,
      onForgotten: () => undefined,
      searchPast: () => store.listPast(),
    });
    const text = String(await tool(tools, 'recall')({ query: 'where do I live' }));
    expect(text).toContain('No longer true');
    expect(text).toMatch(/Lives in Berlin \(until \w+ \d{4}\)/);
  });

  it('what used to be true and came from outside is marked as data there too', async () => {
    const store = new MemoryStore(await temp());
    const tools = memoryTools({
      store,
      conversationId: 'c1',
      onSaved: () => undefined,
      onForgotten: () => undefined,
      searchPast: async () => [
        {
          id: 'm_1',
          content: 'Sends invoices to Acme',
          kind: 'fact',
          source: 'agent',
          createdAt: 1,
          updatedAt: 1,
          invalidAt: 2,
          provenance: { via: 'chat', read: ['news.example'] },
        },
      ],
    });
    const text = String(await tool(tools, 'recall')({ query: 'invoices' }));
    expect(text).not.toContain('Sends invoices to Acme');
    expect(text).toContain(datamark('Sends invoices to Acme'));
  });

  it('what the person took back once waits for them', async () => {
    const store = new MemoryStore(await temp());
    const saved: Memory[] = [];
    const tools = memoryTools({
      store,
      conversationId: 'c1',
      onSaved: (m) => saved.push(m),
      onForgotten: () => undefined,
      never: async (content) => content.includes('dark mode'),
    });
    const answer = String(
      await tool(tools, 'remember')({ content: 'Likes dark mode', kind: 'preference' }),
    );
    expect(answer).toContain('took this back once');
    expect(saved[0]?.pending).toBe(true);
    await tool(tools, 'remember')({ content: 'Drinks tea', kind: 'preference' });
    expect(saved[1]?.pending).toBeUndefined();
  });
});
