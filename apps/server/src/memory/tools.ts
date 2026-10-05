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
  /** The chat read something untrusted: why. Kept with what it remembers, as where it came from. */
  untrusted?: () => string | undefined;
  /**
   * What it remembers after reading waits for an OK: nobody is there to see it
   * and undo it (a routine, a chat app). In a chat you're in, it's remembered
   * at once and the chat says so, with Undo.
   */
  waits?: () => boolean;
  /** Memories that stopped being true, for questions about before (ADR 0087). */
  searchPast?: (query: string) => Promise<Memory[]>;
  /**
   * The person took this back once (ADR 0087 § 6): what the assistant tries to
   * remember again waits for their OK.
   */
  never?: (content: string) => Promise<boolean>;
}): HostTool[] {
  const { store, conversationId } = options;
  const remember: HostTool<{ content: z.ZodString; kind: z.ZodOptional<typeof MemoryKind> }> = {
    name: 'remember',
    description:
      'Save one durable fact about the user to long-term memory so you know it in future conversations. One concise, self-contained, third-person statement per call.',
    input: { content: z.string().min(1).max(500), kind: MemoryKind.optional() },
    async run({ content, kind }) {
      // After reading something untrusted, a page could be the one asking (ADR 0032): it's
      // remembered with where it came from, and waits for an OK only when nobody can undo it.
      const untrusted = options.untrusted?.();
      const waits = Boolean(untrusted) && (options.waits?.() ?? true);
      // Something the person took back once waits for them, wherever it comes from (ADR 0087).
      const refused = await options.never?.(content).catch(() => false);
      const memory = await store.add({
        content,
        kind,
        source: 'agent',
        conversationId,
        ...(untrusted && {
          ...(waits && { pending: true }),
          untrusted: `Learned in a chat that ${untrusted.replace(/^This chat /, '').replace(/, which could be trying to steer me\.$/, '')}.`,
        }),
        ...(refused && {
          pending: true,
          untrusted: 'You took this back once, so it waits for your OK.',
        }),
      });
      options.onSaved(memory);
      if (refused && memory.pending)
        return `Noted as ${memory.id}, waiting for the user's OK: they took this back once before.`;
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
      // What used to be true, dated, for questions about before (ADR 0087).
      const past = (await options.searchPast?.(query).catch(() => [])) ?? [];
      const lines = [
        ...results.map((m) => `[${m.id}] (${m.kind}) ${m.content}`),
        ...(past.length
          ? [
              'No longer true (kept for questions about before):',
              ...past.map((m) => `- ${m.content} (until ${until(m.invalidAt ?? m.updatedAt)})`),
            ]
          : []),
      ];
      return lines.length ? lines.join('\n') : 'Nothing relevant in memory.';
    },
  };
  return [remember, forget, recall] as HostTool[];
}

/** "August 2026": when a memory stopped being true. */
function until(at: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(at);
}
