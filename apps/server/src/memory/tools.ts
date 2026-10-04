import { MemoryKind, type Memory } from '@conch/protocol';
import { z } from 'zod';

import type { HostTool } from '../engines/types';
import { checkMemory, holdOf, secondLook, type LookModel, type ReadThing } from './guard';
import type { MemoryStore } from './store';

/** What the model is told when a memory is held: enough to carry on, nothing to work around. */
const HELD =
  'Not remembered yet: it waits for the user to look at it in Conch (the chat shows them why). Don’t save it again in other words; carry on with what they asked.';

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
  /**
   * The memory check (ADR 0087). What the chat read, with what it brought
   * back; the person's own words; what this chat remembered a moment ago; and
   * whether the check is on (Settings → Safety). Without them, nothing was read.
   */
  check?: {
    read: () => readonly ReadThing[];
    said: () => readonly string[];
    recent: () => readonly { id: string; content: string; held?: boolean }[];
    on: () => Promise<boolean>;
    /** A cheap model for the second look; it can only raise a flag. */
    look?: () => Promise<LookModel | undefined>;
  };
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
      // And it's looked at first (ADR 0087): one that looks planted is held and asked about.
      const check = options.check;
      const read = check?.read() ?? [];
      const recent = check?.recent() ?? [];
      const input = {
        content,
        via: 'chat' as const,
        read,
        said: check?.said() ?? [],
        recent: recent.map(({ id, content: words }) => ({ id, content: words })),
        wary: recent.some((r) => r.held),
        on: (await check?.on().catch(() => true)) ?? true,
      };
      const verdict = await secondLook(checkMemory(input), input, check?.look);
      const held = holdOf(verdict);
      const memory = await store.add({
        content,
        kind,
        source: 'agent',
        conversationId,
        ...(untrusted && {
          ...(waits && { pending: true }),
          untrusted: `Learned in a chat that ${untrusted.replace(/^This chat /, '').replace(/, which could be trying to steer me\.$/, '')}.`,
        }),
        ...(held && { held }),
        provenance: {
          via: 'chat',
          ...(read.length > 0 && { read: [...new Set(read.map((r) => r.label))].slice(0, 12) }),
          ...(verdict.yours && { yours: true }),
        },
      });
      // What it adds up to with the pieces before it: those wait too.
      if (held && verdict.pieces)
        for (const id of verdict.pieces) {
          const piece = await store.get(id);
          if (piece && !piece.pending) {
            const again = await store.hold(id, held);
            if (again) options.onSaved(again);
          }
        }
      options.onSaved(memory);
      if (memory.held) return HELD;
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
      // Nothing waiting for an OK is ever handed to a model (ADR 0032, ADR 0087).
      const results = (
        options.search
          ? (await options.search(query)).map((r) => r.memory)
          : await store.search(query)
      ).filter((m) => !m.pending);
      return results.length
        ? results.map((m) => `[${m.id}] (${m.kind}) ${m.content}`).join('\n')
        : 'Nothing relevant in memory.';
    },
  };
  return [remember, forget, recall] as HostTool[];
}
