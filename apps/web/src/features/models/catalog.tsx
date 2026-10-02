import { canUseApps, isServerId } from '@conch/protocol';
import type {
  BuiltInEngineId,
  EffortChoice,
  EngineId,
  ModelInfo,
  PermissionMode,
  ProviderModels,
} from '@conch/protocol';
import type { ModelProvider, ProviderId } from '@conch/nacre';
import { Eye, FilePen, Hand, ShieldCheck, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

import { effortLabels, modeWords, type ModeWords } from './words';

export { effortLabels };

export function effortOptions(model: ModelInfo | undefined) {
  const levels: EffortChoice[] = ['auto', ...(model?.efforts ?? [])];
  return model?.efforts.length ? levels.map((value) => ({ value, ...effortLabels[value] })) : [];
}

export interface ModeInfo extends ModeWords {
  icon: ReactNode;
}

const modeIcons: Record<PermissionMode, ReactNode> = {
  default: <Hand />,
  auto: <ShieldCheck />,
  acceptEdits: <FilePen />,
  plan: <Eye />,
  bypassPermissions: <Zap />,
};

/** The modes with their icons; the words are in `words.ts`. */
export const modes: ModeInfo[] = modeWords.map((mode) => ({
  ...mode,
  icon: modeIcons[mode.value],
}));

export function availableModes(supported: PermissionMode[] | undefined): ModeInfo[] {
  return supported ? modes.filter((m) => supported.includes(m.value)) : modes;
}

export function modeInfo(value: PermissionMode): ModeInfo {
  return modes.find((m) => m.value === value) ?? (modes[0] as ModeInfo);
}

const recommended = /\s*\(recommended\)\s*$/i;

/**
 * Engines mark their pick in the name, e.g. Claude Code's "Default
 * (recommended)". The chip shows just the name; the picker adds the badge.
 */
export function modelLabel(label: string): { label: string; badge?: string } {
  return recommended.test(label)
    ? { label: label.replace(recommended, ''), badge: 'Recommended' }
    : { label };
}

/**
 * Older versions and long-context variants go under "More models" so the
 * list opens on the handful of choices most people need.
 */
export function isSecondaryModel(model: ModelInfo): boolean {
  return /previous|legacy|older|deprecated/i.test(model.description) || /\b1M\b/i.test(model.label);
}

/** The mark each provider Conch knows by name wears in the picker. */
const providerLogos: Record<BuiltInEngineId, ProviderId> = {
  'claude-code': 'claude',
  'anthropic-api': 'claude',
  'codex-cli': 'openai',
  openai: 'openai',
  copilot: 'copilot',
  'gemini-cli': 'gemini',
  gemini: 'gemini',
  openrouter: 'openrouter',
  xai: 'xai',
  deepseek: 'deepseek',
  mistral: 'mistral',
  groq: 'groq',
  cerebras: 'cerebras',
  zai: 'zai',
  moonshot: 'kimi',
  minimax: 'minimax',
  qwen: 'qwen',
  'ollama-cloud': 'ollama',
  ollama: 'local',
  'lm-studio': 'lmstudio',
  mock: 'claude',
};

/** The mark a provider wears in the picker: a server you added wears a server. */
export function providerLogo(engine: EngineId): ProviderId {
  return isServerId(engine) ? 'server' : providerLogos[engine];
}

/** A provider with a long list (OpenRouter) opens on its first few; search finds the rest. */
const FEATURED = 6;

/**
 * Every connected provider as the model picker shows it, the default first.
 * Choices are keyed `engine|model` (see `modelKey`) so two providers can
 * offer a model with the same id.
 */
export function pickerProviders(
  providers: ProviderModels[],
  defaultEngine: EngineId | undefined,
  key: (engine: string, model: string) => string,
): ModelProvider[] {
  const many = providers.length > 1;
  return providers.map((provider) => {
    const long = provider.models.length > FEATURED * 2;
    return {
      id: provider.engine,
      label: provider.label,
      logo: providerLogo(provider.engine),
      note: many && provider.engine === defaultEngine ? 'Default' : undefined,
      message:
        provider.message ??
        (provider.models.length ? undefined : `${provider.label} didn’t list any models.`),
      models: provider.models.map((m, i) => ({
        id: key(provider.engine, m.id),
        ...modelLabel(m.label),
        description: m.description,
        keywords: `${m.id} ${provider.label}`,
        secondary: isSecondaryModel(m) || (long && i >= FEATURED),
        // Says so under its name (ADR 0050): it can only chat.
        ...(!canUseApps(provider, m) && { chatOnly: true }),
      })),
    };
  });
}
