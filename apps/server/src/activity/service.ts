/**
 * Everything the assistant did, in one place (ADR 0028): every command, file
 * change, page, app, question and answer, across every chat and routine,
 * newest first. Read from the chats' own logs, so it's always complete and
 * nothing extra is stored; each entry opens the chat where it happened.
 */
import type { ActivityEntry, ActivityKind, ActivityPage, ConversationEvent } from '@conch/protocol';

import { summarizeToolUse } from '../conversations/summarize';

export interface ActivitySource {
  list(): Promise<{ id: string; title: string; updatedAt: number; origin?: { kind: string } }[]>;
  events(id: string): Promise<ConversationEvent[]>;
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
/** Looking around isn't doing: reads and searches of your files stay out of the timeline. */
const QUIET = new Set(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Task', 'BashOutput']);

function kindOf(name: string): ActivityKind | undefined {
  if (QUIET.has(name)) return undefined;
  if (name === 'Bash') return 'command';
  if (FILE_TOOLS.has(name)) return 'file';
  if (WEB_TOOLS.has(name)) return 'web';
  if (/^mcp__/.test(name)) return 'app';
  return undefined;
}

/** The past tense of what a tool did: "Ran `npm test`", "Changed src/a.ts". */
export function didWhat(name: string, input: Record<string, unknown>): string {
  const wanted = summarizeToolUse(name, input);
  return wanted
    .replace(/^Run /, 'Ran ')
    .replace(/^Create /, 'Created ')
    .replace(/^Edit /, 'Changed ')
    .replace(/^Open /, 'Opened ')
    .replace(/^Search the web for /, 'Searched the web for ')
    .replace(/^Use (.+) from (.+)$/, 'Used $1 in $2')
    .replace(/^Use /, 'Used ');
}

/** One chat's log, as timeline entries (oldest first). */
export function entriesOf(
  chat: { id: string; title: string; origin?: { kind: string } },
  events: ConversationEvent[],
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const conversation = {
    id: chat.id,
    title: chat.title,
    ...(chat.origin?.kind === 'routine' && { routine: true }),
  };
  const started = new Map<
    string,
    { name: string; input: Record<string, unknown>; seq: number; at: number }
  >();
  const asked = new Map<string, { summary: string; seq: number }>();
  for (const e of events) {
    const base = { conversation };
    switch (e.type) {
      case 'tool.started': {
        const input = (e.input && typeof e.input === 'object' ? e.input : {}) as Record<
          string,
          unknown
        >;
        started.set(e.toolUseId, { name: e.name, input, seq: e.seq, at: e.at });
        break;
      }
      case 'tool.finished': {
        const call = started.get(e.toolUseId);
        const kind = call && kindOf(call.name);
        if (!call || !kind) break;
        out.push({
          ...base,
          id: `${chat.id}:${call.seq}`,
          at: call.at,
          kind,
          title: didWhat(call.name, call.input),
          status: e.status === 'success' ? 'done' : 'failed',
          anchor: e.toolUseId,
        });
        break;
      }
      case 'permission.requested':
        asked.set(e.permissionId, { summary: e.summary, seq: e.seq });
        break;
      case 'permission.resolved': {
        const q = asked.get(e.permissionId);
        if (!q) break;
        const allowed = e.decision === 'allow' || e.decision === 'allow-always';
        const said = `${q.summary.charAt(0).toLowerCase()}${q.summary.slice(1)}`;
        out.push({
          ...base,
          id: `${chat.id}:${e.seq}`,
          at: e.at,
          kind: 'approval',
          title:
            e.decision === 'expired'
              ? `Asked, and nobody answered: ${said}`
              : allowed
                ? `You allowed: ${said}`
                : `You said no: ${said}`,
          status: e.decision === 'expired' ? 'denied' : allowed ? 'allowed' : 'denied',
        });
        break;
      }
      case 'taint':
        out.push({
          ...base,
          id: `${chat.id}:${e.seq}`,
          at: e.at,
          kind: 'read',
          title: `Read ${e.source.kind === 'app' ? `things in ${e.source.label}` : e.source.kind === 'person' ? `a message from ${e.source.label}` : e.source.label}`,
          status: 'noted',
        });
        break;
      case 'memory.saved':
        out.push({
          ...base,
          id: `${chat.id}:${e.seq}`,
          at: e.at,
          kind: 'memory',
          title: `Remembered: ${e.memory.content.slice(0, 120)}`,
          status: 'done',
        });
        break;
      case 'memory.forgotten':
        out.push({
          ...base,
          id: `${chat.id}:${e.seq}`,
          at: e.at,
          kind: 'memory',
          title: `Forgot: ${e.content.slice(0, 120)}`,
          status: 'done',
        });
        break;
      default:
        break;
    }
  }
  // Still waiting on you: the newest thing it asked.
  const answered = new Set(
    events.flatMap((e) => (e.type === 'permission.resolved' ? [e.permissionId] : [])),
  );
  for (const e of events)
    if (e.type === 'permission.requested' && !answered.has(e.permissionId))
      out.push({
        conversation,
        id: `${chat.id}:${e.seq}`,
        at: e.at,
        kind: 'approval',
        title: `Waiting for you: ${e.summary.charAt(0).toLowerCase()}${e.summary.slice(1)}`,
        status: 'waiting',
      });
  return out;
}

export class Activity {
  constructor(private readonly source: ActivitySource) {}

  /** Newest first, `limit` at a time, older than `before`, of one kind or all. */
  async page(
    options: { before?: number; kind?: ActivityKind; limit?: number } = {},
  ): Promise<ActivityPage> {
    const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
    const before = options.before ?? Number.POSITIVE_INFINITY;
    const chats = (await this.source.list()).sort((a, b) => b.updatedAt - a.updatedAt);
    const found: ActivityEntry[] = [];
    for (const chat of chats) {
      // Everything in a chat happened by its last change: once enough is found that's
      // newer than this chat, nothing in it (or older chats) can come first.
      const cutoff =
        found.length >= limit ? (found.sort((a, b) => b.at - a.at)[limit - 1]?.at ?? 0) : 0;
      if (found.length >= limit && chat.updatedAt < cutoff) break;
      const entries = entriesOf(chat, await this.source.events(chat.id).catch(() => []));
      for (const entry of entries)
        if (entry.at < before && (!options.kind || entry.kind === options.kind)) found.push(entry);
    }
    found.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
    const entries = found.slice(0, limit);
    const more = found.length > limit || chats.some((c) => c.updatedAt < (entries.at(-1)?.at ?? 0));
    return { entries, ...(more && entries.length && { next: entries.at(-1)?.at }) };
  }
}
