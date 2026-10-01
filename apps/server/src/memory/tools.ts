import { MemoryKind, type Memory } from '@conch/protocol';
import { z } from 'zod';

import type { HostTool } from '../engines/types';
import type { MemoryStore } from './store';

/** The memory tools every engine exposes to the agent, bound to one conversation. */
export function memoryTools(options: {
  store: MemoryStore;
  conversationId: string;
  onSaved: (memory: Memory) => void;
  onForgotten: (memory: Memory) => void;
  /** Hybrid search (ADR 0032); keyword search when absent. */
  search?: (query: string) => Promise<{ memory: Memory }[]>;
  /** The chat read something untrusted: why. What it remembers then waits for an OK. */
  untrusted?: () => string | undefined;
}): HostTool[] {
  const { store, conversationId } = options;
  const remember: HostTool<{ content: z.ZodString; kind: z.ZodOptional<typeof MemoryKind> }> = {
    name: 'remember',
    description:
      'Save one durable fact about the user to long-term memory so you know it in future conversations. One concise, self-contained, third-person statement per call.',
    input: { content: z.string().min(1).max(500), kind: MemoryKind.optional() },
    async run({ content, kind }) {
      // After reading something untrusted, a page could be the one asking: the person decides (ADR 0032).
      const untrusted = options.untrusted?.();
      const memory = await store.add({
        content,
        kind,
        source: 'agent',
        conversationId,
        ...(untrusted && {
          pending: true,
          untrusted: `Learned in a chat that ${untrusted.replace(/^This chat /, '').replace(/, which could be trying to steer me\.$/, '')}.`,
        }),
      });
      options.onSaved(memory);
      return memory.pending
        ? `Noted as ${memory.id}, waiting for the user's OK before it's remembered (this chat read something from outside).`
        : `Saved to memory as ${memory.id}.`;
    },
  };
  const forget: HostTool<{ id: z.ZodString }> = {
    name: 'forget',
    description: 'Delete a memory by its id (shown in brackets in your memory list).',
    input: { id: z.string() },
    async run({ id }) {
      const removed = await store.remove(id);
      if (!removed) return `No memory with id ${id}.`;
      options.onForgotten(removed);
      return 'Forgotten.';
    },
  };
  const recall: HostTool<{ query: z.ZodString }> = {
    name: 'recall',
    description: 'Search long-term memory for things you may know about the user.',
    input: { query: z.string().min(1).max(200) },
    async run({ query }) {
      const results = options.search
        ? (await options.search(query)).map((r) => r.memory)
        : (await store.search(query)).filter((m) => !m.pending);
      return results.length
        ? results.map((m) => `[${m.id}] (${m.kind}) ${m.content}`).join('\n')
        : 'Nothing relevant in memory.';
    },
  };
  return [remember, forget, recall] as HostTool[];
}
