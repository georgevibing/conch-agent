/**
 * Every model API that speaks OpenAI's chat shape, from one adapter (ADR 0053).
 *
 * OpenAI itself, Gemini's compatibility endpoint, xAI, DeepSeek, Mistral,
 * Groq, Cerebras, Z.ai, Kimi, MiniMax, Qwen, Ollama's cloud and any server you
 * run yourself differ in the edges, not the middle. Each is a `ChatPreset` —
 * words, addresses and a few rules — and this wire does the rest:
 *
 *  - **Addresses.** A company with regions (Kimi, Z.ai, MiniMax, Qwen) gets
 *    each of its own addresses tried in turn when a key is checked; the one
 *    that takes it is remembered. A key is only ever sent to its own company.
 *  - **Models.** Whatever the list says — a name, the context, tools, pictures,
 *    thinking — is read from any of the fields providers use for it. Models
 *    that can't chat (embeddings, speech, images) are left out, dated copies
 *    of a model that's listed by name are folded into it, and the newest come
 *    first. Conch never invents a model name.
 *  - **Healing.** A model that turns out not to take tools, or not to take a
 *    thinking level, is asked again without, once, and remembered.
 *  - **Errors.** A refused key is a 400 at xAI and Gemini and a 403 at NVIDIA;
 *    spent credit is a 429 at OpenAI, Kimi and Z.ai and a 403 at Alibaba. Each
 *    failure is read by its status *and* its code, so "top up" is never
 *    retried and "slow down" is.
 */
import type { EffortChoice } from '@conch/protocol';
import type { Completion } from '../types';
import {
  bridgeToolToUser,
  chatToolResults,
  chatTools,
  chatUserMessage,
  errorIn,
  errorKind,
  readChatStream,
  type ChatError,
} from './chat';
import { tooLong, windowIn } from './context';
import { refusesImages } from './pictures';
import {
  ApiError,
  TOO_LONG,
  type FetchLike,
  type WireAccount,
  type WireCompletion,
  type WireEvent,
  type WireMessage,
  type WireModel,
  type WireRequest,
} from './types';
import {
  contextLabel,
  knownEfforts,
  retryAfterMs,
  scrub,
  send,
  text,
  type Effort,
  type ToolResult,
  type Wire,
} from './wire';

/** One address a provider answers on, and what to call it when there are several. */
export interface Endpoint {
  id: string;
  /** Everything before `/chat/completions`, no trailing slash. */
  base: string;
  /** "International", "China": said on the card when a company has more than one. */
  label?: string;
}

/** What a model list said about one model, read from whichever field held it. */
export interface ModelFacts {
  id: string;
  name?: string;
  context?: number;
  tools?: boolean;
  images?: boolean;
  thinking?: boolean;
  efforts?: string[];
  created?: number;
  /** False when the list says it isn't a chat model. */
  chat?: boolean;
  /** Retired, or on its way out. */
  retired?: boolean;
  /** Other ids the list says are this same model (`mistral-large-latest`). */
  aliases?: string[];
}

/** Everything that differs about one provider. */
export interface ChatPreset {
  /** The provider's id, for errors and transcripts. */
  id: string;
  /** "OpenAI", "Kimi": the name in every sentence. */
  label: string;
  /** Tried in order when a key is checked; the first that takes it is kept. */
  endpoints: readonly Endpoint[];
  /** Headers besides `Authorization`. */
  headers?: Readonly<Record<string, string>>;
  /** Where the model list is, after the base. */
  modelsPath?: string;
  /**
   * The provider's own list, when it isn't `GET {base}/models` or says more
   * elsewhere (Gemini's native list, Ollama's tags). Returns raw entries.
   */
  listModels?(context: ListContext): Promise<unknown[]>;
  /** A list anyone can read proves nothing about a key: this does. */
  checkPath?: string;
  /** Or, for a provider whose proof isn't one `GET` under the base: this resolves only for a good key. */
  checkKey?(context: ListContext): Promise<void>;
  /** Provider-specific fields, read before the common ones. */
  facts?(entry: Record<string, unknown>): Partial<ModelFacts>;
  /** Ids that aren't chat models, beyond the common ones. */
  hide?: RegExp;
  /** Families to list first, in this order; the newest first within each. */
  rank?: readonly RegExp[];
  /** A small, cheap model among the listed ones, for naming chats. */
  small?: RegExp;
  /** Models that can't call tools in this API, whatever the list says. */
  noTools?: RegExp;
  /**
   * Whether a model the list says nothing about looks at pictures (ADR 0070):
   * `true` where the provider takes them (a model that can't says so, and
   * Conch heals), a pattern for the ids that do, unset where it never does.
   */
  sees?: boolean | RegExp;
  /** Refuses a user message straight after a tool's (Mistral): a blank assistant turn goes between. */
  toolThenUser?: 'bridge';
  /** Thinking levels a model takes, when the list doesn't say. */
  efforts?(model: ModelFacts): Effort[];
  /** How a thinking level is asked for. Default `reasoning_effort`. */
  effortBody?(effort: Effort, model: ModelFacts | undefined): Record<string, unknown>;
  /** Sent with every chat request (a provider's own switch). */
  extraBody?: Readonly<Record<string, unknown>>;
  /** OpenAI's reasoning models only take `max_completion_tokens`. */
  maxTokens?: 'max_tokens' | 'max_completion_tokens';
  /** Ask for usage in the last frame. Most take it; a few servers choke on it. */
  usageOption?: boolean;
  /** Send thinking back in the tool loop (DeepSeek, Kimi refuse a turn without it). */
  replayReasoning?: 'reasoning_content';
  /** Thinking may arrive inside `<think>` tags in the answer. */
  thinkTags?: boolean;
  /** No key at all, or a key only some servers want. */
  key?: 'required' | 'optional';
  /** Plain http is allowed: a server on this computer or your own network. */
  plainHttp?: boolean;
  /** What a wrong-region key looks like to a person, for companies with regions. */
  regionHint?: string;
  /** A prettier name for a model id, when the list gives none. */
  modelLabel?(id: string): string;
}

/** How one of a preset's own requests is sent. */
export interface ListRequest {
  headers?: Record<string, string>;
  /** Leave out `Authorization: Bearer` (Gemini's native API reads it as an OAuth token). */
  bearer?: boolean;
}

/** What `listModels` and `checkKey` get to work with. */
export interface ListContext {
  base: string;
  key?: string;
  signal?: AbortSignal;
  get(url: string, request?: ListRequest): Promise<unknown>;
  post(url: string, body: unknown, request?: ListRequest): Promise<unknown>;
  /** The status alone, for a check that only needs to know yes or no. */
  status(url: string, request?: ListRequest): Promise<number>;
}

/** Where a provider with several addresses keeps the one that took the key. */
export interface EndpointMemory {
  get(): string | undefined;
  set(id: string): void;
}

/** Things a chat picker should never offer: they embed, speak, listen, draw or moderate. */
const NOT_CHAT =
  /(^|[/_-])(embed|embedding|text-embedding|tts|whisper|transcribe|speech|audio|realtime|dall-e|gpt-image|chatgpt-image|image-gen|imagen|veo|sora|moderation|rerank|guard|safeguard|prompt-guard|orpheus|babbage|davinci|computer-use|live|aqa)([/_.:-]|$)/i;

/** A copy of a model pinned to a date: `gpt-4.1-2025-04-14`, `glm-4.6-0520`, `mistral-large-2411`. */
const DATED = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|\d{4})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown) => (typeof value === 'number' && value > 0 ? value : undefined);
const str = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const bool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;

/** Read the facts every list spells its own way. */
export function readFacts(
  entry: Record<string, unknown>,
  preset?: ChatPreset,
): ModelFacts | undefined {
  const own = preset?.facts?.(entry) ?? {};
  const id = own.id ?? str(entry.id) ?? str(entry.key) ?? str(entry.model) ?? str(entry.name);
  if (!id) return undefined;
  const caps = isRecord(entry.capabilities) ? entry.capabilities : undefined;
  const capList = strings(entry.capabilities);
  const arch = isRecord(entry.architecture) ? entry.architecture : undefined;
  const limits = isRecord(entry.limits) ? entry.limits : undefined;
  const spec = isRecord(entry.model_spec) ? entry.model_spec : undefined;
  const effort = isRecord(entry.effort) ? entry.effort : undefined;
  const modalities =
    strings(entry.input_modalities) ?? strings(arch?.input_modalities) ?? strings(entry.modalities);
  const type = str(entry.type)?.toLowerCase();
  const efforts =
    own.efforts ??
    strings(caps?.reasoning_effort) ??
    strings(effort?.supported_levels) ??
    strings((isRecord(entry.reasoning) ? entry.reasoning : undefined)?.supported_efforts);
  const tools =
    own.tools ??
    bool(caps?.function_calling) ??
    bool(caps?.tools) ??
    bool(caps?.trained_for_tool_use) ??
    bool(entry.supports_tools) ??
    bool(isRecord(spec?.capabilities) ? spec.capabilities.supportsFunctionCalling : undefined) ??
    (capList ? capList.includes('tool_use') || capList.includes('tools') : undefined);
  const images =
    own.images ??
    bool(caps?.vision) ??
    bool(entry.supports_image_in) ??
    (modalities ? modalities.includes('image') : undefined) ??
    (capList ? capList.includes('vision') : undefined) ??
    (type === 'vlm' ? true : undefined);
  const thinking =
    own.thinking ??
    bool(entry.supports_reasoning) ??
    (isRecord(caps?.reasoning) ? true : bool(caps?.reasoning)) ??
    (capList ? capList.includes('thinking') : undefined) ??
    (efforts?.length ? true : undefined);
  const chatType =
    type === undefined
      ? undefined
      : ['chat', 'llm', 'vlm', 'language', 'code', 'text'].includes(type)
        ? true
        : [
              'embedding',
              'embeddings',
              'image',
              'moderation',
              'rerank',
              'audio',
              'tts',
              'stt',
              'transcribe',
            ].includes(type)
          ? false
          : undefined;
  return {
    id,
    name:
      own.name ??
      str(entry.display_name) ??
      str(entry.displayName) ??
      str(entry.name) ??
      str(spec?.name),
    context:
      own.context ??
      num(entry.context_length) ??
      num(entry.context_window) ??
      num(entry.max_context_length) ??
      num(entry.max_model_len) ??
      num(entry.inputTokenLimit) ??
      num(limits?.max_context_length) ??
      num(spec?.availableContextTokens),
    ...(tools !== undefined && { tools }),
    ...(images !== undefined && { images }),
    ...(thinking !== undefined && { thinking }),
    ...(efforts && { efforts }),
    created: own.created ?? num(entry.created),
    chat: own.chat ?? (bool(caps?.completion_chat) === false ? false : undefined) ?? chatType,
    ...(strings(entry.aliases)?.length && { aliases: strings(entry.aliases) }),
    retired:
      own.retired ??
      (bool(entry.archived) === true ||
        bool(entry.deprecated) === true ||
        (typeof entry.shutdown_date === 'string' && Date.parse(entry.shutdown_date) < Date.now())),
  };
}

const UPPER = new Set(['gpt', 'glm', 'oss', 'vl', 'ai', 'r1', 'v3', 'v4', 'xl', 'moe']);
const BRANDS: Record<string, string> = {
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  qwen: 'Qwen',
  qwq: 'QwQ',
  kimi: 'Kimi',
  grok: 'Grok',
  gemini: 'Gemini',
  gemma: 'Gemma',
  mistral: 'Mistral',
  mixtral: 'Mixtral',
  ministral: 'Ministral',
  magistral: 'Magistral',
  codestral: 'Codestral',
  devstral: 'Devstral',
  pixtral: 'Pixtral',
  llama: 'Llama',
  nemotron: 'Nemotron',
  phi: 'Phi',
};

/**
 * A model's id, the way a person would write it: `gpt-5.1-mini` → "GPT-5.1
 * mini", `gemini-2.5-flash` → "Gemini 2.5 Flash", `deepseek-chat` →
 * "DeepSeek Chat". Only when the provider's list gives no name of its own.
 */
export function prettyModel(id: string): string {
  const bare = id
    .replace(/^models\//, '')
    .replace(/^.*\//, '')
    .replace(/:latest$/, '');
  const words = bare.split(/[-_\s]+/).filter(Boolean);
  const out: string[] = [];
  for (const [i, word] of words.entries()) {
    const lower = word.toLowerCase();
    const isVersion = /^v?\d+(\.\d+)*[a-z]?$/i.test(word) || /^\d+(\.\d+)?[bkm]$/i.test(word);
    let shown: string;
    if (BRANDS[lower]) shown = BRANDS[lower];
    else if (UPPER.has(lower)) shown = lower.toUpperCase();
    else if (/^\d+(\.\d+)?[bkm]$/i.test(word)) shown = word.toUpperCase();
    else if (isVersion) shown = word;
    else if (i === 0) shown = lower.charAt(0).toUpperCase() + lower.slice(1);
    else if (
      [
        'mini',
        'nano',
        'pro',
        'flash',
        'lite',
        'turbo',
        'instruct',
        'chat',
        'reasoner',
        'preview',
        'latest',
        'fast',
        'reasoning',
        'coder',
        'max',
        'plus',
        'air',
        'large',
        'medium',
        'small',
        'tiny',
      ].includes(lower)
    )
      shown = /^(mini|nano)$/.test(lower) ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    else shown = word;
    // GPT-5, GLM-4.6: the house style joins a short brand to its version.
    const previous = out.at(-1);
    if (previous && isVersion && /^(GPT|GLM|K)$/.test(previous))
      out[out.length - 1] = `${previous}-${shown}`;
    else out.push(shown);
  }
  return out.join(' ') || id;
}

/** The models worth a picker, newest and most useful first. */
export function pickModels(facts: ModelFacts[], preset: ChatPreset): ModelFacts[] {
  const usable = facts.filter(
    (m) =>
      m.chat !== false &&
      !m.retired &&
      !NOT_CHAT.test(m.id) &&
      !(preset.hide && preset.hide.test(m.id)),
  );
  const ids = new Set(usable.map((m) => m.id));
  // The same model under another name it's listed by: keep the `-latest` one, else the first.
  const named = new Set<string>();
  for (const m of usable)
    if (m.aliases?.some((alias) => ids.has(alias) && alias !== m.id && alias.endsWith('-latest')))
      named.add(m.id);
  // A dated copy of a model that's also listed by name is the same model twice.
  const folded = usable.filter((m) => {
    if (named.has(m.id)) return false;
    const base = m.id.replace(DATED, '');
    return base === m.id || !ids.has(base);
  });
  const rank = (m: ModelFacts) => {
    const at = (preset.rank ?? []).findIndex((pattern) => pattern.test(m.id));
    return at === -1 ? (preset.rank?.length ?? 0) : at;
  };
  return [...folded].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.created ?? 0) - (a.created ?? 0) ||
      versionOf(b.id) - versionOf(a.id) ||
      a.id.length - b.id.length ||
      a.id.localeCompare(b.id),
  );
}

/** The first version number in an id, for newest-first: `gemini-3.1-pro` → 3.1. */
export function versionOf(id: string): number {
  const match = /(\d+(?:\.\d+)?)/.exec(id.replace(/^.*\//, ''));
  return match ? Number(match[1]) : 0;
}

/** The plain sentence for a failure, read by status and code together. */
export function mapChatError(
  status: number,
  error: ChatError | undefined,
  retryAfter: number | undefined,
  preset: Pick<ChatPreset, 'label' | 'regionHint'>,
  key?: string,
): ApiError {
  const label = preset.label;
  const kind = errorKind(error);
  const said = error?.message ? scrub(error.message, key) : '';
  const words = `${kind} ${said}`.toLowerCase();
  if (
    status === 401 ||
    /invalid_api_key|wrong_api_key|authentication|unauthori[sz]ed|invalid_authentication|incorrect_api_key|authorized_error|api_key_invalid|credentials_missing/.test(
      kind,
    ) ||
    ((status === 400 || status === 403) &&
      /api.?key|incorrect api key|token expired|authentication fail|authorization failed|not valid.*key|invalid.*key/.test(
        words,
      ))
  )
    return new ApiError(
      'auth',
      `${label} refused your key${preset.regionHint ? ` ${preset.regionHint}` : ''}. Add a new one in Settings.`,
    );
  if (
    status === 402 ||
    /insufficient.?(balance|quota|credit|fund)|credit_balance|exceeded_current_quota|arrearage|freetieronly|payment|billing|spend.?limit|usage_limit_exceeded|\b1113\b|\b1008\b|balance is empty|prepay/.test(
      words,
    )
  )
    return new ApiError('payment', `Your ${label} credit has run out. Top up to keep going.`);
  if (
    /model_not_found|not_found|\b1211\b|does not exist|unknown model|not found|has reached its end of life/.test(
      words,
    ) ||
    status === 404 ||
    status === 410
  )
    return new ApiError(
      'not-found',
      `That model isn’t available at ${label} any more. Pick another one.`,
    );
  if ([0, 400, 404, 422, 500].includes(status) && refusesImages(words))
    return new ApiError('images', said || `That model at ${label} can’t look at pictures.`);
  if (tooLong(words) || status === 413) {
    const window = windowIn(said);
    return new ApiError('context', TOO_LONG, { ...(window && { window }) });
  }
  if (/content.?policy|content_filter|safety|sensitive/.test(words))
    return new ApiError('policy', `${label} refused this request under its content policy.`);
  if (
    status === 429 ||
    /rate.?limit|too many requests|slow_down|limit_requests|\b1302\b/.test(words)
  )
    return new ApiError('rate-limit', `${label} is rate-limiting this key.`, {
      retryable: retryAfter !== undefined || /overload/.test(words),
      retryAfterMs: retryAfter ?? 4_000,
    });
  if ([500, 502, 503, 529].includes(status) || /overload|capacity|unavailable|\b1305\b/.test(words))
    return new ApiError('overloaded', `${label} is overloaded right now.`, {
      retryable: true,
      ...(retryAfter !== undefined && { retryAfterMs: retryAfter }),
    });
  if (status === 504 || status === 408 || /timeout|timed out/.test(words))
    return new ApiError('timeout', 'The model took too long to answer.', { retryable: true });
  if (status === 403)
    return new ApiError('auth', said || `${label} won’t let this key use that model.`);
  return new ApiError('other', said || `${label} couldn’t answer that request.`);
}

/** A 400 that only means "this model can't do that": tools, or a thinking level. */
function refusalOf(error: ChatError | undefined): 'tools' | 'effort' | undefined {
  const words = `${errorKind(error)} ${error?.message ?? ''}`.toLowerCase();
  if (
    /(tool|function)/.test(words) &&
    /(not support|unsupported|does not|doesn't|cannot|not available|not enabled)/.test(words)
  )
    return 'tools';
  if (
    /(reasoning|thinking|effort)/.test(words) &&
    /(not support|unsupported|invalid|unknown|unrecognized|not allowed)/.test(words)
  )
    return 'effort';
  return undefined;
}

export class OpenAiWire implements Wire {
  readonly source: string;
  #fetch: FetchLike;
  #models = new Map<string, ModelFacts>();
  #noTools = new Set<string>();
  #noEffort = new Set<string>();
  #endpoint?: Endpoint;

  constructor(
    private readonly preset: ChatPreset,
    fetchImpl: FetchLike,
    private readonly memory?: EndpointMemory,
  ) {
    this.source = preset.label;
    this.#fetch = fetchImpl;
  }

  /** The address that took the key — this run's, else the one remembered from before. */
  #known(): Endpoint | undefined {
    if (this.#endpoint) return this.#endpoint;
    const remembered = this.memory?.get();
    return remembered ? this.preset.endpoints.find((e) => e.id === remembered) : undefined;
  }

  /** The address in use: the one that took the key, else the first. */
  get endpoint(): Endpoint {
    return this.#known() ?? (this.preset.endpoints[0] as Endpoint);
  }

  #headers(key: string | undefined): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(key && { authorization: `Bearer ${key}` }),
      ...this.preset.headers,
    };
  }

  #send(
    url: string,
    method: 'GET' | 'POST',
    key: string | undefined,
    body?: unknown,
    signal?: AbortSignal,
    request: ListRequest = {},
  ) {
    return send({
      fetchImpl: this.#fetch,
      url,
      method,
      headers: { ...this.#headers(request.bearer === false ? undefined : key), ...request.headers },
      ...(body !== undefined && { body }),
      label: this.preset.label,
      ...(key && { key }),
      ...(signal && { signal }),
      ...(this.preset.plainHttp && { plain: true }),
    });
  }

  async #fail(response: Response, key?: string): Promise<ApiError> {
    const body = await text(response, this.preset.label).catch(() => '');
    return mapChatError(
      response.status,
      errorIn(body),
      retryAfterMs(response.headers),
      this.preset,
      key,
    );
  }

  async #json(response: Response): Promise<unknown> {
    const body = await text(response, this.preset.label);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new ApiError('other', `${this.preset.label} didn’t send valid JSON.`);
    }
  }

  #context(base: string, key: string | undefined, signal?: AbortSignal): ListContext {
    const read = async (response: Response) => {
      if (!response.ok) throw await this.#fail(response, key);
      return this.#json(response);
    };
    return {
      base,
      ...(key && { key }),
      ...(signal && { signal }),
      get: async (url, request) =>
        read(await this.#send(url, 'GET', key, undefined, signal, request)),
      post: async (url, body, request) =>
        read(await this.#send(url, 'POST', key, body, signal, request)),
      status: async (url, request) => {
        const response = await this.#send(url, 'GET', key, undefined, signal, request);
        void response.body?.cancel().catch(() => undefined);
        return response.status;
      },
    };
  }

  /** The raw list at one address. */
  async #list(
    endpoint: Endpoint,
    key: string | undefined,
    signal?: AbortSignal,
  ): Promise<unknown[]> {
    const context = this.#context(endpoint.base, key, signal);
    if (this.preset.listModels) return this.preset.listModels(context);
    const body = await context.get(`${endpoint.base}${this.preset.modelsPath ?? '/models'}`);
    if (Array.isArray(body)) return body;
    if (isRecord(body)) {
      const list = body.data ?? body.models;
      if (Array.isArray(list)) return list;
    }
    throw new ApiError('other', `${this.preset.label} sent a model list Conch didn’t understand.`);
  }

  /**
   * A key is good where its company's own address accepts it. With several
   * addresses (regions), each is tried in turn — never anyone else's.
   */
  async check({ key, signal }: { key: string; signal?: AbortSignal }): Promise<WireAccount> {
    const known = this.#known();
    const order = [
      ...(known ? [known] : []),
      ...this.preset.endpoints.filter((e) => e.id !== known?.id),
    ];
    let refused: ApiError | undefined;
    for (const endpoint of order) {
      try {
        const context = this.#context(endpoint.base, key, signal);
        if (this.preset.checkKey) await this.preset.checkKey(context);
        else if (this.preset.checkPath)
          await context.get(`${endpoint.base}${this.preset.checkPath}`);
        else this.#remember(endpoint, await this.#list(endpoint, key, signal));
        this.#endpoint = endpoint;
        this.memory?.set(endpoint.id);
        const where =
          this.preset.endpoints.length > 1 && endpoint.label ? ` · ${endpoint.label}` : '';
        return { description: `${this.preset.label}${where}` };
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'auth') {
          refused = error;
          continue;
        }
        throw error;
      }
    }
    throw refused ?? new ApiError('auth', `${this.preset.label} refused your key.`);
  }

  #remember(_endpoint: Endpoint, raw: unknown[]): WireModel[] {
    const facts = raw.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const read = readFacts(entry, this.preset);
      return read ? [read] : [];
    });
    const picked = pickModels(facts, this.preset);
    this.#models = new Map(picked.map((m) => [m.id, m]));
    return picked.map((m) => this.#model(m));
  }

  async models({ key, signal }: { key?: string; signal?: AbortSignal }): Promise<WireModel[]> {
    if (!key && this.preset.key !== 'optional' && this.preset.key !== undefined) return [];
    return this.#remember(this.endpoint, await this.#list(this.endpoint, key, signal));
  }

  #model(m: ModelFacts): WireModel {
    const efforts = knownEfforts(m.efforts ?? this.preset.efforts?.(m));
    const tools = this.#noTools.has(m.id)
      ? false
      : this.preset.noTools?.test(m.id)
        ? false
        : (m.tools ?? true);
    return {
      info: {
        id: m.id,
        label: m.name ?? this.preset.modelLabel?.(m.id) ?? prettyModel(m.id),
        description: contextLabel(m.context) ?? '',
        ...(m.context ? { context: Math.round(m.context) } : {}),
        efforts,
        supportsFastMode: false,
        supportsAutoMode: false,
        images: m.images ?? this.#seesUnlisted(m.id),
      },
      tools,
      thinking: Boolean(m.thinking || efforts.length),
    };
  }

  smallModel(): string | undefined {
    const small = this.preset.small;
    if (!small) return undefined;
    return [...this.#models.values()].find((m) => small.test(m.id) && (m.tools ?? true))?.id;
  }

  toolsFor(model: string): boolean | undefined {
    if (this.#noTools.has(model) || this.preset.noTools?.test(model)) return false;
    const known = this.#models.get(model);
    return known ? (known.tools ?? true) : undefined;
  }

  /** What the list says about a model's sight, else what the provider does (ADR 0070). */
  seesFor(model: string): boolean {
    return this.#models.get(model)?.images ?? this.#seesUnlisted(model);
  }

  #seesUnlisted(model: string): boolean {
    const sees = this.preset.sees;
    return sees instanceof RegExp ? sees.test(model) : sees === true;
  }

  userMessage(content: string, images?: Parameters<typeof chatUserMessage>[1]): WireMessage {
    return chatUserMessage(content, images);
  }

  toolResults(results: ToolResult[]): WireMessage[] {
    return chatToolResults(results);
  }

  #effort(request: Pick<WireRequest, 'model' | 'effort'>): Record<string, unknown> {
    const effort: EffortChoice = request.effort;
    if (effort === 'auto' || this.#noEffort.has(request.model)) return {};
    const model = this.#models.get(request.model);
    const offered = model ? this.#model(model).info.efforts : [];
    if (!offered.includes(effort)) return {};
    return this.preset.effortBody?.(effort, model) ?? { reasoning_effort: effort };
  }

  #body(request: WireRequest, tools: boolean): Record<string, unknown> {
    return {
      model: request.model,
      messages: [
        { role: 'system', content: request.system },
        ...(this.preset.toolThenUser === 'bridge'
          ? bridgeToolToUser(request.messages)
          : request.messages),
      ],
      stream: true,
      ...(this.preset.usageOption !== false && { stream_options: { include_usage: true } }),
      ...(tools ? chatTools(request.tools) : {}),
      ...this.#effort(request),
      ...this.preset.extraBody,
    };
  }

  async #chat(request: WireRequest): Promise<{ response: Response; droppedTools: boolean }> {
    let tools = request.tools.length > 0 && !this.#noTools.has(request.model);
    let droppedTools = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.#send(
        `${this.endpoint.base}/chat/completions`,
        'POST',
        request.key || undefined,
        this.#body(request, tools),
        request.signal,
      );
      if (response.ok) return { response, droppedTools };
      if (response.status === 400 || response.status === 422) {
        const body = await text(response, this.preset.label).catch(() => '');
        const error = errorIn(body);
        const refusal = refusalOf(error);
        if (refusal === 'tools' && tools) {
          this.#noTools.add(request.model);
          tools = false;
          droppedTools = true;
          continue;
        }
        if (
          refusal === 'effort' &&
          !this.#noEffort.has(request.model) &&
          request.effort !== 'auto'
        ) {
          this.#noEffort.add(request.model);
          continue;
        }
        throw mapChatError(response.status, error, undefined, this.preset, request.key);
      }
      throw await this.#fail(response, request.key);
    }
    throw new ApiError('other', `${this.preset.label} refused the request.`);
  }

  async *stream(request: WireRequest): AsyncIterable<WireEvent> {
    const { response, droppedTools } = await this.#chat(request);
    if (droppedTools)
      yield {
        type: 'notice',
        code: 'no-tools',
        message: `${this.#models.get(request.model)?.name ?? request.model} can’t use tools, so it’s answering without your apps and memory.`,
      };
    if (!response.body) throw new ApiError('network', `${this.preset.label} sent an empty reply.`);
    yield* readChatStream(response.body, request.signal, {
      label: this.preset.label,
      fail: (error) =>
        mapChatError(
          typeof error.code === 'number' ? error.code : 0,
          error,
          undefined,
          this.preset,
          request.key,
        ),
      ...(this.preset.replayReasoning && { replayReasoning: this.preset.replayReasoning }),
      ...(this.preset.thinkTags && { thinkTags: true }),
    });
  }

  /**
   * One short answer, read from a stream: some providers only think when
   * streaming (Qwen), and every one of them streams the same way.
   */
  async complete(request: WireCompletion): Promise<Completion> {
    const field = this.preset.maxTokens ?? 'max_tokens';
    const response = await this.#send(
      `${this.endpoint.base}/chat/completions`,
      'POST',
      request.key || undefined,
      {
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          chatUserMessage(request.prompt, request.images),
        ],
        stream: true,
        ...(this.preset.usageOption !== false && { stream_options: { include_usage: true } }),
        // A thinking model spends some of these before it says anything.
        [field]: Math.max(request.maxTokens, 1024),
        ...this.preset.extraBody,
      },
      request.signal,
    );
    if (!response.ok) throw await this.#fail(response, request.key);
    if (!response.body) throw new ApiError('network', `${this.preset.label} sent an empty reply.`);
    let said = '';
    let usage: Completion['usage'];
    for await (const event of readChatStream(response.body, request.signal, {
      label: this.preset.label,
      fail: (error) => mapChatError(0, error, undefined, this.preset, request.key),
      ...(this.preset.thinkTags && { thinkTags: true }),
    })) {
      if (event.type === 'text') said += event.delta;
      if (event.type === 'end' && event.usage) usage = event.usage;
    }
    return { text: said, ...(usage && { usage }) };
  }
}
