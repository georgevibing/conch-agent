/**
 * What the API engines share.
 *
 * `openrouter`, `anthropic-api` and `ollama` are one engine driving a plain
 * model API: no session on the provider's side, no files and no shell.
 * Everything that differs between them is an `ApiVariant` — the words on the
 * page, the URLs, and the wire adapter that knows the provider's HTTP. Ollama
 * is the one on this computer: it has no key, and says how it is by itself.
 */
import type { EffortChoice, EngineId, EngineStatus, LoginState, ModelInfo } from '@conch/protocol';

import type { LoginHandle, Picture } from '../types';
import type { Wire } from './wire';

/**
 * The providers this engine family speaks for: OpenRouter, the Anthropic API,
 * Ollama, every model API with a preset (ADR 0053) and the servers you add.
 */
export type ApiProviderId = EngineId;

/** The one function a wire adapter needs from the outside world, so tests can supply their own. */
export type FetchLike = typeof globalThis.fetch;

/** Injected pieces, for tests and for wiring in `services.ts`. */
export interface ApiDeps {
  /** Defaults to the global `fetch`. Tests pass a stub; nothing is monkey-patched. */
  fetch?: FetchLike;
  /** Conch's home directory (`config.CONCH_HOME`). Defaults to `~/.conch`. */
  home?: string;
}

/**
 * One provider, described once. `services.ts` builds these with
 * `openrouterVariant()` / `anthropicApiVariant()`.
 */
export interface ApiVariant {
  readonly id: ApiProviderId;
  /** "OpenRouter", "Anthropic API". */
  readonly label: string;
  /** Where a person reads about it. */
  readonly docsUrl: string;
  /** The page that makes a key, for error copy that tells people what to do. */
  readonly keyUrl: string;
  /** Whether Conch can get a key by signing in, rather than asking for a paste. */
  readonly canSignIn: boolean;
  /** The provider's HTTP, behind one small interface. */
  readonly wire: Wire;
  /** Where transcripts live: `<home>/api-sessions`. */
  readonly home: string;
  /** No key at all: the model is on this computer (Ollama). */
  readonly keyless?: boolean;
  /** A key only some servers want: none saved means none sent. */
  readonly keyOptional?: boolean;
  /** Runs on this computer: works with no internet and spends nothing (`Engine.local`). */
  readonly local?: boolean;
  /**
   * How it is, for a provider with no key to check: installed, running, a
   * model here. Replaces the key check when set.
   */
  status?(key?: string): Promise<EngineStatus>;
  /** The first sentence of what the model is told about itself. */
  readonly where?: string;
  /** A sign-in of the provider's own (Ollama's app), instead of a pasted key. */
  login?(onUpdate: (state: LoginState) => void): LoginHandle;
}

/** A message exactly as the provider's wire format has it. Stored and replayed verbatim. */
export type WireMessage = Record<string, unknown>;

/** JSON Schema for a tool's arguments. */
export type JsonSchema = Record<string, unknown>;

/** One tool as the model sees it: a name, a sentence, and a schema. */
export interface ToolSpec {
  name: string;
  description: string;
  schema: JsonSchema;
}

/** What one request cost. `costUsd` is only set where the provider prices it for us. */
export interface WireUsage {
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`, how many came from the provider's cache. */
  cachedInputTokens?: number;
  /** Of `inputTokens`, how many were written to the provider's cache (billed a little higher). */
  cacheWriteTokens?: number;
  costUsd?: number;
}

/** A tool call the model made. `argumentsJson` is untrusted text, not yet parsed. */
export interface WireToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

/**
 * Why the model stopped talking. `pause`: the provider paused its own work
 * part-way (Anthropic's `pause_turn`), so the reply goes back as it is and the
 * model is asked to carry on.
 */
export type WireStop = 'end' | 'tools' | 'length' | 'pause';

/**
 * One streamed request, normalised. Exactly one `end` event closes it, and it
 * carries the assistant message to append to the transcript — reconstructed
 * block for block, so thinking signatures survive a replay.
 */
export type WireEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  /** Something worth saying while it waits ("Loading the model into memory…"). */
  | { type: 'notice'; code: string; message: string }
  /** A note for the person watching (ADR 0103), from a wire whose `narrates` is set. */
  | { type: 'narration'; text: string }
  | {
      type: 'end';
      message: WireMessage;
      toolCalls: WireToolCall[];
      stop: WireStop;
      usage?: WireUsage;
    };

export interface WireRequest {
  key: string;
  model: string;
  system: string;
  messages: WireMessage[];
  tools: ToolSpec[];
  /**
   * Of `tools`, the ones that may load only when the model looks for them
   * (ADR 0072): sent whole every time, but kept out of the model's context
   * until it searches. Only for a wire whose `defersTools` says it can; the
   * same names, in the same order, for the whole chat.
   */
  deferred?: readonly string[];
  /** `auto` means "don't ask for a thinking budget at all". */
  effort: EffortChoice;
  signal: AbortSignal;
}

export interface WireCompletion {
  key: string;
  model: string;
  system: string;
  prompt: string;
  /** Pictures to look at with the prompt (describing a screenshot, ADR 0070). */
  images?: readonly Picture[];
  maxTokens: number;
  signal: AbortSignal;
}

/** What a key turned out to be, in words a person can read on a card. */
export interface WireAccount {
  /** e.g. "OpenRouter · $12.40 left" or "Anthropic API key". */
  description: string;
}

/** A model, with the extra facts only the provider's own list knows. */
export interface WireModel {
  info: ModelInfo;
  /** Whether the model can call tools at all (no tools, no integrations). */
  tools: boolean;
  /** The provider's thinking switch, when it has one. */
  thinking?: boolean;
  /** Largest output the provider will allow, when it says. */
  maxOutputTokens?: number;
}

/** The sentence for a request longer than the model reads at once (ADR 0055 heals it first). */
export const TOO_LONG =
  'This chat is longer than the model can read at once, even with its start summarised. Pick a model with a bigger window, or start a new chat.';

/** Why a request failed, in the few shapes the engine reacts to differently. */
export type ApiErrorKind =
  | 'auth'
  | 'payment'
  | 'rate-limit'
  | 'overloaded'
  | 'context'
  /** The model can't look at pictures, and the request carried some (ADR 0070). */
  | 'images'
  | 'policy'
  | 'timeout'
  | 'network'
  | 'not-found'
  /** A tool's schema was refused: simplified and sent again (ADR 0072). */
  | 'schema'
  /** The model takes no tools natively: they go in the prompt instead (ADR 0072). */
  | 'tools'
  | 'other';

/**
 * A failure with a plain-language message, already scrubbed of anything that
 * looked like a key. Nothing above the wire ever sees a stack trace.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly retryable: boolean;
  /** How long the provider asked us to wait, when it said. */
  readonly retryAfterMs?: number;
  /** For `context`: the window the provider named, in tokens, when it did. */
  readonly window?: number;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { retryable?: boolean; retryAfterMs?: number; window?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    if (options.window) this.window = options.window;
  }
}
