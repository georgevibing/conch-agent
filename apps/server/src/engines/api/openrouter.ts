/**
 * OpenRouter — one key, every lab's models, OpenAI-compatible.
 *
 * Details that are easy to get wrong, verified against the live API:
 *  - keep-alive comment lines (`: OPENROUTER PROCESSING`) arrive mid-stream and
 *    crash a naive parser (handled in `sse.ts`);
 *  - usage is always included and arrives as the *penultimate* chunk, repeating
 *    `finish_reason` on a content-free delta — so "the first end wins" would
 *    count the turn twice. A chunk carrying `usage` is treated as accounting only;
 *  - a failure after a 200 arrives as an ordinary data frame with a top-level
 *    `error`, and even a non-streaming 200 body may hold only an error;
 *  - `tools` must be sent on every request in the loop, including the one that
 *    carries the tool results;
 *  - streamed tool calls only guarantee `index`: name and id come once, and the
 *    arguments arrive as JSON fragments to be stitched together.
 */
import { severityFor } from '@conch/protocol';
import { z } from 'zod';

import type { Completion, EngineUsage, TurnImage } from '../types';
import {
  ChatCompletion,
  chatToolResults,
  chatTools,
  chatUserMessage,
  completionText,
  errorIn,
  readChatStream,
  usageFrom,
  type ChatError,
} from './chat';
import {
  ApiError,
  type ApiDeps,
  type ApiVariant,
  type FetchLike,
  type WireAccount,
  type WireCompletion,
  type WireEvent,
  type WireMessage,
  type WireModel,
  type WireRequest,
} from './types';
import { defaultHome } from './session';
import {
  contextLabel,
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

const BASE = 'https://openrouter.ai/api/v1';
const LABEL = 'OpenRouter';

// ── Wire schemas (the wire is untrusted; nothing is read before Zod agrees) ──

const KeyInfo = z.object({
  data: z.object({
    label: z.string().nullish(),
    /** Spending cap on this key in credits (1 credit = 1 USD), if one is set. */
    limit: z.number().nullish(),
    limit_remaining: z.number().nullish(),
    usage: z.number().nullish(),
    is_free_tier: z.boolean().nullish(),
    free_model_daily_requests: z
      .object({
        used: z.number(),
        limit: z.number(),
        remaining: z.number().nullish(),
      })
      .nullish(),
  }),
});

const ModelEntry = z.object({
  id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  context_length: z.number().nullish(),
  /** USD per token, as strings. */
  pricing: z.object({ prompt: z.string().nullish(), completion: z.string().nullish() }).nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  architecture: z.object({ input_modalities: z.array(z.string()).nullish() }).nullish(),
  reasoning: z
    .object({
      mandatory: z.boolean().nullish(),
      supported_efforts: z.array(z.string()).nullish(),
      default_effort: z.string().nullish(),
    })
    .nullish(),
});

const ModelList = z.object({ data: z.array(ModelEntry) });

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * One plain sentence per failure, branching on `metadata.error_type` (the
 * canonical enum — far more reliable than the status) rather than the HTTP
 * status, and on `metadata.limit_source` for which budget ran out. The
 * provider's own message is only passed through where it's the only clue, and
 * always scrubbed.
 */
export function mapError(
  status: number,
  error: ChatError | undefined,
  retryAfter: number | undefined,
  key?: string,
): ApiError {
  const type = error?.metadata?.error_type ?? '';
  const source = error?.metadata?.limit_source ?? '';
  const detail = error?.message ? scrub(error.message, key) : '';
  if (type === 'authentication' || status === 401 || status === 403) {
    return new ApiError('auth', `${LABEL} refused your key. Add a new one in Settings.`);
  }
  if (type === 'payment_required' || status === 402) {
    if (source === 'openrouter_in_flight_budget') {
      return new ApiError('rate-limit', 'Too many requests in flight at OpenRouter.', {
        retryable: true,
        retryAfterMs: retryAfter ?? 4000,
      });
    }
    if (source === 'openrouter_key_limit') {
      return new ApiError('payment', 'This key has reached its spending limit at OpenRouter.');
    }
    return new ApiError('payment', 'Your OpenRouter credits have run out. Top up to keep going.');
  }
  if (type === 'rate_limit_exceeded' || status === 429) {
    // Without a hint there is nothing to wait for, so retrying is guesswork.
    return new ApiError('rate-limit', 'OpenRouter is rate-limiting this key.', {
      retryable: retryAfter !== undefined,
      ...(retryAfter !== undefined && { retryAfterMs: retryAfter }),
    });
  }
  if (type === 'provider_overloaded' || status === 502 || status === 503) {
    return new ApiError('overloaded', 'The model’s provider is overloaded right now.', {
      retryable: true,
      ...(retryAfter !== undefined && { retryAfterMs: retryAfter }),
    });
  }
  if (type === 'context_length_exceeded') {
    return new ApiError(
      'context',
      'This conversation is longer than the model can read. Start a new chat, or pick a model with a bigger context.',
    );
  }
  if (type === 'content_policy_violation') {
    return new ApiError(
      'policy',
      'The model’s provider refused this request under its content policy.',
    );
  }
  if (type === 'timeout' || status === 504) {
    return new ApiError('timeout', 'The model took too long to answer.', { retryable: true });
  }
  if (status === 404) {
    return new ApiError('not-found', 'That model isn’t available on OpenRouter any more.');
  }
  return new ApiError('other', detail || `${LABEL} couldn’t answer that request.`);
}

// ── Adapter ─────────────────────────────────────────────────────────────────

/** Per-million-token price, from OpenRouter's per-token strings. */
function price(perToken: string | null | undefined): number | undefined {
  const n = Number(perToken);
  return Number.isFinite(n) ? n * 1_000_000 : undefined;
}

function money(usd: number): string {
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`;
}

export class OpenRouterWire implements Wire {
  readonly source = LABEL;
  #fetch: FetchLike;
  /** What the last model list said, so a turn only sends options the model takes. */
  #models = new Map<string, WireModel>();

  constructor(fetchImpl: FetchLike) {
    this.#fetch = fetchImpl;
  }

  /**
   * Attribution headers. `X-OpenRouter-App-Visibility: hidden` keeps a
   * self-hosted install out of OpenRouter's public rankings. `HTTP-Referer` is
   * deliberately omitted: it identifies a public app URL, a self-hosted Conch
   * has none, and sending something untrue (a GitHub page, `http://localhost`)
   * would be worse than sending nothing.
   */
  #headers(key: string): Record<string, string> {
    return {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'x-openrouter-title': 'Conch',
      'x-openrouter-app-visibility': 'hidden',
    };
  }

  async #fail(response: Response, key?: string): Promise<ApiError> {
    const body = await text(response, LABEL).catch(() => '');
    return mapError(response.status, errorIn(body), retryAfterMs(response.headers), key);
  }

  /** A failure inside a 200: OpenRouter puts the status it means in `code`. */
  #failIn(error: ChatError, key: string): ApiError {
    return mapError(typeof error.code === 'number' ? error.code : 0, error, undefined, key);
  }

  /**
   * `GET /key` both proves the key works and says what's left on it. (The
   * `/credits` endpoint needs a management key, so Conch never calls it.)
   */
  async check({ key, signal }: { key: string; signal?: AbortSignal }): Promise<WireAccount> {
    const info = await this.#key(key, signal);
    const left =
      typeof info.limit_remaining === 'number'
        ? `${money(info.limit_remaining)} left`
        : (info.label ?? '').trim().slice(0, 60);
    return { description: left ? `${LABEL} · ${left}` : `${LABEL} key` };
  }

  async #key(key: string, signal?: AbortSignal) {
    const response = await send({
      fetchImpl: this.#fetch,
      url: `${BASE}/key`,
      method: 'GET',
      headers: this.#headers(key),
      label: LABEL,
      key,
      ...(signal && { signal }),
    });
    if (!response.ok) throw await this.#fail(response, key);
    return validate(KeyInfo, await text(response, LABEL), LABEL).data;
  }

  /**
   * `/models/user` honours the account's own privacy, provider and guardrail
   * settings, so it's the list the user can actually reach. Without a key (or if
   * it fails) the public catalogue is still better than nothing.
   */
  async models({ key, signal }: { key?: string; signal?: AbortSignal }): Promise<WireModel[]> {
    const read = async (url: string, withKey: boolean) => {
      const response = await send({
        fetchImpl: this.#fetch,
        url,
        method: 'GET',
        headers: withKey && key ? this.#headers(key) : { 'content-type': 'application/json' },
        label: LABEL,
        ...(key && { key }),
        ...(signal && { signal }),
      });
      if (!response.ok) throw await this.#fail(response, key);
      return validate(ModelList, await text(response, LABEL), LABEL).data;
    };
    let entries: z.infer<typeof ModelEntry>[];
    if (key) {
      entries = await read(`${BASE}/models/user`, true).catch(() => read(`${BASE}/models`, false));
    } else {
      entries = await read(`${BASE}/models`, false);
    }

    const all = entries.map((entry) => this.#model(entry));
    // An engine that can't call tools can't use integrations or memory, so the
    // picker only offers models that can — unless that would leave it empty, in
    // which case saying so beats showing nothing.
    const capable = all.filter((m) => m.tools);
    const models = capable.length ? capable : all;
    this.#models = new Map(models.map((m) => [m.info.id, m]));
    return models;
  }

  #model(entry: z.infer<typeof ModelEntry>): WireModel {
    const supported = entry.supported_parameters ?? [];
    const tools = supported.includes('tools');
    const input = price(entry.pricing?.prompt);
    const output = price(entry.pricing?.completion);
    const cost =
      input !== undefined && output !== undefined
        ? input === 0 && output === 0
          ? 'free'
          : `${money(input)}/${money(output)} per million tokens`
        : undefined;
    return {
      info: {
        id: entry.id,
        label: entry.name?.trim() || entry.id,
        // Chat only is the picker's badge (ADR 0050), not words here.
        description: [contextLabel(entry.context_length), cost].filter(Boolean).join(' · '),
        // Only the levels OpenRouter enumerated for this model: guessing here
        // would offer a choice the provider rejects.
        efforts: knownEfforts(entry.reasoning?.supported_efforts ?? undefined),
        supportsFastMode: false,
        supportsAutoMode: false,
        // Only when OpenRouter says: a model it lists without modalities isn't assumed blind.
        ...(entry.architecture?.input_modalities && {
          images: entry.architecture.input_modalities.includes('image'),
        }),
      },
      tools,
      thinking: Boolean(entry.reasoning),
    };
  }

  smallModel(): string | undefined {
    return pickSmallModel([...this.#models.keys()]);
  }

  userMessage(content: string, images?: readonly TurnImage[]): WireMessage {
    return chatUserMessage(content, images);
  }

  toolResults(results: ToolResult[]): WireMessage[] {
    return chatToolResults(results);
  }

  #body(request: WireRequest): Record<string, unknown> {
    const model = this.#models.get(request.model);
    const efforts = model?.info.efforts ?? [];
    return {
      model: request.model,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      ...chatTools(request.tools),
      // Only ask for reasoning where the model said which levels it takes.
      ...(request.effort !== 'auto' &&
        efforts.includes(request.effort) && { reasoning: { effort: request.effort } }),
    };
  }

  async *stream(request: WireRequest): AsyncIterable<WireEvent> {
    const response = await send({
      fetchImpl: this.#fetch,
      url: `${BASE}/chat/completions`,
      method: 'POST',
      headers: this.#headers(request.key),
      body: { ...this.#body(request), stream: true },
      label: LABEL,
      key: request.key,
      signal: request.signal,
    });
    if (!response.ok) throw await this.#fail(response, request.key);
    if (!response.body) throw new ApiError('network', `${LABEL} sent an empty reply.`);
    // Usage is always included: it arrives as the penultimate frame, repeating
    // `finish_reason` on an empty delta, and the shared reader counts it once.
    yield* readChatStream(response.body, request.signal, {
      label: LABEL,
      fail: (error) => this.#failIn(error, request.key),
    });
  }

  async complete(request: WireCompletion): Promise<Completion> {
    const response = await send({
      fetchImpl: this.#fetch,
      url: `${BASE}/chat/completions`,
      method: 'POST',
      headers: this.#headers(request.key),
      body: {
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
        max_tokens: request.maxTokens,
      },
      label: LABEL,
      key: request.key,
      signal: request.signal,
    });
    if (!response.ok) throw await this.#fail(response, request.key);
    const body = validate(ChatCompletion, await text(response, LABEL), LABEL);
    // Even a 200 can carry nothing but an error.
    if (body.error) throw this.#failIn(body.error, request.key);
    return { text: completionText(body), ...(body.usage && { usage: usageFrom(body.usage) }) };
  }

  /**
   * OpenRouter is pay-as-you-go, so there's no plan window to show. What it does
   * publish is spend against this key's own limit, plus the free-model daily
   * allowance where one applies — both honest, both useful.
   */
  async usage({ key, signal }: { key: string; signal?: AbortSignal }): Promise<EngineUsage> {
    const info = await this.#key(key, signal);
    const free = info.free_model_daily_requests;
    const windows =
      free && free.limit > 0
        ? [
            {
              id: 'free-daily',
              label: 'Free models today',
              usedPercent: Math.min(100, Math.max(0, (free.used / free.limit) * 100)),
              severity: severityFor(Math.min(100, (free.used / free.limit) * 100)),
            },
          ]
        : [];
    return {
      kind: 'metered',
      source: LABEL,
      windows,
      ...(typeof info.limit === 'number' && {
        extra: {
          enabled: true,
          used: Math.max(0, info.usage ?? 0),
          limit: Math.max(0, info.limit),
          currency: 'USD',
        },
      }),
      ...(typeof info.limit !== 'number' && {
        message: 'This key has no spending limit set at OpenRouter.',
      }),
    };
  }
}

/** The OpenRouter provider, ready for `services.ts`. */
export function openrouterVariant(deps: ApiDeps = {}): ApiVariant {
  return {
    id: 'openrouter',
    label: LABEL,
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/settings/keys',
    // OpenRouter can mint a key when you sign in, so Conch offers that.
    canSignIn: true,
    wire: new OpenRouterWire(deps.fetch ?? globalThis.fetch),
    home: deps.home ?? defaultHome(),
  };
}
