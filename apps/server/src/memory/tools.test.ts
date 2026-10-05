import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Memory } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { HostTool } from '../engines/types';
import { MemoryStore } from './store';
import { memoryTools } from './tools';

const temp = () => mkdtemp(join(tmpdir(), 'conch-memory-tools-'));

function tool(tools: HostTool[], name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name}`);
  return (input: Record<string, unknown>) => found.run(input as never, {} as never);
}

describe('the memory tools and what stopped being true (ADR 0087)', () => {
  it('recall finds what used to be true, with when it stopped', async () => {
    const store = new MemoryStore(await temp());
    const berlin = await store.add({ content: 'Lives in Berlin', source: 'user' });
    const moved = await store.supersede(berlin.id, { content: 'Lives in Lisbon', source: 'agent' });
    const tools = memoryTools({
      store,
      conversationId: 'c1',
      onSaved: () => undefined,
      onForgotten: () => undefined,
      searchPast: async () => (moved ? [moved.past] : []),
    });
    const text = String(await tool(tools, 'recall')({ query: 'where do I live' }));
    expect(text).toContain('No longer true');
    expect(text).toMatch(/Lives in Berlin \(until \w+ \d{4}\)/);
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
