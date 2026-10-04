/** Schemas shared by conversations and routines. */
import { z } from 'zod';

/**
 * Any id that crosses the wire (`c_1a2b3c4d5e6f`, `perm_…`). No dots or slashes,
 * so an id can never become a path outside the folder it names a file in.
 */
export const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'Invalid id.');

/**
 * The providers Conch knows by name. Every connected one is available at once
 * (ADR 0012); `ollama` and `lm-studio` run a model on this computer (ADR
 * 0022); `mock` is the test double. The model APIs that speak OpenAI's chat
 * shape share one adapter, each a row of words and addresses (ADR 0053).
 */
export const BuiltInEngineId = z.enum([
  'claude-code',
  'codex-cli',
  'codex-agent',
  'copilot',
  'gemini-cli',
  'grok',
  'anthropic-api',
  'openrouter',
  'openai',
  'gemini',
  'xai',
  'deepseek',
  'mistral',
  'groq',
  'cerebras',
  'zai',
  'moonshot',
  'minimax',
  'qwen',
  'ollama-cloud',
  'ollama',
  'lm-studio',
  'mock',
]);
export type BuiltInEngineId = z.infer<typeof BuiltInEngineId>;

/**
 * A server you added yourself (Settings → Providers → Another server): `server-`
 * and eight lowercase letters or digits, made when it's added and kept when it's
 * renamed, so a chat that used it still finds it.
 */
export const ServerId = z.templateLiteral(['server-', z.string().regex(/^[a-z0-9]{8}$/)]);
export type ServerId = z.infer<typeof ServerId>;

/** Engines Conch can drive: the ones it knows by name, and the servers you added. */
export const EngineId = z.union([BuiltInEngineId, ServerId]);
export type EngineId = z.infer<typeof EngineId>;

/** Whether a provider id names a server you added, rather than one Conch knows. */
export function isServerId(id: string): id is ServerId {
  return ServerId.safeParse(id).success;
}

/** How hard the model thinks. `auto` lets the model decide (engine default). */
export const EffortChoice = z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
export type EffortChoice = z.infer<typeof EffortChoice>;

/**
 * How much the agent may do without asking — mirrors Claude Code's permission
 * modes: ask first, auto (a classifier approves safe actions), edit files
 * freely, plan only (read-only), or full trust (never asks).
 */
export const PermissionMode = z.enum([
  'default',
  'auto',
  'acceptEdits',
  'plan',
  'bypassPermissions',
]);
export type PermissionMode = z.infer<typeof PermissionMode>;

/** Per-conversation choices; anything unset falls back to the user's defaults. */
export const TurnOptions = z.object({
  /** The provider that answers. Unset = the default provider (`preferences.engine`). */
  engine: EngineId.optional(),
  /** One of that provider's models. Unset = the provider's own default. */
  model: z.string().max(200).optional(),
  effort: EffortChoice.optional(),
  fastMode: z.boolean().optional(),
  permissionMode: PermissionMode.optional(),
});
export type TurnOptions = z.infer<typeof TurnOptions>;

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /**
   * Of `inputTokens`, how many the provider read from its cache, which it
   * bills at a fraction of the price. Absent when it doesn't say.
   */
  cachedInputTokens: z.number().int().nonnegative().optional(),
  /**
   * Of `inputTokens`, how many the provider wrote to its cache this time, which
   * it bills at a little more than the price (Anthropic: a quarter more).
   */
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;

/**
 * A turn that stopped to check in rather than run on (ADR 0077): it did a lot
 * for one message, or kept trying the same thing. Not a failure: the chat
 * offers **Carry on**, which picks up where it stopped.
 */
export const TurnPause = z.object({
  reason: z.enum(['steps', 'tokens', 'time', 'loop']),
  /** One plain sentence for the person. */
  message: z.string().max(300),
});
export type TurnPause = z.infer<typeof TurnPause>;

/**
 * Why a turn failed, when Conch can tell — so the chat offers the one thing
 * that helps (sign in, answer with another provider, open 1Password) instead
 * of a bare "Try again".
 */
export const TurnProblem = z.enum([
  /** The provider's sign-in ended or was refused. */
  'signed-out',
  /** The provider couldn't be reached, or is overloaded. */
  'unavailable',
  /** A usage limit was reached for now. */
  'limit',
  /** The key lives in 1Password, which is locked. */
  'key-locked',
  /**
   * More than the model can read at once, even after Conch summarised the
   * chat's start and tried again (ADR 0055): a model with a bigger window helps.
   */
  'too-long',
]);
export type TurnProblem = z.infer<typeof TurnProblem>;
