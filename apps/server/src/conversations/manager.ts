import type {
  ConversationEvent,
  ConversationEventInput,
  ConversationStatus,
  ConversationSummary,
  ServerEvent,
} from '@conch/protocol';

import type { Engine, PermissionDecision } from '../engines/types';
import { Emitter } from '../lib/emitter';
import { newId } from '../lib/ids';
import { buildSystemAppend } from '../memory/prompt';
import type { MemoryStore } from '../memory/store';
import { memoryTools } from '../memory/tools';
import type { SettingsStore } from '../settings/store';
import type { ConversationRecord, ConversationStore } from './store';
import { summarizeToolUse, titleFrom } from './summarize';

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  toolName: string;
}

interface Live {
  record: ConversationRecord;
  events: ConversationEvent[];
  seq: number;
  abort?: AbortController;
  permissions: Map<string, PendingPermission>;
  /** Tools the user said "always allow" for, in this conversation. */
  alwaysAllow: Set<string>;
}

export class ConversationError extends Error {
  constructor(
    readonly code: 'not-found' | 'busy' | 'engine-unavailable',
    message: string,
  ) {
    super(message);
  }
}

/** Host tools are shown through memory events, not as tool calls. */
const isHostTool = (name: string) => name.startsWith('mcp__conch__');

/**
 * Owns every conversation's live state: the event log, the running turn, and
 * pending permission prompts. Everything observable goes out through `events`.
 */
export class ConversationManager {
  readonly events = new Emitter<ServerEvent>();
  #live = new Map<string, Live>();

  constructor(
    private readonly deps: {
      store: ConversationStore;
      settings: SettingsStore;
      memory: MemoryStore;
      engine: () => Engine;
    },
  ) {}

  async list(): Promise<ConversationSummary[]> {
    const records = await this.deps.store.list();
    return records.map((r) => summary(this.#live.get(r.id)?.record ?? r));
  }

  async detail(id: string) {
    const live = await this.#get(id);
    return { conversation: summary(live.record), events: live.events };
  }

  async rename(id: string, title: string) {
    const live = await this.#get(id);
    live.record = { ...live.record, title };
    await this.deps.store.upsert(live.record);
    this.#append(live, { type: 'title', title });
    this.events.emit({ type: 'conversation.updated', conversation: summary(live.record) });
  }

  async remove(id: string) {
    const live = this.#live.get(id);
    live?.abort?.abort();
    this.#live.delete(id);
    await this.deps.store.remove(id);
    this.events.emit({ type: 'conversation.deleted', conversationId: id });
  }

  async eventsAfter(id: string, afterSeq = -1): Promise<ConversationEvent[]> {
    const live = await this.#get(id);
    return live.events.filter((e) => e.seq > afterSeq);
  }

  /** Send a user message, creating the conversation if needed. Returns immediately; the turn streams. */
  async send(input: { conversationId?: string; clientMessageId: string; text: string }) {
    const engine = this.deps.engine();
    const status = await engine.detect();
    if (status.state !== 'ready') {
      throw new ConversationError(
        'engine-unavailable',
        status.state === 'not-installed'
          ? "Claude Code isn't installed yet."
          : status.state === 'signed-out'
            ? 'Claude Code is signed out.'
            : (status.message ?? 'Claude Code is unavailable.'),
      );
    }

    let live: Live;
    if (input.conversationId) {
      live = await this.#get(input.conversationId);
      if (live.abort) throw new ConversationError('busy', 'Claude is still replying.');
    } else {
      const now = Date.now();
      const record: ConversationRecord = {
        id: newId('c'),
        title: titleFrom(input.text),
        preview: input.text.slice(0, 140),
        createdAt: now,
        updatedAt: now,
        status: 'idle',
        engine: engine.id,
      };
      live = { record, events: [], seq: 0, permissions: new Map(), alwaysAllow: new Set() };
      this.#live.set(record.id, live);
      await this.deps.store.upsert(record);
      this.events.emit({
        type: 'conversation.created',
        clientMessageId: input.clientMessageId,
        conversation: summary(record),
      });
    }

    this.#append(live, {
      type: 'user.message',
      messageId: input.clientMessageId,
      text: input.text,
    });
    live.record = { ...live.record, preview: input.text.slice(0, 140), updatedAt: Date.now() };
    live.abort = new AbortController();
    this.#setStatus(live, 'running');
    await this.#persist(live);
    void this.#runTurn(live, engine, input.text);
    return summary(live.record);
  }

  async interrupt(id: string) {
    const live = await this.#get(id);
    live.abort?.abort();
  }

  async respond(id: string, permissionId: string, decision: PermissionDecision) {
    const live = await this.#get(id);
    const pending = live.permissions.get(permissionId);
    if (!pending) return;
    live.permissions.delete(permissionId);
    if (decision === 'allow-always') live.alwaysAllow.add(pending.toolName);
    this.#append(live, { type: 'permission.resolved', permissionId, decision });
    if (live.permissions.size === 0) this.#setStatus(live, 'running');
    pending.resolve(decision);
  }

  async #runTurn(live: Live, engine: Engine, prompt: string) {
    const abort = live.abort ?? new AbortController();
    const conversationId = live.record.id;
    const settings = await this.deps.settings.get();
    const memories = await this.deps.memory.list();
    const started = new Map<string, number>();
    let outcome: 'success' | 'interrupted' | 'error' = 'success';
    let completed = false;

    const tools = memoryTools({
      store: this.deps.memory,
      conversationId,
      onSaved: (memory) => {
        this.#append(live, { type: 'memory.saved', memory });
      },
      onForgotten: (memory) => {
        this.#append(live, {
          type: 'memory.forgotten',
          memoryId: memory.id,
          content: memory.content,
        });
      },
    });

    try {
      const stream = engine.runTurn({
        conversationId,
        prompt,
        resumeId: live.record.resumeId,
        systemAppend: buildSystemAppend({
          persona: settings.persona,
          profile: settings.profile,
          memories,
          autoMemory: settings.preferences.autoMemory,
        }),
        cwd: await this.deps.settings.workspace(),
        tools,
        signal: abort.signal,
        requestPermission: (request, signal) => {
          if (live.alwaysAllow.has(request.toolName)) return Promise.resolve('allow');
          const permissionId = newId('perm');
          return new Promise<PermissionDecision>((resolve) => {
            live.permissions.set(permissionId, { resolve, toolName: request.toolName });
            const expire = () => {
              if (!live.permissions.delete(permissionId)) return;
              this.#append(live, {
                type: 'permission.resolved',
                permissionId,
                decision: 'expired',
              });
              resolve('deny');
            };
            signal.addEventListener('abort', expire, { once: true });
            abort.signal.addEventListener('abort', expire, { once: true });
            this.#append(live, {
              type: 'permission.requested',
              permissionId,
              toolUseId: request.toolUseId,
              toolName: request.toolName,
              input: request.input,
              summary: summarizeToolUse(request.toolName, request.input),
            });
            this.#setStatus(live, 'awaiting-permission');
          });
        },
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'session':
            live.record = { ...live.record, resumeId: event.resumeId };
            break;
          case 'text':
          case 'thinking':
            this.#append(live, {
              type: 'assistant.delta',
              messageId: event.messageId,
              kind: event.type,
              delta: event.delta,
            });
            break;
          case 'message-done':
            this.#append(live, { type: 'assistant.done', messageId: event.messageId });
            break;
          case 'tool-start':
            if (isHostTool(event.name)) break;
            started.set(event.toolUseId, Date.now());
            this.#append(live, {
              type: 'tool.started',
              toolUseId: event.toolUseId,
              name: event.name,
              input: event.input,
            });
            break;
          case 'tool-end': {
            const at = started.get(event.toolUseId);
            if (at === undefined) break;
            this.#append(live, {
              type: 'tool.finished',
              toolUseId: event.toolUseId,
              status: event.status,
              output: event.output,
              durationMs: Date.now() - at,
            });
            break;
          }
          case 'done':
            outcome = event.outcome;
            completed = true;
            this.#append(live, {
              type: 'turn.completed',
              outcome: event.outcome,
              usage: event.usage,
              error: event.error,
            });
            break;
        }
      }
      if (!completed) {
        outcome = abort.signal.aborted ? 'interrupted' : 'error';
        this.#append(live, { type: 'turn.completed', outcome });
      }
    } catch (error) {
      outcome = 'error';
      this.#append(live, {
        type: 'turn.completed',
        outcome: 'error',
        error: (error as Error).message || 'Something went wrong.',
      });
    } finally {
      // Close any tool call the engine never finished (e.g. interrupted mid-run).
      const finished = new Set(
        live.events.flatMap((e) => (e.type === 'tool.finished' ? [e.toolUseId] : [])),
      );
      for (const [toolUseId, at] of started) {
        if (!finished.has(toolUseId)) {
          this.#append(live, {
            type: 'tool.finished',
            toolUseId,
            status: 'error',
            output: outcome === 'interrupted' ? 'Stopped.' : undefined,
            durationMs: Date.now() - at,
          });
        }
      }
      live.abort = undefined;
      live.permissions.clear();
      live.record = { ...live.record, updatedAt: Date.now() };
      this.#setStatus(live, outcome === 'error' ? 'error' : 'idle');
      await this.#persist(live);
    }
  }

  #append(live: Live, input: ConversationEventInput) {
    const event = {
      ...input,
      conversationId: live.record.id,
      seq: live.seq++,
      at: Date.now(),
    } as ConversationEvent;
    live.events.push(event);
    this.events.emit({ type: 'conversation.event', event });
  }

  #setStatus(live: Live, status: ConversationStatus) {
    if (live.record.status === status) return;
    live.record = { ...live.record, status };
    this.#append(live, { type: 'status', status });
    this.events.emit({ type: 'conversation.updated', conversation: summary(live.record) });
  }

  async #persist(live: Live) {
    await this.deps.store.upsert(live.record);
    await this.deps.store.saveEvents(live.record.id, live.events);
  }

  async #get(id: string): Promise<Live> {
    const cached = this.#live.get(id);
    if (cached) return cached;
    const record = await this.deps.store.get(id);
    if (!record) throw new ConversationError('not-found', 'Conversation not found.');
    const events = await this.deps.store.events(id);
    const live: Live = {
      record,
      events,
      seq: (events.at(-1)?.seq ?? -1) + 1,
      permissions: new Map(),
      alwaysAllow: new Set(),
    };
    this.#live.set(id, live);
    return live;
  }
}

function summary(record: ConversationRecord): ConversationSummary {
  const { id, title, preview, createdAt, updatedAt, status } = record;
  return { id, title, preview, createdAt, updatedAt, status };
}
