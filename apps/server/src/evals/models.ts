/**
 * The models the eval suite runs (ADR 0071): about ten, one or two per kind of
 * provider, from a frontier model to a small one on this computer. This is the
 * one file to change to add or swap a model.
 *
 * `models` lists ids in order of preference: the first one the provider lists
 * right now is used, so a renamed model falls through to the next instead of
 * failing the run. An empty list means the provider's own default (the first
 * it lists).
 *
 * A model runs only when what it needs is here: a key in the environment (or
 * saved in your own Conch, for local runs), a signed-in program, or Ollama
 * with one of the models pulled. Otherwise it is skipped with the reason.
 */
import type { EngineId } from '@conch/protocol';

export type EvalTier = 'frontier' | 'mid' | 'weak' | 'local' | 'agent';

export interface EvalModel {
  /** Stable key in results and reports, compared across runs. */
  id: string;
  label: string;
  engine: EngineId;
  models: readonly string[];
  tier: EvalTier;
  /** Environment variables that hold its key, any one of them. Unset: no key needed. */
  keys?: readonly string[];
  /**
   * The provider the key is saved for, when not `engine` itself (Codex CLI
   * takes an OpenAI key saved for Codex): saved as is, without Settings' check.
   */
  keyFor?: EngineId;
  /** Part of the cheap smoke run on pushes to main. */
  smoke?: boolean;
}

export const EVAL_MODELS: readonly EvalModel[] = [
  {
    id: 'anthropic-sonnet',
    label: 'Claude Sonnet (Anthropic API)',
    engine: 'anthropic-api',
    models: ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6'],
    tier: 'frontier',
    keys: ['ANTHROPIC_API_KEY'],
  },
  {
    id: 'openai-mini',
    label: 'GPT-5 mini (OpenAI)',
    engine: 'openai',
    models: ['gpt-5-mini', 'gpt-4.1-mini'],
    tier: 'mid',
    keys: ['OPENAI_API_KEY'],
  },
  {
    id: 'gemini-flash',
    label: 'Gemini Flash (Google)',
    engine: 'gemini',
    models: ['gemini-2.5-flash', 'gemini-flash-latest'],
    tier: 'mid',
    keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  },
  {
    id: 'deepseek-chat',
    label: 'DeepSeek V3 (DeepSeek)',
    engine: 'deepseek',
    models: ['deepseek-chat'],
    tier: 'mid',
    keys: ['DEEPSEEK_API_KEY'],
  },
  {
    id: 'mistral-medium',
    label: 'Mistral Medium (Mistral)',
    engine: 'mistral',
    models: ['mistral-medium-latest', 'mistral-small-latest'],
    tier: 'mid',
    keys: ['MISTRAL_API_KEY'],
  },
  {
    id: 'openrouter-mid',
    label: 'GPT-OSS 120B (OpenRouter)',
    engine: 'openrouter',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3-235b-a22b-2507'],
    tier: 'mid',
    keys: ['OPENROUTER_API_KEY'],
    smoke: true,
  },
  {
    id: 'openrouter-weak',
    label: 'Llama 3.1 8B (OpenRouter)',
    engine: 'openrouter',
    models: ['meta-llama/llama-3.1-8b-instruct', 'qwen/qwen3-8b'],
    tier: 'weak',
    keys: ['OPENROUTER_API_KEY'],
  },
  {
    id: 'ollama-small',
    label: 'A small model on this computer (Ollama)',
    engine: 'ollama',
    models: ['qwen3:4b-instruct', 'qwen3:4b', 'llama3.2:3b', 'qwen2.5:7b-instruct'],
    tier: 'local',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    engine: 'claude-code',
    models: [],
    tier: 'agent',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    engine: 'codex-agent',
    models: [],
    tier: 'agent',
    // A throwaway home has no ChatGPT sign-in, and evals never copy one in.
    keys: ['OPENAI_API_KEY'],
    keyFor: 'codex-cli',
  },
];

/**
 * The model a switch hands a chat over from (the `switch` task): the first of
 * these that can run, other than the model being tested.
 */
export const SWITCH_FROM: readonly string[] = [
  'claude-code',
  'anthropic-sonnet',
  'openai-mini',
  'openrouter-mid',
  'gemini-flash',
  'codex',
  'ollama-small',
];

/** The key for a model from the environment, if any. Never logged. */
export function keyFrom(
  model: Pick<EvalModel, 'keys'>,
  env: Record<string, string | undefined>,
): string | undefined {
  for (const name of model.keys ?? []) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * The first preferred id the provider lists; the provider's default when none
 * is set. A list can be partial (OpenRouter shows a shortlist) or empty after a
 * failed fetch, so the first id is tried anyway — unless `strict` (a model on
 * this computer, which is either pulled or not).
 */
export function pickModel(
  wanted: readonly string[],
  listed: readonly string[],
  strict = false,
): { model?: string; missing?: true } {
  // The provider's default is the first it lists; named, so a chat that moves
  // to it doesn't keep the model it had before (as the picker does).
  if (!wanted.length) return listed[0] ? { model: listed[0] } : {};
  const ids = new Set(listed);
  const found = wanted.find((id) => ids.has(id));
  if (found) return { model: found };
  return strict ? { missing: true } : { model: wanted[0] };
}
