/**
 * Ollama — a model on this computer (ADR 0022).
 *
 * Conch speaks Ollama's native `POST /api/chat`, not its OpenAI-compatible
 * `/v1/chat/completions`, because only the native API lets it set the context
 * size per request (`options.num_ctx`). Ollama's default is 4,096 tokens on
 * most computers, and Conch's own tools don't fit in that: without it the model
 * would silently lose the start of every conversation.
 *
 * Details that are easy to get wrong, checked against Ollama 0.35:
 *  - the stream is NDJSON, one JSON object per line, not SSE;
 *  - a tool call arrives whole in one chunk, `arguments` already an object
 *    (not a JSON string), with an `id` since 0.12.10 — older ones have none;
 *  - a failure after the 200 arrives as a line with a top-level `error`;
 *  - `think: true` on a model that can't think is a 400, and so are tools on a
 *    model that can't call them — both are healed here by asking again
 *    without, once;
 *  - the whole assistant message (thinking, content, tool calls) goes back in
 *    the next request, and tool results are `role: "tool"` with `tool_name`.
 *
 * Everything goes to this computer only: `send(…, local: true)` refuses any
 * address that isn't loopback, and the model list and detection never reach
 * the internet.
 */
import type { EffortChoice, EngineStatus, LocalModel } from '@conch/protocol';
import { z } from 'zod';

import { gigabytes } from '../../local/models';
import { errorOf, ndjson, type OllamaClient } from '../../local/ollama';
import type { Completion, EngineUsage, TurnImage } from '../types';
import { defaultHome } from './session';
import {
  ApiError,
  type ApiVariant,
  type WireAccount,
  type WireCompletion,
  type WireEvent,
  type WireMessage,
  type WireModel,
  type WireRequest,
  type WireStop,
  type WireToolCall,
  type WireUsage,
} from './types';
import { send, text, validate, type ToolResult, type Wire } from './wire';

/** What the person calls this provider (the picker's group, the chat's sentences). */
export const LOCAL_LABEL = 'On this computer';

/** What the wire needs from the rest of Conch: where Ollama is, and keeping it running. */
export interface OllamaLink {
  readonly client: OllamaClient;
  /** Models here that can chat, with what each can do. */
  models(): Promise<LocalModel[]>;
  /** The context size to ask for: the same every time for a model, or Ollama reloads it. */
  contextFor(model: string): number;
  /** Start Ollama if it's installed and stopped. Says so in "Fixed on its own" when `note`. */
  ensureRunning(options: { note: boolean }): Promise<boolean>;
  /** Whether a model is in memory right now (a cold one takes a moment to load). */
  loaded(model: string): Promise<boolean>;
  /** How it is, for the provider card. */
  engineStatus(): Promise<EngineStatus>;
}

const ToolCall = z.object({
  id: z.string().nullish(),
  function: z.object({
    index: z.number().nullish(),
    name: z.string(),
    arguments: z.union([z.record(z.string(), z.unknown()), z.string()]).nullish(),
  }),
});

const Chunk = z.object({
  message: z
    .object({
      content: z.string().nullish(),
      thinking: z.string().nullish(),
      tool_calls: z.array(ToolCall).nullish(),
    })
    .nullish(),
  done: z.boolean().nullish(),
  done_reason: z.string().nullish(),
  prompt_eval_count: z.number().nullish(),
  eval_count: z.number().nullish(),
  error: z.string().nullish(),
});

const Reply = Chunk;

/** A model the thinking dial can set to a level (gpt-oss); the rest think or don't. */
const LEVELS = /gpt-oss/i;

/**
 * What `think` to send for a chosen effort. Small models on an ordinary
 * computer are slow to think, so they answer straight away unless the person
 * asked for care; a model that can't think gets nothing (a `think` would be a 400).
 */
export function thinkFor(
  model: { name: string; thinking: boolean } | undefined,
  effort: EffortChoice,
): boolean | 'low' | 'medium' | 'high' | undefined {
  if (!model?.thinking) return undefined;
  if (LEVELS.test(model.name)) {
    if (effort === 'auto') return undefined;
    return effort === 'low' || effort === 'medium' ? effort : 'high';
  }
  return effort === 'auto' || effort === 'low' ? false : true;
}

function usageOf(chunk: z.infer<typeof Chunk>): WireUsage | undefined {
  if (chunk.prompt_eval_count == null && chunk.eval_count == null) return undefined;
  return {
    inputTokens: Math.max(0, Math.round(chunk.prompt_eval_count ?? 0)),
    outputTokens: Math.max(0, Math.round(chunk.eval_count ?? 0)),
    // It ran on this computer.
    costUsd: 0,
  };
}

/** Ollama's error text, as a sentence a person can act on. */
export function mapError(status: number, message: string, model: string): ApiError {
  if (status === 404 || /not found|try pulling/i.test(message)) {
    return new ApiError(
      'not-found',
      `${model} isn’t on this computer any more. Pick another model, or get it again in Settings → Providers → On this computer.`,
    );
  }
  if (
    /more system memory|out of memory|insufficient memory|cudaMalloc|unable to allocate/i.test(
      message,
    )
  ) {
    return new ApiError(
      'other',
      `${model} needs more memory than this computer has free right now. Close a few apps, or pick a smaller model.`,
    );
  }
  if (/context|too long|exceeds/i.test(message)) {
    return new ApiError(
      'context',
      'This conversation is longer than the model can read. Start a new chat to carry on.',
    );
  }
  if (status === 503 || /server busy|maximum pending/i.test(message)) {
    return new ApiError('overloaded', 'Ollama is busy with another request.', {
      retryable: true,
      retryAfterMs: 2_000,
    });
  }
  return new ApiError('other', `The model on this computer stopped: ${message.slice(0, 200)}`);
}

export class OllamaWire implements Wire {
  readonly source = LOCAL_LABEL;
  #models = new Map<string, LocalModel>();
  /** Models Ollama said can't call tools or think, whatever `/api/show` claimed. */
  #noTools = new Set<string>();
  #noThinking = new Set<string>();

  constructor(private readonly link: OllamaLink) {}

  /** Nothing to check: there's no key. The status says whether it's here. */
  async check(): Promise<WireAccount> {
    return { description: LOCAL_LABEL };
  }

  async models(): Promise<WireModel[]> {
    const models = await this.link.models();
    this.#models = new Map(models.map((m) => [m.name, m]));
    return models.map((m) => {
      const tools = m.tools && !this.#noTools.has(m.name);
      const thinking = m.thinking && !this.#noThinking.has(m.name);
      return {
        info: {
          id: m.name,
          label: m.label,
          description: [
            gigabytes(m.sizeBytes),
            tools ? 'uses your apps' : 'can’t use your apps or memory',
          ].join(' · '),
          // Thinking is on or off for most; gpt-oss takes a level.
          efforts: thinking ? (LEVELS.test(m.name) ? ['low', 'medium', 'high'] : ['high']) : [],
          supportsFastMode: false,
          supportsAutoMode: false,
          images: m.vision,
        },
        tools,
        thinking,
      };
    });
  }

  toolsFor(model: string): boolean | undefined {
    if (this.#noTools.has(model)) return false;
    return this.#models.get(model)?.tools;
  }

  smallModel(): string | undefined {
    // Every local model is free; the one the person chose is the one that's loaded.
    return undefined;
  }

  userMessage(content: string, images?: readonly TurnImage[]): WireMessage {
    return {
      role: 'user',
      content,
      ...(images?.length && { images: images.map((image) => image.data) }),
    };
  }

  toolResults(results: ToolResult[]): WireMessage[] {
    return results.map((result) => ({
      role: 'tool',
      tool_name: result.name,
      tool_call_id: result.id,
      content: result.text,
    }));
  }

  /**
   * Send one request to Ollama. If it isn't answering, it's started (quietly,
   * noted as fixed on its own) and asked once more.
   */
  async #post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const once = () =>
      send({
        fetchImpl: this.link.client.fetch,
        url: this.link.client.url(path),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal,
        label: 'Ollama',
        local: true,
      });
    try {
      return await once();
    } catch (error) {
      if (!(error instanceof ApiError) || error.kind !== 'network' || signal.aborted) throw error;
      if (!(await this.link.ensureRunning({ note: true }))) {
        throw new ApiError(
          'network',
          'Ollama isn’t running, and Conch couldn’t start it. Open Settings → Providers → On this computer.',
        );
      }
      return once();
    }
  }

  #body(request: WireRequest, options: { tools: boolean; think: boolean }) {
    const model = this.#models.get(request.model);
    const think = options.think ? thinkFor(model, request.effort) : undefined;
    return {
      model: request.model,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      stream: true,
      options: { num_ctx: this.link.contextFor(request.model) },
      ...(options.tools &&
        request.tools.length && {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.schema },
          })),
        }),
      ...(think !== undefined && { think }),
    };
  }

  /** Ask, healing the two refusals that only mean "this model can't do that". */
  async #chat(request: WireRequest): Promise<Response> {
    let tools = !this.#noTools.has(request.model);
    let think = !this.#noThinking.has(request.model);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.#post(
        '/api/chat',
        this.#body(request, { tools, think }),
        request.signal,
      );
      if (response.ok) return response;
      const message = await errorOf(response);
      if (response.status === 400 && tools && /does not support tools/i.test(message)) {
        this.#noTools.add(request.model);
        tools = false;
        continue;
      }
      if (response.status === 400 && think && /does not support think/i.test(message)) {
        this.#noThinking.add(request.model);
        think = false;
        continue;
      }
      throw mapError(response.status, message, this.#label(request.model));
    }
    throw new ApiError('other', 'The model on this computer refused the request.');
  }

  #label(model: string): string {
    return this.#models.get(model)?.label ?? model;
  }

  async *stream(request: WireRequest): AsyncIterable<WireEvent> {
    const toolsBefore = !this.#noTools.has(request.model);
    // A model that isn't in memory takes a few seconds to load: say so, rather than a silent spinner.
    if (!(await this.link.loaded(request.model).catch(() => true))) {
      yield {
        type: 'notice',
        code: 'loading',
        message: `Loading ${this.#label(request.model)} into memory — the first answer takes a moment.`,
      };
    }
    const response = await this.#chat(request);
    if (toolsBefore && this.#noTools.has(request.model) && request.tools.length) {
      yield {
        type: 'notice',
        code: 'no-tools',
        message: `${this.#label(request.model)} can’t use tools, so it’s answering without your apps and memory.`,
      };
    }
    if (!response.body) throw new ApiError('network', 'Ollama sent an empty reply.');

    let content = '';
    let thinking = '';
    const calls: WireToolCall[] = [];
    const wireCalls: Record<string, unknown>[] = [];
    let usage: WireUsage | undefined;
    let reason: string | undefined;

    for await (const raw of ndjson(response.body, request.signal)) {
      const parsed = Chunk.safeParse(raw);
      if (!parsed.success) continue;
      const chunk = parsed.data;
      if (chunk.error) throw mapError(200, chunk.error, this.#label(request.model));
      const message = chunk.message;
      if (message?.thinking) {
        thinking += message.thinking;
        yield { type: 'thinking', delta: message.thinking };
      }
      if (message?.content) {
        content += message.content;
        yield { type: 'text', delta: message.content };
      }
      for (const call of message?.tool_calls ?? []) {
        const args = call.function.arguments ?? {};
        const id = call.id || `call_${calls.length}_${Date.now().toString(36)}`;
        calls.push({
          id,
          name: call.function.name,
          argumentsJson: typeof args === 'string' ? args : JSON.stringify(args),
        });
        // Replayed as Ollama sent it: arguments stay an object.
        wireCalls.push({
          ...(call.id && { id: call.id }),
          function: {
            ...(typeof call.function.index === 'number' && { index: call.function.index }),
            name: call.function.name,
            arguments: typeof args === 'string' ? safeObject(args) : args,
          },
        });
      }
      if (chunk.done) {
        usage = usageOf(chunk);
        reason = chunk.done_reason ?? undefined;
      }
    }

    const stop: WireStop = calls.length ? 'tools' : reason === 'length' ? 'length' : 'end';
    const message: WireMessage = {
      role: 'assistant',
      content,
      ...(thinking && { thinking }),
      ...(wireCalls.length && { tool_calls: wireCalls }),
    };
    yield { type: 'end', message, toolCalls: calls, stop, ...(usage && { usage }) };
  }

  async complete(request: WireCompletion): Promise<Completion> {
    const model = this.#models.get(request.model);
    const response = await this.#post(
      '/api/chat',
      {
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
        stream: false,
        // The same context as a chat, or Ollama would reload the model just for this.
        options: { num_ctx: this.link.contextFor(request.model), num_predict: request.maxTokens },
        ...(model?.thinking && !LEVELS.test(model.name) && { think: false }),
      },
      request.signal,
    );
    if (!response.ok) {
      throw mapError(response.status, await errorOf(response), this.#label(request.model));
    }
    const body = validate(Reply, await text(response, 'Ollama'), 'Ollama');
    if (body.error) throw mapError(200, body.error, this.#label(request.model));
    const usage = usageOf(body);
    return { text: body.message?.content ?? '', ...(usage && { usage }) };
  }

  /** Nothing to meter: it runs here. */
  async usage(): Promise<EngineUsage> {
    return {
      kind: 'unknown',
      source: LOCAL_LABEL,
      windows: [],
      message: 'This model runs on your computer: there’s nothing to pay and no limit.',
    };
  }
}

function safeObject(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The local provider, ready for `services.ts`. */
export function ollamaVariant(link: OllamaLink, deps: { home?: string } = {}): ApiVariant {
  return {
    id: 'ollama',
    label: LOCAL_LABEL,
    docsUrl: 'https://docs.ollama.com',
    keyUrl: 'https://ollama.com/download',
    canSignIn: false,
    keyless: true,
    local: true,
    where:
      'You are a model running on this computer, through Ollama: private, and it works without the internet.',
    status: () => link.engineStatus(),
    wire: new OllamaWire(link),
    home: deps.home ?? defaultHome(),
  };
}
