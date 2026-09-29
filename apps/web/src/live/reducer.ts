import type {
  ConversationEvent,
  ConversationStatus,
  EngineId,
  ToolStatus,
  TurnOptions,
  Usage,
} from '@conch/protocol';

/** Everything the transcript renders, folded from the append-only event log. */
export type TranscriptItem =
  | { kind: 'user'; id: string; text: string; at: number; pending?: boolean }
  | {
      kind: 'assistant';
      /** Unique per visual segment: `messageId` or `messageId#n`. */
      id: string;
      messageId: string;
      /** A later segment of the same turn (after tools) — rendered without a header. */
      continuation: boolean;
      text: string;
      thinking: string;
      done: boolean;
      startedAt: number;
      /** When the first visible text arrived — thinking ended. */
      textAt?: number;
      /** When something else (a tool, a prompt) interrupted the thinking. */
      thoughtEndedAt?: number;
      endedAt?: number;
    }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: unknown;
      status: ToolStatus;
      output?: string;
      durationMs?: number;
      startedAt: number;
    }
  | {
      kind: 'permission';
      id: string;
      toolName: string;
      summary: string;
      input: unknown;
      decision?: 'allow' | 'allow-always' | 'deny' | 'expired';
    }
  | { kind: 'memory'; id: string; memoryId: string; content: string; action: 'saved' | 'forgotten' }
  | {
      kind: 'routine';
      id: string;
      routineId: string;
      action: 'proposed' | 'updated' | 'paused' | 'deleted';
      title: string;
    }
  | {
      kind: 'integration-issue';
      id: string;
      integrationId: string;
      name: string;
      catalogId?: string;
      state: 'needs-auth' | 'error';
      message: string;
    }
  | {
      kind: 'skill';
      id: string;
      skillId: string;
      name: string;
      title: string;
      by: 'user' | 'assistant';
    }
  | {
      kind: 'turn-end';
      id: string;
      outcome: 'success' | 'interrupted' | 'error';
      error?: string;
      usage?: Usage;
      /** Which provider answered, and with which model. */
      engine?: EngineId;
      model?: string;
    };

export interface ConversationView {
  lastSeq: number;
  items: TranscriptItem[];
  status: ConversationStatus;
  title?: string;
  /** Start of the currently running turn (for elapsed timers). */
  turnStartedAt?: number;
  /** A live, transient notice from the engine (e.g. "retrying…"); clears when progress resumes. */
  notice?: string;
  /** The conversation's model/effort/mode overrides, as last seen in the log. */
  options?: TurnOptions;
}

export const emptyView: ConversationView = { lastSeq: -1, items: [], status: 'idle' };

function updateItem<K extends TranscriptItem['kind']>(
  items: TranscriptItem[],
  kind: K,
  id: string,
  fn: (item: Extract<TranscriptItem, { kind: K }>) => TranscriptItem,
): TranscriptItem[] | undefined {
  const index = items.findLastIndex((i) => i.kind === kind && i.id === id);
  if (index === -1) return undefined;
  const next = items.slice();
  next[index] = fn(items[index] as Extract<TranscriptItem, { kind: K }>);
  return next;
}

/** Thinking that's followed by a tool call ends there, for "Thought for Ns". */
function sealThinking(items: TranscriptItem[], at: number): TranscriptItem[] {
  const last = items.at(-1);
  if (last?.kind !== 'assistant' || last.textAt || last.thoughtEndedAt || !last.thinking)
    return items;
  return [...items.slice(0, -1), { ...last, thoughtEndedAt: at }];
}

/**
 * Pure fold of one event into a view. Events at or below `lastSeq` are ignored,
 * so replays after a reconnect are idempotent.
 */
export function reduce(view: ConversationView, event: ConversationEvent): ConversationView {
  if (event.seq <= view.lastSeq) return view;
  // Real progress (or the end of the turn) makes a stale "retrying…" notice irrelevant.
  const progressed =
    (event.type === 'assistant.delta' && event.kind === 'text') ||
    event.type === 'tool.started' ||
    event.type === 'turn.completed' ||
    event.type === 'user.message';
  const base = { ...view, lastSeq: event.seq, notice: progressed ? undefined : view.notice };
  const items =
    event.type === 'tool.started' ||
    event.type === 'permission.requested' ||
    event.type === 'memory.saved'
      ? sealThinking(view.items, event.at)
      : view.items;

  switch (event.type) {
    case 'user.message': {
      const withoutPending = items.filter((i) => !(i.kind === 'user' && i.id === event.messageId));
      return {
        ...base,
        turnStartedAt: event.at,
        items: [
          ...withoutPending,
          { kind: 'user', id: event.messageId, text: event.text, at: event.at },
        ],
      };
    }
    case 'assistant.delta': {
      // Append to the last item if it's this message; otherwise (tools or
      // prompts arrived in between) start a new segment so order stays true.
      const last = items.at(-1);
      if (last?.kind === 'assistant' && last.messageId === event.messageId) {
        const next = items.slice();
        next[next.length - 1] = {
          ...last,
          text: event.kind === 'text' ? last.text + event.delta : last.text,
          thinking: event.kind === 'thinking' ? last.thinking + event.delta : last.thinking,
          textAt: last.textAt ?? (event.kind === 'text' ? event.at : undefined),
        };
        return { ...base, items: next };
      }
      const turnStart = items.findLastIndex((i) => i.kind === 'user');
      const earlier = items.slice(turnStart + 1).filter((i) => i.kind === 'assistant');
      const segment = earlier.filter(
        (i) => i.kind === 'assistant' && i.messageId === event.messageId,
      ).length;
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'assistant',
            id: segment ? `${event.messageId}#${segment}` : event.messageId,
            messageId: event.messageId,
            continuation: earlier.length > 0,
            text: event.kind === 'text' ? event.delta : '',
            thinking: event.kind === 'thinking' ? event.delta : '',
            done: false,
            startedAt: event.at,
            textAt: event.kind === 'text' ? event.at : undefined,
          },
        ],
      };
    }
    case 'assistant.done': {
      let changed = false;
      const next = items.map((i) => {
        if (i.kind !== 'assistant' || i.messageId !== event.messageId || i.done) return i;
        changed = true;
        return { ...i, done: true, endedAt: event.at };
      });
      return changed ? { ...base, items: next } : base;
    }
    case 'tool.started':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'tool',
            id: event.toolUseId,
            name: event.name,
            input: event.input,
            status: 'running',
            startedAt: event.at,
          },
        ],
      };
    case 'tool.finished': {
      const updated = updateItem(items, 'tool', event.toolUseId, (item) => ({
        ...item,
        status: event.status,
        output: event.output,
        durationMs: event.durationMs,
      }));
      return updated ? { ...base, items: updated } : base;
    }
    case 'permission.requested':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'permission',
            id: event.permissionId,
            toolName: event.toolName,
            summary: event.summary,
            input: event.input,
          },
        ],
      };
    case 'permission.resolved': {
      const updated = updateItem(items, 'permission', event.permissionId, (item) => ({
        ...item,
        decision: event.decision,
      }));
      return updated ? { ...base, items: updated } : base;
    }
    case 'memory.saved':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'memory',
            id: `mem-${event.seq}`,
            memoryId: event.memory.id,
            content: event.memory.content,
            action: 'saved',
          },
        ],
      };
    case 'memory.forgotten':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'memory',
            id: `mem-${event.seq}`,
            memoryId: event.memoryId,
            content: event.content,
            action: 'forgotten',
          },
        ],
      };
    case 'status':
      return { ...base, status: event.status };
    case 'turn.completed': {
      // Any assistant message still open is finished now.
      const closed = items.map((i) =>
        i.kind === 'assistant' && !i.done ? { ...i, done: true, endedAt: event.at } : i,
      );
      return {
        ...base,
        turnStartedAt: undefined,
        items: [
          ...closed,
          {
            kind: 'turn-end',
            id: `end-${event.seq}`,
            outcome: event.outcome,
            error: event.error,
            usage: event.usage,
            engine: event.engine,
            model: event.model,
          },
        ],
      };
    }
    case 'title':
      return { ...base, title: event.title };
    case 'notice':
      return { ...base, notice: event.message };
    case 'options':
      return { ...base, options: event.options };
    case 'integration.issue': {
      // One card per integration per turn is plenty.
      const turnStart = items.findLastIndex((i) => i.kind === 'user');
      const shown = items
        .slice(turnStart + 1)
        .some((i) => i.kind === 'integration-issue' && i.integrationId === event.integrationId);
      if (shown) return base;
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'integration-issue',
            id: `issue-${event.seq}`,
            integrationId: event.integrationId,
            name: event.name,
            catalogId: event.catalogId,
            state: event.state,
            message: event.message,
          },
        ],
      };
    }
    case 'skill.used':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'skill',
            id: `skill-${event.seq}`,
            skillId: event.skillId,
            name: event.name,
            title: event.title,
            by: event.by,
          },
        ],
      };
    case 'routine':
      return {
        ...base,
        items: [
          ...items,
          {
            kind: 'routine',
            id: `routine-${event.seq}`,
            routineId: event.routineId,
            action: event.action,
            title: event.title,
          },
        ],
      };
  }
}

export function reduceAll(events: ConversationEvent[], view = emptyView): ConversationView {
  return events.reduce(reduce, view);
}

/** The text of the most recent user message (for "Try again"). */
export function lastUserText(view: ConversationView): string | undefined {
  for (let i = view.items.length - 1; i >= 0; i--) {
    const item = view.items[i];
    if (item?.kind === 'user') return item.text;
  }
  return undefined;
}

/** Is anything still waiting on the user? */
export function pendingPermission(view: ConversationView) {
  return view.items.find((i) => i.kind === 'permission' && !i.decision);
}
