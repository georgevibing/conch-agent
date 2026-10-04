/**
 * The Anthropic API, spoken directly.
 *
 * Details that are easy to get wrong, verified against the live API:
 *  - every SSE line carries both `event:` and `data:`, and there is no `[DONE]`
 *    sentinel — the stream simply ends after `message_stop`;
 *  - `thinking: {type:'enabled', budget_tokens}` is rejected with a 400 on
 *    current models. The shape now is `thinking: {type:'adaptive'}` with
 *    `output_config: {effort}`, and only where the model says it takes them;
 *  - a non-default `temperature`, `top_p` or `top_k` is a 400 on current models,
 *    so none is ever sent;
 *  - assistant content blocks are replayed **verbatim**: the signature on a
 *    thinking block is verified, and filtering on `type === 'thinking'` would
 *    silently drop `redacted_thinking` and break the protocol;
 *  - the context window is `max_input_tokens` — there is no `context_window`;
 *  - `message_start.usage` has the final input count and a stub output of 1;
 *    the real output count is the last `message_delta.usage`, which is cumulative.
 */
import { z } from 'zod';

import type { Completion, Picture } from '../types';
import { tooLong, windowIn } from './context';
import { refusesImages } from './pictures';
import { refusalError, toolRefusal } from './refusals';
import type { SchemaFamily } from './schemas';
import { sseEvents } from './sse';
import { defaultHome } from './session';
import {
  ApiError,
  TOO_LONG,
  type ApiDeps,
  type ApiVariant,
  type FetchLike,
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
import {
  contextLabel,
  frame,
  knownEfforts,
  pickSmallModel,
  retryAfterMs,
  scrub,
  send,
  text,
  validate,
  type ToolResult,
  type Wire,
} from './wire';

const BASE = 'https://api.anthropic.com';
const VERSION = '2023-06-01';
const LABEL = 'Anthropic API';
/** Enough for a long answer with thinking, without asking for the model's whole ceiling. */
const TURN_MAX_TOKENS = 16_384;
/** One page holds every model Anthropic offers today; the loop is for when it doesn't. */
const MAX_PAGES = 5;

// ── Wire schemas ────────────────────────────────────────────────────────────

const ErrorBody = z.object({
  error: z.object({ type: z.string().nullish(), message: z.string().nullish() }),
});
type AnthropicError = z.infer<typeof ErrorBody>['error'];

const ModelEntry = z.object({
  id: z.string(),
  display_name: z.string().nullish(),
  created_at: z.string().nullish(),
  /** The context window. */
  max_input_tokens: z.number().nullish(),
  max_tokens: z.number().nullish(),
  capabilities: z
    .object({
      thinking: z.object({ types: z.record(z.string(), z.unknown()).nullish() }).nullish(),
      effort: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
});

const ModelsPage = z.object({
  data: z.array(ModelEntry),
  has_more: z.boolean().nullish(),
  last_id: z.string().nullish(),
});

const UsageBlock = z.object({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
});

const Frame = z.object({ type: z.string() });
const MessageStart = z.object({ message: z.object({ usage: UsageBlock.nullish() }).nullish() });
const BlockStart = z.object({
  index: z.number(),
  content_block: z.record(z.string(), z.unknown()),
});
const BlockDelta = z.object({ index: z.number(), delta: z.record(z.string(), z.unknown()) });
const MessageDelta = z.object({
  delta: z.object({ stop_reason: z.string().nullish() }).nullish(),
  usage: UsageBlock.nullish(),
});

const MessageBody = z.object({
  type: z.string().nullish(),
  content: z.array(z.object({ type: z.string().nullish(), text: z.string().nullish() })).nullish(),
  usage: UsageBlock.nullish(),
  error: ErrorBody.shape.error.nullish(),
});

// ── Errors ──────────────────────────────────────────────────────────────────

/** Branch on `error.type`, never on the message text — messages get reworded. */
export function mapError(
  status: number,
  error: AnthropicError | undefined,
  retryAfter: number | undefined,
  key?: string,
): ApiError {
  const type = error?.type ?? '';
  const detail = error?.message ? scrub(error.message, key) : '';
  if (type === 'authentication_error' || status === 401) {
    return new ApiError('auth', `${LABEL} refused your key. Add a new one in Settings.`);
  }
  if (type === 'permission_error' || status === 403) {
    return new ApiError('auth', 'This key isn’t allowed to use that model.');
  }
  if (type === 'not_found_error' || status === 404) {
    return new ApiError('not-found', 'Anthropic doesn’t offer that model to this key.');
  }
  if (type === 'request_too_large' || status === 413) {
    return new ApiError('context', 'That request is larger than Anthropic accepts.');
  }
  if (type === 'rate_limit_error' || status === 429) {
    // A tier spend-cap 429 sends no `retry-after` and will never succeed on a
    // retry, so waiting is only worth it when Anthropic asked us to.
    return retryAfter === undefined
      ? new ApiError(
          'payment',
          'Anthropic has paused this key — it has hit a rate or spending limit on your account.',
        )
      : new ApiError('rate-limit', 'Anthropic is rate-limiting this key.', {
          retryable: true,
          retryAfterMs: retryAfter,
        });
  }
  if (type === 'overloaded_error' || type === 'api_error' || status === 500 || status === 503) {
    return new ApiError('overloaded', 'Anthropic is overloaded right now.', {
      retryable: true,
      ...(retryAfter !== undefined && { retryAfterMs: retryAfter }),
    });
  }
  if (status === 504 || type === 'timeout_error') {
    return new ApiError('timeout', 'The model took too long to answer.', { retryable: true });
  }
  if (type === 'invalid_request_error' && refusesImages(detail)) {
    return new ApiError('images', detail || 'This model can’t look at pictures.');
  }
  if (type === 'invalid_request_error' && (tooLong(detail) || /exceed|context/i.test(detail))) {
    const window = windowIn(detail);
    return new ApiError('context', TOO_LONG, { ...(window && { window }) });
  }
  return new ApiError('other', detail || `${LABEL} couldn’t answer that request.`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

// ── Adapter ─────────────────────────────────────────────────────────────────

/** A picture as the Messages API takes it. */
function imageBlock(image: Picture): Record<string, unknown> {
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mimeType, data: image.data },
  };
}

export class AnthropicWire implements Wire {
  readonly source = LABEL;
  #fetch: FetchLike;
  #models = new Map<string, WireModel>();

  constructor(fetchImpl: FetchLike) {
    this.#fetch = fetchImpl;
  }

  /**
   * `Authorization: Bearer` is the documented primary scheme now; `x-api-key`
   * is a legacy fallback and there's no reason to send both.
   */
  #headers(key: string): Record<string, string> {
    return {
      authorization: `Bearer ${key}`,
      'anthropic-version': VERSION,
      'content-type': 'application/json',
    };
  }

  async #fail(response: Response, key?: string, tools = false): Promise<ApiError> {
    const body = await text(response, LABEL).catch(() => '');
    const parsed = ErrorBody.safeParse(safeJson(body));
    // A tool's schema it won't read: the engine simplifies it and asks again (ADR 0072).
    if (
      tools &&
      response.status === 400 &&
      parsed.success &&
      toolRefusal(parsed.data.error.message ?? '') === 'schema'
    )
      return refusalError('schema', LABEL);
    return mapError(
      response.status,
      parsed.success ? parsed.data.error : undefined,
      retryAfterMs(response.headers),
      key,
    );
  }

  /** Listing models spends no tokens, so it's the cheapest honest key check. */
  async check({ key, signal }: { key: string; signal?: AbortSignal }): Promise<WireAccount> {
    await this.#page(key, undefined, 1, signal);
    return { description: 'Anthropic API key' };
  }

  async #page(key: string, after: string | undefined, limit: number, signal?: AbortSignal) {
    const url = new URL(`${BASE}/v1/models`);
    url.searchParams.set('limit', String(limit));
    if (after) url.searchParams.set('after_id', after);
    const response = await send({
      fetchImpl: this.#fetch,
      url: url.toString(),
      method: 'GET',
      headers: this.#headers(key),
      label: LABEL,
      key,
      ...(signal && { signal }),
    });
    if (!response.ok) throw await this.#fail(response, key);
    return validate(ModelsPage, await text(response, LABEL), LABEL);
  }

  async models({ key, signal }: { key?: string; signal?: AbortSignal }): Promise<WireModel[]> {
    // Anthropic has no public catalogue: without a key there is nothing to list,
    // and inventing model names is worse than an empty picker.
    if (!key) return [];
    const entries: z.infer<typeof ModelEntry>[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.#page(key, after, 1000, signal);
      entries.push(...result.data);
      if (!result.has_more || !result.last_id) break;
      after = result.last_id;
    }
    const models = entries
      .map((entry) => this.#model(entry))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .map(({ createdAt: _createdAt, ...model }) => model);
    this.#models = new Map(models.map((m) => [m.info.id, m]));
    return models;
  }

  #model(entry: z.infer<typeof ModelEntry>): WireModel & { createdAt?: number } {
    const thinking = entry.capabilities?.thinking?.types;
    const created = entry.created_at ? Date.parse(entry.created_at) : Number.NaN;
    return {
      info: {
        id: entry.id,
        label: entry.display_name?.trim() || entry.id,
        description: contextLabel(entry.max_input_tokens) ?? '',
        ...(entry.max_input_tokens ? { context: entry.max_input_tokens } : {}),
        efforts: knownEfforts(Object.keys(entry.capabilities?.effort ?? {})),
        supportsFastMode: false,
        supportsAutoMode: false,
        // Every Claude model on the Messages API looks at pictures.
        images: true,
      },
      // Every Claude model on the Messages API can call tools.
      tools: true,
      thinking: Boolean(thinking && 'adaptive' in thinking),
      ...(entry.max_tokens && { maxOutputTokens: entry.max_tokens }),
      ...(Number.isFinite(created) && { createdAt: created }),
    };
  }

  smallModel(): string | undefined {
    return pickSmallModel([...this.#models.keys()]);
  }

  /** Every Claude model sees (ADR 0070). */
  seesFor(): boolean {
    return true;
  }

  /** JSON Schema, with one object at the root (ADR 0072). */
  schemaFamily(): SchemaFamily {
    return 'anthropic';
  }

  userMessage(content: string, images?: readonly Picture[]): WireMessage {
    if (!images?.length) return { role: 'user', content };
    return { role: 'user', content: [...images.map(imageBlock), { type: 'text', text: content }] };
  }

  /**
   * Every result for one assistant turn goes back in a single user message. A
   * tool's pictures go inside its own `tool_result`, after its text.
   */
  toolResults(results: ToolResult[]): WireMessage[] {
    if (!results.length) return [];
    return [
      {
        role: 'user',
        content: results.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.id,
          content: result.images?.length
            ? [{ type: 'text', text: result.text }, ...result.images.map(imageBlock)]
            : result.text,
          ...(result.isError && { is_error: true }),
        })),
      },
    ];
  }

  #body(request: WireRequest): Record<string, unknown> {
    const model = this.#models.get(request.model);
    const maxTokens = Math.min(model?.maxOutputTokens ?? TURN_MAX_TOKENS, TURN_MAX_TOKENS);
    const effort = request.effort;
    const wantsEffort = effort !== 'auto' && (model?.info.efforts ?? []).includes(effort);
    return {
      model: request.model,
      max_tokens: maxTokens,
      system: request.system,
      messages: request.messages,
      ...(request.tools.length && {
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.schema,
        })),
      }),
      // Forced tool choice 400s on several current models, so the default
      // (`auto`) is the only one Conch uses.
      ...(wantsEffort && model?.thinking && { thinking: { type: 'adaptive' } }),
      ...(wantsEffort && { output_config: { effort } }),
    };
  }

  async *stream(request: WireRequest): AsyncIterable<WireEvent> {
    const response = await send({
      fetchImpl: this.#fetch,
      url: `${BASE}/v1/messages`,
      method: 'POST',
      headers: this.#headers(request.key),
      body: { ...this.#body(request), stream: true },
      label: LABEL,
      key: request.key,
      signal: request.signal,
    });
    if (!response.ok) throw await this.#fail(response, request.key, request.tools.length > 0);
    if (!response.body) throw new ApiError('network', `${LABEL} sent an empty reply.`);

    /** Blocks in the order the model sent them, kept whole for replay. */
    const blocks = new Map<number, { block: Record<string, unknown>; json: string }>();
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | undefined;

    for await (const event of sseEvents(response.body, request.signal)) {
      const kind = frame(Frame, event.data)?.type;
      if (!kind || kind === 'ping') continue;
      if (kind === 'error') {
        const parsed = frame(ErrorBody, event.data);
        throw mapError(0, parsed?.error, undefined, request.key);
      }
      if (kind === 'message_start') {
        const usage = frame(MessageStart, event.data)?.message?.usage;
        // Cache reads and writes are input the model saw; Conch prices spend
        // elsewhere, so what matters here is an honest token count.
        inputTokens =
          (usage?.input_tokens ?? 0) +
          (usage?.cache_creation_input_tokens ?? 0) +
          (usage?.cache_read_input_tokens ?? 0);
        cachedInputTokens = usage?.cache_read_input_tokens ?? 0;
        continue;
      }
      if (kind === 'content_block_start') {
        const start = frame(BlockStart, event.data);
        if (start) blocks.set(start.index, { block: { ...start.content_block }, json: '' });
        continue;
      }
      if (kind === 'content_block_delta') {
        const part = frame(BlockDelta, event.data);
        if (!part) continue;
        const entry = blocks.get(part.index);
        if (!entry) continue;
        const delta = part.delta;
        const type = delta['type'];
        if (type === 'text_delta' && typeof delta['text'] === 'string') {
          entry.block['text'] = `${entry.block['text'] ?? ''}${delta['text']}`;
          yield { type: 'text', delta: delta['text'] };
        } else if (type === 'thinking_delta' && typeof delta['thinking'] === 'string') {
          entry.block['thinking'] = `${entry.block['thinking'] ?? ''}${delta['thinking']}`;
          yield { type: 'thinking', delta: delta['thinking'] };
        } else if (type === 'signature_delta' && typeof delta['signature'] === 'string') {
          entry.block['signature'] = `${entry.block['signature'] ?? ''}${delta['signature']}`;
        } else if (type === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
          entry.json += delta['partial_json'];
        }
        continue;
      }
      if (kind === 'content_block_stop') {
        const stop = frame(BlockDelta.pick({ index: true }), event.data);
        const entry = stop ? blocks.get(stop.index) : undefined;
        if (entry && entry.block['type'] === 'tool_use') {
          // The arguments are replayed as an object. Bad JSON becomes an empty
          // one here and a tool error above — never a thrown turn.
          const parsed = entry.json ? safeJson(entry.json) : {};
          entry.block['input'] = isRecord(parsed) ? parsed : {};
        }
        continue;
      }
      if (kind === 'message_delta') {
        const part = frame(MessageDelta, event.data);
        if (part?.delta?.stop_reason) stopReason = part.delta.stop_reason;
        // Cumulative, so the last one wins.
        if (typeof part?.usage?.output_tokens === 'number') outputTokens = part.usage.output_tokens;
        continue;
      }
      if (kind === 'message_stop') break;
    }

    const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry);
    const toolCalls: WireToolCall[] = ordered
      .filter((entry) => entry.block['type'] === 'tool_use')
      .map((entry) => ({
        id: String(entry.block['id'] ?? ''),
        name: String(entry.block['name'] ?? ''),
        argumentsJson: entry.json,
      }))
      .filter((call) => call.id && call.name);
    const usage: WireUsage = {
      inputTokens: Math.max(0, Math.round(inputTokens)),
      ...(cachedInputTokens > 0 && { cachedInputTokens: Math.round(cachedInputTokens) }),
      outputTokens: Math.max(0, Math.round(outputTokens)),
    };
    const stop: WireStop =
      stopReason === 'tool_use' || toolCalls.length
        ? 'tools'
        : stopReason === 'max_tokens'
          ? 'length'
          : 'end';
    // Every block goes back exactly as it came, `redacted_thinking` included.
    const message: WireMessage = { role: 'assistant', content: ordered.map((e) => e.block) };
    yield { type: 'end', message, toolCalls, stop, usage };
  }

  async complete(request: WireCompletion): Promise<Completion> {
    const response = await send({
      fetchImpl: this.#fetch,
      url: `${BASE}/v1/messages`,
      method: 'POST',
      headers: this.#headers(request.key),
      body: {
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [this.userMessage(request.prompt, request.images)],
      },
      label: LABEL,
      key: request.key,
      signal: request.signal,
    });
    if (!response.ok) throw await this.#fail(response, request.key);
    const body = validate(MessageBody, await text(response, LABEL), LABEL);
    if (body.error || body.type === 'error') {
      throw mapError(0, body.error ?? undefined, undefined, request.key);
    }
    return {
      text: (body.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
      ...(body.usage && {
        usage: {
          inputTokens: Math.max(0, Math.round(body.usage.input_tokens ?? 0)),
          outputTokens: Math.max(0, Math.round(body.usage.output_tokens ?? 0)),
        },
      }),
    };
  }

  // No `usage`: Anthropic publishes no limit or balance to read, so Conch tracks
  // spend itself rather than showing a number it made up.
}

/** The Anthropic API provider, ready for `services.ts`. */
export function anthropicApiVariant(deps: ApiDeps = {}): ApiVariant {
  return {
    id: 'anthropic-api',
    label: LABEL,
    docsUrl: 'https://docs.anthropic.com/en/api/overview',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    // There's no way to mint a Console key from here: it's paste-only.
    canSignIn: false,
    wire: new AnthropicWire(deps.fetch ?? globalThis.fetch),
    home: deps.home ?? defaultHome(),
  };
}
