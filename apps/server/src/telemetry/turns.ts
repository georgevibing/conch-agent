/**
 * Turns, as numbers and traces (ADR 0121), read from what Conch already
 * says: the conversation log every engine writes (`ConversationEvent`), and
 * the other events the gateway broadcasts. Nothing in a turn calls this, and
 * nothing here can slow one: it's a listener that adds to counters and builds
 * spans in memory, and its own failures are swallowed.
 *
 * A turn is a trace of three levels, as the GenAI conventions draw an agent:
 *
 *     invoke_agent Juniper          the turn, message to the end of the reply
 *       chat claude-sonnet-4-5      the model working, between tool calls
 *       execute_tool Bash           each tool call, its question if it asked
 *       chat claude-sonnet-4-5
 *
 * What it carries is what the labels may (`labels.ts`) plus counts and times.
 * The words — the message, the reply, a tool's input and output — only when
 * the person turned `content` on, and then through Conch's redaction first.
 */
import { createHmac, randomBytes } from 'node:crypto';

import type {
  ConversationEvent,
  ConversationSummary,
  RoutineRun,
  ServerEvent,
  Task,
} from '@conch/protocol';

import type { Meter } from './meter';
import {
  msToNs,
  SEVERITY,
  SPAN_KIND,
  STATUS,
  type Attributes,
  type LogData,
  type SpanData,
} from './otlp';

/** Conch's provider ids as the GenAI conventions name the companies (`gen_ai.provider.name`). */
const GENAI_PROVIDER: Record<string, string> = {
  'claude-code': 'anthropic',
  'anthropic-api': 'anthropic',
  'codex-cli': 'openai',
  'codex-agent': 'openai',
  openai: 'openai',
  'azure-openai': 'azure.ai.openai',
  bedrock: 'aws.bedrock',
  vertex: 'gcp.vertex_ai',
  gemini: 'gcp.gemini',
  'gemini-cli': 'gcp.gemini',
  grok: 'x_ai',
  xai: 'x_ai',
  deepseek: 'deepseek',
  mistral: 'mistral_ai',
  groq: 'groq',
  moonshot: 'moonshot_ai',
  copilot: 'github.copilot',
};

export const genAiProvider = (engine: string): string => GENAI_PROVIDER[engine] ?? engine;

/** Where a turn came from, in the few words its label allows. */
export function originOf(summary: Pick<ConversationSummary, 'origin'> | undefined): string {
  switch (summary?.origin?.kind) {
    case undefined:
      return 'chat';
    case 'routine':
      return 'routine';
    case 'task':
      return 'task';
    case 'channel':
      return 'channel';
    case 'client':
      return 'other_app';
    case 'peer':
      return 'agent';
    case 'artifact':
      return 'app_page';
  }
}

/** What a tool call came to: what was decided about it, else how it ran. */
export function toolOutcome(event: Extract<ConversationEvent, { type: 'tool.finished' }>): string {
  const approval = event.approval;
  if (approval === 'declined' || approval === 'expired' || approval === 'refused') return approval;
  return event.status === 'success' ? 'success' : 'error';
}

const DECISION: Record<string, string> = {
  allow: 'allowed',
  'allow-always': 'always',
  deny: 'denied',
  expired: 'expired',
};

const ENDED_RUNS = new Set([
  'succeeded',
  'nothing-to-do',
  'failed',
  'skipped',
  'missed',
  'stopped',
]);
const ENDED_TASKS = new Set(['done', 'unverified', 'failed', 'stopped', 'interrupted']);

/** At most this many turns are watched at once; at most this many spans one turn keeps. */
export const MAX_OPEN_TURNS = 256;
export const MAX_SPANS_PER_TURN = 200;
/** The words kept per turn when `content` is on: the reply, and each tool's input and output. */
const MAX_WORDS = 16_000;
const MAX_TOOL_WORDS = 4_000;

const hex = (bytes: number) => randomBytes(bytes).toString('hex');

interface OpenTool {
  spanId: string;
  name: string;
  startMs: number;
  events: SpanData['events'];
  args?: string;
}

interface Turn {
  traceId: string;
  rootId: string;
  startMs: number;
  firstTokenMs?: number;
  /** The model working since this moment, until the next tool call. */
  segmentFrom?: number;
  segments: { spanId: string; startMs: number; endMs: number }[];
  tools: Map<string, OpenTool>;
  done: SpanData[];
  /** A question's id, to the tool call it's about. */
  asked: Map<string, string>;
  spans: number;
  input?: string;
  output: string;
}

export interface TurnSinks {
  span(span: SpanData): void;
  log(log: LogData): void;
}

export interface TurnOptions {
  meter: Meter;
  sinks: TurnSinks;
  /** Whether the words go too, and how they're redacted first. */
  content: () => false | ((text: string) => string);
  /** Another convention's attributes the destination reads. */
  flavour: () => 'langfuse' | 'phoenix' | undefined;
  /** Keyed hash for a chat's id, so a trace can group a chat's turns without Conch's own id. */
  salt?: Buffer;
  now?: () => number;
}

/**
 * Watches the gateway's events and turns them into numbers, spans and
 * events. One per gateway; `observe` is the only way in.
 */
export class TurnWatcher {
  readonly #turns = new Map<string, Turn>();
  readonly #chats = new Map<string, Pick<ConversationSummary, 'origin' | 'agentId' | 'status'>>();
  readonly #agents = new Map<string, string>();
  #defaultAgent?: string;
  readonly #runs = new Map<string, string>();
  readonly #tasks = new Map<string, string>();
  readonly #salt: Buffer;
  /** The last turn's spans, for the preview. */
  last: SpanData[] = [];

  constructor(private readonly options: TurnOptions) {
    this.#salt = options.salt ?? randomBytes(32);
  }

  /** The agents' names, by id (Settings → Agents), so a turn says who answered. */
  setAgents(list: { agents: { id: string; name: string }[]; defaultId: string }): void {
    this.#agents.clear();
    for (const agent of list.agents) this.#agents.set(agent.id, agent.name);
    this.#defaultAgent = list.defaultId;
  }

  /** Turns working right now, and those waiting for an answer. */
  active(): { running: number; waiting: number } {
    let running = 0;
    let waiting = 0;
    for (const chat of this.#chats.values()) {
      if (chat.status === 'running') running++;
      else if (chat.status === 'awaiting-permission') waiting++;
    }
    return { running, waiting };
  }

  /** A chat's id as a trace may carry it: keyed, so it can't be turned back into Conch's. */
  pseudonym(conversationId: string): string {
    return createHmac('sha256', this.#salt).update(conversationId).digest('hex').slice(0, 32);
  }

  observe(event: ServerEvent): void {
    try {
      this.#observe(event);
    } catch {
      // Numbers are never worth a failure anywhere else.
    }
  }

  #observe(event: ServerEvent): void {
    switch (event.type) {
      case 'conversation.created':
      case 'conversation.updated': {
        const { id, origin, agentId, status } = event.conversation;
        this.#chats.delete(id);
        this.#chats.set(id, { ...(origin && { origin }), ...(agentId && { agentId }), status });
        if (this.#chats.size > 4000) {
          const oldest = this.#chats.keys().next().value;
          if (oldest !== undefined) this.#chats.delete(oldest);
        }
        return;
      }
      case 'conversation.deleted':
        this.#chats.delete(event.conversationId);
        this.#turns.delete(event.conversationId);
        return;
      case 'agents.changed':
        this.setAgents(event.list);
        return;
      case 'conversation.event':
        this.#event(event.event);
        return;
      case 'routine.run':
        this.#run(event.run);
        return;
      case 'task.changed':
        this.#task(event.task);
        return;
      case 'healed':
        this.options.meter.add('conch.repairs', 1, { 'conch.area': event.note.area });
        this.#log('conch.repair', 'Fixed something on its own', { 'conch.area': event.note.area });
        return;
      default:
        return;
    }
  }

  #labels(conversationId: string) {
    const chat = this.#chats.get(conversationId);
    const origin = originOf(chat);
    const agentId = chat?.agentId ?? this.#defaultAgent;
    const agent = agentId ? this.#agents.get(agentId) : undefined;
    const channel = chat?.origin?.kind === 'channel' ? chat.origin.channel : undefined;
    return { origin, agent, channel };
  }

  #open(conversationId: string, at: number): Turn {
    const turn: Turn = {
      traceId: hex(16),
      rootId: hex(8),
      startMs: at,
      segmentFrom: at,
      segments: [],
      tools: new Map(),
      done: [],
      asked: new Map(),
      spans: 1,
      output: '',
    };
    this.#turns.delete(conversationId);
    this.#turns.set(conversationId, turn);
    if (this.#turns.size > MAX_OPEN_TURNS) {
      const oldest = this.#turns.keys().next().value;
      if (oldest !== undefined) this.#turns.delete(oldest);
    }
    return turn;
  }

  #closeSegment(turn: Turn, at: number) {
    if (turn.segmentFrom === undefined) return;
    if (turn.spans < MAX_SPANS_PER_TURN) {
      turn.segments.push({
        spanId: hex(8),
        startMs: turn.segmentFrom,
        endMs: Math.max(at, turn.segmentFrom),
      });
      turn.spans++;
    }
    turn.segmentFrom = undefined;
  }

  #event(e: ConversationEvent): void {
    const { meter } = this.options;
    const id = e.conversationId;
    switch (e.type) {
      case 'user.message': {
        const { channel } = this.#labels(id);
        if (channel)
          meter.add('conch.channel.messages', 1, {
            'conch.channel': channel,
            'conch.direction': 'in',
          });
        const turn = this.#turns.get(id) ?? this.#open(id, e.at);
        const redact = this.options.content();
        if (redact && turn.input === undefined) turn.input = redact(e.text.slice(0, MAX_WORDS));
        return;
      }
      case 'status':
        if (e.status === 'running' && !this.#turns.has(id)) this.#open(id, e.at);
        return;
      case 'assistant.delta': {
        const turn = this.#turns.get(id);
        if (!turn || e.kind !== 'text') return;
        turn.firstTokenMs ??= e.at;
        if (this.options.content() && turn.output.length < MAX_WORDS)
          turn.output += e.delta.slice(0, MAX_WORDS - turn.output.length);
        return;
      }
      case 'assistant.done': {
        const { channel } = this.#labels(id);
        if (channel)
          meter.add('conch.channel.messages', 1, {
            'conch.channel': channel,
            'conch.direction': 'out',
          });
        return;
      }
      case 'tool.started': {
        const turn = this.#turns.get(id);
        if (!turn) return;
        this.#closeSegment(turn, e.at);
        if (turn.spans >= MAX_SPANS_PER_TURN) return;
        turn.spans++;
        const redact = this.options.content();
        let args: string | undefined;
        if (redact) {
          try {
            args = redact((JSON.stringify(e.input) ?? '').slice(0, MAX_TOOL_WORDS));
          } catch {
            args = undefined;
          }
        }
        turn.tools.set(e.toolUseId, {
          spanId: hex(8),
          name: e.name,
          startMs: e.at,
          events: [],
          ...(args !== undefined && { args }),
        });
        return;
      }
      case 'tool.finished':
        this.#toolFinished(e);
        return;
      case 'permission.requested': {
        meter.add('conch.approvals.asked', 1, { 'gen_ai.tool.name': e.toolName });
        const turn = this.#turns.get(id);
        if (!turn || !e.toolUseId) return;
        turn.asked.set(e.permissionId, e.toolUseId);
        turn.tools.get(e.toolUseId)?.events.push({
          timeNs: msToNs(e.at),
          name: 'conch.approval.asked',
          attributes: {},
        });
        return;
      }
      case 'permission.resolved': {
        const decision = DECISION[e.decision] ?? 'expired';
        const turn = this.#turns.get(id);
        const toolUseId = turn?.asked.get(e.permissionId);
        const tool = toolUseId ? turn?.tools.get(toolUseId) : undefined;
        meter.add('conch.approvals.answered', 1, {
          'gen_ai.tool.name': tool?.name ?? '_unknown',
          'conch.decision': decision,
        });
        tool?.events.push({
          timeNs: msToNs(e.at),
          name: 'conch.approval.answered',
          attributes: { 'conch.decision': decision },
        });
        this.#log('conch.approval', 'A question was answered', {
          'gen_ai.tool.name': tool?.name ?? '_unknown',
          'conch.decision': decision,
        });
        return;
      }
      case 'turn.completed':
        this.#completed(e);
        return;
      default:
        return;
    }
  }

  #toolFinished(e: Extract<ConversationEvent, { type: 'tool.finished' }>): void {
    const { meter } = this.options;
    const turn = this.#turns.get(e.conversationId);
    const open = turn?.tools.get(e.toolUseId);
    const name = open?.name ?? '_unknown';
    const outcome = toolOutcome(e);
    meter.add('conch.tool.calls', 1, { 'gen_ai.tool.name': name, 'conch.outcome': outcome });
    const ran = outcome === 'success' || outcome === 'error';
    const ms = e.durationMs ?? (open ? e.at - open.startMs : undefined);
    const type = name.startsWith('mcp__') ? 'extension' : 'function';
    if (ran && ms !== undefined)
      meter.record('gen_ai.execute_tool.duration', ms / 1000, {
        'gen_ai.tool.name': name,
        'gen_ai.tool.type': type,
        ...(outcome === 'error' && { 'error.type': 'tool_error' }),
      });
    this.#log(
      'conch.tool',
      'A tool call finished',
      {
        'gen_ai.tool.name': name,
        'conch.outcome': outcome,
        ...(ms !== undefined && { 'conch.duration_ms': Math.round(ms) }),
      },
      turn && open ? { traceId: turn.traceId, spanId: open.spanId } : undefined,
      outcome === 'error',
    );
    if (!turn || !open) return;
    turn.tools.delete(e.toolUseId);
    const redact = this.options.content();
    const flavour = this.options.flavour();
    const attributes: Attributes = {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': name,
      'gen_ai.tool.type': type,
      'gen_ai.tool.call.id': e.toolUseId.slice(0, 80),
      'conch.outcome': outcome,
      ...(outcome === 'error' && { 'error.type': 'tool_error' }),
      ...(flavour === 'phoenix' && { 'openinference.span.kind': 'TOOL', 'tool.name': name }),
    };
    if (redact) {
      if (open.args !== undefined) {
        attributes['gen_ai.tool.call.arguments'] = open.args;
        if (flavour === 'phoenix') attributes['input.value'] = open.args;
      }
      if (e.output) {
        const result = redact(e.output.slice(0, MAX_TOOL_WORDS));
        attributes['gen_ai.tool.call.result'] = result;
        if (flavour === 'phoenix') attributes['output.value'] = result;
      }
    }
    turn.done.push({
      traceId: turn.traceId,
      spanId: open.spanId,
      parentSpanId: turn.rootId,
      name: `execute_tool ${this.options.meter.labels.value('gen_ai.tool.name', name) ?? 'tool'}`,
      kind: SPAN_KIND.internal,
      startNs: msToNs(open.startMs),
      endNs: msToNs(Math.max(e.at, open.startMs)),
      attributes,
      events: open.events,
      status:
        outcome === 'error'
          ? { code: STATUS.error, message: 'The tool reported an error' }
          : { code: STATUS.unset },
    });
    if (!turn.tools.size) turn.segmentFrom = e.at;
  }

  #completed(e: Extract<ConversationEvent, { type: 'turn.completed' }>): void {
    const { meter } = this.options;
    const id = e.conversationId;
    const turn = this.#turns.get(id);
    this.#turns.delete(id);
    const { origin, agent } = this.#labels(id);
    const provider = e.engine ?? 'unknown';
    const model = e.model ?? 'default';
    const outcome = e.outcome === 'success' && e.paused ? 'paused' : e.outcome;
    const errorType = e.outcome === 'error' ? (e.problem ?? '_OTHER') : undefined;
    const turnLabels = {
      'conch.provider': provider,
      'gen_ai.request.model': model,
      'conch.origin': origin,
    };
    meter.add('conch.turns', 1, { ...turnLabels, 'conch.agent': agent, 'conch.outcome': outcome });
    const startMs =
      turn?.startMs ?? (e.usage?.durationMs !== undefined ? e.at - e.usage.durationMs : undefined);
    const seconds = startMs !== undefined ? Math.max(0, e.at - startMs) / 1000 : undefined;
    const genai = {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': genAiProvider(provider),
      ...turnLabels,
    };
    if (seconds !== undefined)
      meter.record('gen_ai.client.operation.duration', seconds, {
        ...genai,
        ...(errorType && { 'error.type': errorType }),
      });
    const usage = e.usage;
    if (usage) {
      meter.record('gen_ai.client.token.usage', usage.inputTokens, {
        ...genai,
        'gen_ai.token.type': 'input',
      });
      meter.record('gen_ai.client.token.usage', usage.outputTokens, {
        ...genai,
        'gen_ai.token.type': 'output',
      });
      meter.add('conch.tokens', usage.inputTokens, { ...turnLabels, 'conch.token.type': 'input' });
      meter.add('conch.tokens', usage.outputTokens, {
        ...turnLabels,
        'conch.token.type': 'output',
      });
      if (usage.cachedInputTokens)
        meter.add('conch.tokens', usage.cachedInputTokens, {
          ...turnLabels,
          'conch.token.type': 'cache_read',
        });
      if (usage.cacheWriteTokens)
        meter.add('conch.tokens', usage.cacheWriteTokens, {
          ...turnLabels,
          'conch.token.type': 'cache_write',
        });
    }
    if (e.cost?.usd !== undefined)
      meter.add('conch.cost.usd', e.cost.usd, { ...turnLabels, 'conch.billing': e.cost.billing });
    if (turn?.firstTokenMs !== undefined)
      meter.record(
        'conch.turn.time_to_first_token',
        Math.max(0, turn.firstTokenMs - turn.startMs) / 1000,
        turnLabels,
      );
    if (errorType)
      meter.add('conch.errors', 1, {
        'conch.provider': provider,
        'error.type': errorType,
        'conch.origin': origin,
      });

    const numbers: Attributes = {
      ...(usage && {
        'gen_ai.usage.input_tokens': usage.inputTokens,
        'gen_ai.usage.output_tokens': usage.outputTokens,
        ...(usage.cachedInputTokens !== undefined && {
          'gen_ai.usage.cache_read.input_tokens': usage.cachedInputTokens,
        }),
        ...(usage.cacheWriteTokens !== undefined && {
          'gen_ai.usage.cache_write.input_tokens': usage.cacheWriteTokens,
        }),
      }),
      ...(e.cost?.usd !== undefined && {
        'conch.cost.usd': e.cost.usd,
        'conch.billing': e.cost.billing,
      }),
    };
    this.#log(
      'conch.turn',
      e.outcome === 'error' ? 'A turn failed' : 'A turn finished',
      {
        ...turnLabels,
        'conch.outcome': outcome,
        ...(errorType && { 'error.type': errorType }),
        ...(seconds !== undefined && { 'conch.duration_ms': Math.round(seconds * 1000) }),
        ...numbers,
      },
      turn ? { traceId: turn.traceId, spanId: turn.rootId } : undefined,
      e.outcome === 'error',
    );
    if (!turn) return;
    this.#trace(turn, e, { provider, model, origin, agent, outcome, errorType, numbers });
  }

  #trace(
    turn: Turn,
    e: Extract<ConversationEvent, { type: 'turn.completed' }>,
    t: {
      provider: string;
      model: string;
      origin: string;
      agent?: string;
      outcome: string;
      errorType?: string;
      numbers: Attributes;
    },
  ): void {
    this.#closeSegment(turn, e.at);
    const labels = this.options.meter.labels;
    const model = labels.value('gen_ai.request.model', t.model) ?? 'model';
    const agent = labels.value('conch.agent', t.agent) ?? 'Conch';
    const provider = genAiProvider(t.provider);
    const flavour = this.options.flavour();
    const conversation = this.pseudonym(e.conversationId);
    const spans: SpanData[] = [];
    const redact = this.options.content();
    const root: Attributes = {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': labels.value('gen_ai.provider.name', provider) ?? provider,
      'gen_ai.agent.name': agent,
      'gen_ai.request.model': model,
      'gen_ai.response.model': model,
      'gen_ai.conversation.id': conversation,
      'conch.provider': labels.value('conch.provider', t.provider) ?? 'unknown',
      'conch.origin': t.origin,
      'conch.outcome': t.outcome,
      ...(t.errorType && { 'error.type': labels.value('error.type', t.errorType) ?? '_OTHER' }),
      ...t.numbers,
      ...(flavour === 'langfuse' && { 'langfuse.session.id': conversation }),
      ...(flavour === 'phoenix' && {
        'openinference.span.kind': 'AGENT',
        'session.id': conversation,
        'llm.model_name': model,
      }),
    };
    if (redact) {
      if (turn.input !== undefined) {
        root['gen_ai.input.messages'] = JSON.stringify([
          { role: 'user', parts: [{ type: 'text', content: turn.input }] },
        ]);
        if (flavour === 'phoenix') root['input.value'] = turn.input;
      }
      if (turn.output) {
        const output = redact(turn.output);
        root['gen_ai.output.messages'] = JSON.stringify([
          { role: 'assistant', parts: [{ type: 'text', content: output }] },
        ]);
        if (flavour === 'phoenix') root['output.value'] = output;
      }
    }
    spans.push({
      traceId: turn.traceId,
      spanId: turn.rootId,
      name: `invoke_agent ${agent}`,
      kind: SPAN_KIND.internal,
      startNs: msToNs(turn.startMs),
      endNs: msToNs(Math.max(e.at, turn.startMs)),
      attributes: root,
      events: [],
      status: t.errorType ? { code: STATUS.error, message: t.errorType } : { code: STATUS.unset },
    });
    for (const segment of turn.segments)
      spans.push({
        traceId: turn.traceId,
        spanId: segment.spanId,
        parentSpanId: turn.rootId,
        name: `chat ${model}`,
        kind: SPAN_KIND.client,
        startNs: msToNs(segment.startMs),
        endNs: msToNs(segment.endMs),
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': root['gen_ai.provider.name'] as string,
          'gen_ai.request.model': model,
          ...(flavour === 'phoenix' && {
            'openinference.span.kind': 'LLM',
            'llm.model_name': model,
          }),
        },
        events: [],
        status: { code: STATUS.unset },
      });
    spans.push(...turn.done);
    // A tool still open when the turn ended (stopped, failed): it ends with it.
    for (const [callId, tool] of turn.tools)
      spans.push({
        traceId: turn.traceId,
        spanId: tool.spanId,
        parentSpanId: turn.rootId,
        name: `execute_tool ${labels.value('gen_ai.tool.name', tool.name) ?? 'tool'}`,
        kind: SPAN_KIND.internal,
        startNs: msToNs(tool.startMs),
        endNs: msToNs(Math.max(e.at, tool.startMs)),
        attributes: {
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': labels.value('gen_ai.tool.name', tool.name) ?? 'tool',
          'gen_ai.tool.call.id': callId.slice(0, 80),
          'conch.outcome': 'interrupted',
        },
        events: tool.events,
        status: { code: STATUS.error, message: 'The turn ended first' },
      });
    this.last = spans;
    for (const span of spans) this.options.sinks.span(span);
  }

  #run(run: RoutineRun): void {
    if (!ENDED_RUNS.has(run.status) || this.#runs.get(run.id) === run.status) return;
    this.#runs.set(run.id, run.status);
    if (this.#runs.size > 2000) {
      const oldest = this.#runs.keys().next().value;
      if (oldest !== undefined) this.#runs.delete(oldest);
    }
    this.options.meter.add('conch.routine.runs', 1, {
      'conch.outcome': run.status,
      'conch.trigger': run.trigger,
    });
    this.#log(
      'conch.routine',
      'A routine run ended',
      {
        'conch.outcome': run.status,
        'conch.trigger': run.trigger,
      },
      undefined,
      run.status === 'failed',
    );
  }

  #task(task: Task): void {
    if (!ENDED_TASKS.has(task.status) || this.#tasks.get(task.id) === task.status) return;
    this.#tasks.set(task.id, task.status);
    if (this.#tasks.size > 2000) {
      const oldest = this.#tasks.keys().next().value;
      if (oldest !== undefined) this.#tasks.delete(oldest);
    }
    const outcome = task.status === 'interrupted' ? 'stopped' : task.status;
    this.options.meter.add('conch.tasks', 1, {
      'conch.task.kind': task.kind,
      'conch.outcome': outcome,
    });
    this.#log('conch.task', 'A task ended', {
      'conch.task.kind': task.kind,
      'conch.outcome': outcome,
    });
  }

  #log(
    name: string,
    body: string,
    raw: Record<string, string | number | undefined>,
    link?: { traceId: string; spanId: string },
    warn = false,
  ): void {
    const labels = this.options.meter.labels;
    const attributes: Attributes = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined) continue;
      if (typeof value === 'number') attributes[key] = value;
      else {
        const safe = labels.value(key, value);
        if (safe !== undefined) attributes[key] = safe;
      }
    }
    this.options.sinks.log({
      timeNs: msToNs((this.options.now ?? Date.now)()),
      severity: warn ? SEVERITY.warn : SEVERITY.info,
      body,
      eventName: name,
      attributes,
      ...(link && { traceId: link.traceId, spanId: link.spanId }),
    });
  }
}
