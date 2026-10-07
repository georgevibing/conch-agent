import { MemoryKind, type Memory } from '@conch/protocol';
import { z } from 'zod';

import type { HostTool } from '../engines/types';
import { taskPermission } from '../learning/policy';
import { checkMemory, datamark, type LookModel, type ReadThing } from './guard';
import { compactMemory } from './compact';
import { outsideOf } from './prompt';
import type { MemoryStore } from './store';

/** What the model is told when a memory is held: enough to carry on, nothing to work around. */
const HELD =
  'Not remembered yet: it waits for the user to look at it in Conch (the chat shows them why). Don’t save it again in other words; carry on with what they asked.';

/** Not kept, nobody asked: unattended after reading, and not the person's own words. */
const UNSEEN =
  'Not saved: with nobody here to check it, Conch only remembers what the user said themselves after reading something from outside. Carry on with what they asked.';

/** Not kept, nobody asked: the person took it back once. */
const REFUSED =
  'Not saved: the user took this back before. Don’t save it again in other words; carry on with what they asked.';

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
   * Nobody is there to see it and undo it (a routine, a chat app): after reading
   * something untrusted, only the person's own words are remembered. In a chat
   * you're in, it's remembered at once and the chat says so, with Undo.
   */
  waits?: () => boolean;
  /** Memories that stopped being true, for questions about before (ADR 0088). */
  searchPast?: (query: string) => Promise<Memory[]>;
  /**
   * The person took this back once (ADR 0088 § 6): the assistant can't
   * remember it again unless the person said it again themselves.
   */
  never?: (content: string) => Promise<boolean>;
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
      'Save one durable fact about the user to long-term memory so you know it in future conversations. Save useful preferences and lasting facts proactively, without asking for routine confirmation. One concise, self-contained, third-person statement per call; long wording is compacted automatically.',
    input: { content: z.string().min(1).max(2000), kind: MemoryKind.optional() },
    async run({ content, kind }) {
      if (taskPermission(content))
        return 'Not saved: permission for this task belongs to this chat, not long-term memory. Carry on with the task.';
      // After reading something untrusted, a page could be the one asking (ADR 0032): its
      // provenance stays attached. Owner evidence avoids any housekeeping hold (ADR 0097).
      const untrusted = options.untrusted?.();
      const check = options.check;
      // What the chat read; when only the taint is known, that it read something.
      const read: readonly ReadThing[] =
        check?.read() ?? (untrusted ? [{ kind: 'web', label: 'something this chat read' }] : []);
      const own = checkMemory({ content, via: 'chat', read, said: check?.said() });
      // Nobody is there to see it and undo it (a routine, a chat app, someone else's words):
      // only what the person said themselves is kept. Anything else harmless is left out
      // quietly rather than queued as a question (ADR 0097); what looks planted still goes
      // on to the check, which holds it and tells the person.
      if (untrusted && (options.waits?.() ?? true) && !own.yours && own.verdict === 'ok')
        return UNSEEN;
      // Something the person took back once: kept again only when they said it again.
      const original = content;
      const refused = !own.yours && (await options.never?.(content).catch(() => true));
      if (refused) return REFUSED;
      // And it's looked at first (ADR 0087): one that looks planted is held and asked about.
      const recent = check?.recent() ?? [];
      content = await compactMemory(
        content,
        { via: 'chat', read, said: check?.said() ?? [] },
        check?.look,
      );
      if (content !== original && !own.yours && (await options.never?.(content).catch(() => true)))
        return REFUSED;
      // The store runs the check where it writes (ADR 0087); this says what's behind it.
      const { memory, verdict } = await store.write(
        {
          content,
          kind,
          source: 'agent',
          conversationId,
          ...(untrusted && {
            untrusted: `Learned in a chat that ${untrusted.replace(/^This chat /, '').replace(/, which could be trying to steer me\.$/, '')}.`,
          }),
          provenance: {
            via: 'chat',
            ...(read.length > 0 && { read: [...new Set(read.map((r) => r.label))].slice(0, 12) }),
          },
        },
        {
          via: 'chat',
          read,
          said: check?.said() ?? [],
          recent: recent.map(({ id, content: words }) => ({ id, content: words })),
          wary: recent.some((r) => r.held),
          ...(check && { on: await check.on().catch(() => true) }),
          ...(check?.look && { look: check.look }),
        },
      );
      const held = memory.held;
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
      if (memory.held || memory.pending) return HELD;
      return `Saved to memory as ${memory.id}.`;
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
    effect: 'read',
    description: 'Search long-term memory for things you may know about the user.',
    input: { query: z.string().min(1).max(200) },
    async run({ query }) {
      // Nothing waiting for an OK is ever handed to a model (ADR 0032, ADR 0087).
      const results = (
        options.search
          ? (await options.search(query)).map((r) => r.memory)
          : await store.search(query)
      ).filter((m) => !m.pending);
      // What used to be true, dated, for questions about before (ADR 0088).
      const past = (await options.searchPast?.(query).catch(() => [])) ?? [];
      const lines = [
        ...results.map((m) => `[${m.id}] (${m.kind}) ${m.content}`),
        ...(past.length
          ? [
              'No longer true (kept for questions about before):',
              // One from outside is marked as data, as in the prompt (ADR 0087).
              ...past.map(
                (m) =>
                  `- ${outsideOf(m) ? datamark(m.content) : m.content} (until ${until(m.invalidAt ?? m.updatedAt)})`,
              ),
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
