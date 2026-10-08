/**
 * The model another agent answered with, in Conch's terms (ADR 0042).
 *
 * Hermes keeps it in `config.yaml` (`model.default` and `model.provider`),
 * OpenClaw in `openclaw.json` (`agents.defaults.model`, `provider/model`).
 * Conch has no providers of the same names, so the choice is matched by
 * what the model *is* against what each connected provider offers right
 * now: the same model where it can, the same family ("Sonnet") where it
 * can't, and a sentence saying why when neither is here. It never moves
 * silently, and never brings a key with it.
 */
import type { EngineId } from '@conch/protocol';

import { PROVIDER_COPY } from '../providers/catalog';
import type { FoundKey, FoundModel } from './found';
import { get, str } from './read';

/** One connected provider and what it offers, as the model picker has it. */
export interface CatalogEntry {
  engine: EngineId;
  label: string;
  local?: boolean;
  models: { id: string; label: string }[];
}

export interface ModelChoice {
  engine: EngineId;
  /** "Claude Code". */
  engineLabel: string;
  /** The provider's own id for it: `sonnet`, `anthropic/claude-sonnet-4.5`. */
  model: string;
  /** "Sonnet 4.5". */
  modelLabel: string;
  /** The very model, not just one of its family. */
  exact: boolean;
}

export type Mapped =
  | { ok: true; choice: ModelChoice }
  /** Why it stays behind, in a sentence; `key` when the app's own key, ticked, would bring it. */
  | { ok: false; reason: string; key?: FoundKey['provider']; engine?: EngineId };

/** The app's providers, in its users' words. */
const PROVIDER_WORDS: Record<string, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  'openai-codex': 'ChatGPT (Codex)',
  openai: 'OpenAI',
  codex: 'Codex',
  nous: 'Nous Portal',
  zai: 'Z.ai',
  'kimi-coding': 'Kimi',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax',
  copilot: 'GitHub Copilot',
  gemini: 'Google Gemini',
  google: 'Google Gemini',
  huggingface: 'Hugging Face',
  ollama: 'Ollama',
  custom: 'its own server',
};

/** Where each of the app's providers runs in Conch, best first. */
const PROVIDER_ENGINES: Record<string, EngineId[]> = {
  anthropic: ['anthropic-api', 'claude-code'],
  claude: ['claude-code', 'anthropic-api'],
  openrouter: ['openrouter'],
  'openai-codex': ['codex-cli', 'openai'],
  openai: ['openai', 'codex-cli'],
  codex: ['codex-cli'],
  ollama: ['ollama'],
  copilot: ['copilot'],
  'github-copilot': ['copilot'],
  google: ['gemini', 'gemini-cli'],
  gemini: ['gemini', 'gemini-cli'],
  'google-gemini-cli': ['gemini-cli', 'gemini'],
  xai: ['xai', 'grok'],
  deepseek: ['deepseek'],
  mistral: ['mistral'],
  groq: ['groq'],
  cerebras: ['cerebras'],
  zai: ['zai'],
  moonshot: ['moonshot'],
  kimi: ['moonshot'],
  minimax: ['minimax'],
  'minimax-cn': ['minimax'],
  qwen: ['qwen'],
  'ollama-cloud': ['ollama-cloud'],
  lmstudio: ['lm-studio'],
  'lm-studio': ['lm-studio'],
};

/** Where a model maker's models can run in Conch. */
const VENDOR_ENGINES: Record<string, EngineId[]> = {
  anthropic: ['claude-code', 'anthropic-api', 'openrouter'],
  openai: ['codex-cli', 'openai', 'openrouter'],
  google: ['gemini', 'gemini-cli', 'openrouter'],
  'x-ai': ['xai', 'grok', 'openrouter'],
  deepseek: ['deepseek', 'openrouter'],
  mistralai: ['mistral', 'openrouter'],
  moonshotai: ['moonshot', 'openrouter'],
  'z-ai': ['zai', 'openrouter'],
  minimax: ['minimax', 'openrouter'],
  qwen: ['qwen', 'openrouter'],
  // Your company's cloud (ADR 0109): connected by choosing the account, never by a copied key.
  'amazon-bedrock': ['bedrock'],
  bedrock: ['bedrock'],
  'anthropic-vertex': ['vertex'],
  'google-vertex': ['vertex'],
  vertex: ['vertex'],
  'azure-openai': ['azure-openai'],
  'microsoft-foundry': ['azure-openai'],
};

/** Keys the app may have that would connect a provider. */
const KEYED: Partial<Record<EngineId, FoundKey['provider']>> = {
  'anthropic-api': 'anthropic-api',
  openrouter: 'openrouter',
  openai: 'openai',
  gemini: 'gemini',
  xai: 'xai',
  deepseek: 'deepseek',
  mistral: 'mistral',
  groq: 'groq',
  cerebras: 'cerebras',
  zai: 'zai',
  moonshot: 'moonshot',
  minimax: 'minimax',
  qwen: 'qwen',
};

const engineName = (id: EngineId) => PROVIDER_COPY.get(id)?.name ?? id;

/** The model's own name, without where it ran: `claude-sonnet-4.5`. */
const bare = (model: string) => model.replace(/^.*\//, '');

/** Two ids name the same model: `claude-sonnet-4.5` and `claude-sonnet-4-5-20250929`. */
const norm = (id: string) =>
  bare(id)
    .toLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/-(\d{8}|latest)$/, '');

/** Who makes it: `anthropic/…` says so; otherwise its name does. */
function vendorOf(model: string): string | undefined {
  const parts = model.toLowerCase().split('/');
  // `openrouter/anthropic/claude…`: the maker is the part before the model.
  if (parts.length > 1) return parts.at(-2);
  if (/^claude/.test(parts[0] ?? '')) return 'anthropic';
  if (/^(gpt|o\d|codex)/.test(parts[0] ?? '')) return 'openai';
  return undefined;
}

/** The family it belongs to, when there is one worth matching: `sonnet`, `gpt-5`. */
function familyOf(model: string): string | undefined {
  const id = norm(model);
  const claude = /(opus|sonnet|haiku)/.exec(id)?.[1];
  if (claude) return claude;
  return /^(gpt-\d+|o\d+)/.exec(id)?.[1];
}

/** `anthropic/claude-sonnet-4.5` → "Claude Sonnet 4.5"; `gpt-4o-mini` → "GPT-4o Mini". */
export function modelWords(model: string): string {
  const words: string[] = [];
  for (const w of bare(model)
    .replace(/[-_](\d{8}|latest)$/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)) {
    const last = words.at(-1);
    // `4-5` is a version: 4.5.
    if (last && /^\d+$/.test(w) && /^\d+(\.\d+)*$/.test(last) && w.length <= 2)
      words[words.length - 1] = `${last}.${w}`;
    else words.push(w);
  }
  if (words[0]?.toLowerCase() === 'gpt' && words[1]) words.splice(0, 2, `GPT-${words[1]}`);
  return words
    .map((w) => (/^\d+b$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .slice(0, 60);
}

/** The family in words, for a near match: "Claude Sonnet", "GPT-5". */
function familyWords(model: string): string {
  const family = familyOf(model);
  if (!family) return modelWords(model);
  return /^(opus|sonnet|haiku)$/.test(family)
    ? `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)}`
    : modelWords(family);
}

/** What a person would call the choice: the model, and where it ran when that matters. */
export function choiceWords(found: FoundModel): string {
  const where = found.provider && PROVIDER_WORDS[found.provider.toLowerCase()];
  return where && found.provider !== 'auto'
    ? `${modelWords(found.model)} through ${where}`
    : modelWords(found.model);
}

/** The very model, or one of its family, among what a provider offers. */
function pick(entry: CatalogEntry, model: string): ModelChoice | undefined {
  const offered = entry.models.filter((m) => m.id && m.id !== 'default');
  const exact = offered.find(
    (m) => m.id.toLowerCase() === model.toLowerCase() || norm(m.id) === norm(model),
  );
  const family = familyOf(model);
  const near =
    !exact && family
      ? offered.find((m) => norm(m.id).includes(family) || norm(m.label).includes(family))
      : undefined;
  const chosen = exact ?? near;
  if (!chosen) return undefined;
  return {
    engine: entry.engine,
    engineLabel: entry.label,
    model: chosen.id,
    modelLabel: chosen.label || chosen.id,
    exact: Boolean(exact),
  };
}

/**
 * Where `found` runs in Conch, given what's connected (`catalog`) and the
 * keys the app has (`keys`, which come over only if ticked).
 */
export function mapModel(
  found: FoundModel,
  app: string,
  catalog: CatalogEntry[],
  keys: FoundKey['provider'][] = [],
): Mapped {
  const provider = (found.provider ?? 'auto').toLowerCase();
  const vendor = vendorOf(found.model);
  const named = found.local ? ['ollama' as const] : (PROVIDER_ENGINES[provider] ?? []);
  const known = provider === 'auto' || provider in PROVIDER_ENGINES || found.local;
  const order = [
    ...named,
    ...(vendor ? (VENDOR_ENGINES[vendor] ?? ['openrouter' as const]) : []),
    // Anything else connected that offers it: the mock engine in tests, a provider added later.
    ...catalog.map((c) => c.engine).filter((e) => e !== 'ollama' || found.local),
  ].filter((e, i, all) => all.indexOf(e) === i);

  for (const engine of order) {
    const entry = catalog.find((c) => c.engine === engine);
    if (!entry || (entry.local && !found.local && !named.includes(engine))) continue;
    const choice = pick(entry, found.model);
    if (choice) return { ok: true, choice };
  }

  const what = `${app}’s model, ${choiceWords(found)},`;
  // Its own provider isn't connected here yet, but the app's key for it is here to bring.
  const missing = order.find((e) => !catalog.some((c) => c.engine === e) && KEYED[e]);
  const key = missing && KEYED[missing];
  if (key && keys.includes(key))
    return {
      ok: false,
      key,
      engine: missing,
      reason: `${what} needs your ${engineName(missing)} key from ${app}. Tick it too, and new chats start with it.`,
    };
  if (!known && !vendor)
    return {
      ok: false,
      reason: `${what} stays behind: Conch can’t connect to ${PROVIDER_WORDS[provider] ?? provider} yet, so new chats keep Conch’s own choice.`,
    };
  const first = order.find((e) => !catalog.some((c) => c.engine === e));
  if (first)
    return {
      ok: false,
      reason: `${what} stays behind: ${engineName(first)} isn’t connected in Conch yet. Connect it in Providers, then pick the model in any chat.`,
    };
  return {
    ok: false,
    reason: `${what} stays behind: no provider connected here offers it, so new chats keep Conch’s own choice.`,
  };
}

/**
 * Hermes's `config.yaml`: `model:` is a map (`default`, `provider`,
 * `base_url`) or, in older files, just the model's name.
 */
export function hermesModel(config: Record<string, unknown>): FoundModel | undefined {
  const block = config.model;
  const model =
    typeof block === 'string'
      ? str(block)
      : (str(get(block, 'default')) ?? str(get(block, 'name')) ?? str(get(block, 'model')));
  if (!model) return undefined;
  const provider = str(get(block, 'provider')) ?? str(config.provider);
  const base = str(get(block, 'base_url')) ?? str(get(block, 'baseUrl'));
  return {
    model: model.slice(0, 200),
    ...(provider && { provider: provider.slice(0, 40) }),
    from: 'config.yaml',
    ...(base && isLocal(base) && { local: true }),
  };
}

/**
 * OpenClaw's `agents.defaults.model`: `provider/model` as a string, or
 * `{ primary, fallbacks }`. The provider is the part before the first `/`.
 */
export function openClawModel(value: unknown): FoundModel | undefined {
  const ref = str(value) ?? str(get(value, 'primary'));
  if (!ref) return undefined;
  const at = ref.indexOf('/');
  const provider = at > 0 ? ref.slice(0, at) : undefined;
  const model = at > 0 ? ref.slice(at + 1) : ref;
  if (!model) return undefined;
  return {
    model: (provider === 'openrouter' ? model : ref).slice(0, 200),
    ...(provider && { provider: provider.slice(0, 40) }),
    from: 'openclaw.json',
    ...(provider === 'ollama' && { local: true }),
  };
}

function isLocal(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** What the plan calls it: the very model, or its family when that's what's here. */
export const choiceTitle = (found: FoundModel, choice: ModelChoice): string =>
  choice.exact ? modelWords(found.model) : familyWords(found.model);
