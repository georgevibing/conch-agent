import type {
  EffortChoice,
  EngineId,
  ModelInfo,
  PermissionMode,
  ProviderModels,
} from '@conch/protocol';
import type { ModelProvider, ProviderId } from '@conch/nacre';
import { Eye, FilePen, Hand, ShieldCheck, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

/** Plain-language names for effort levels. */
export const effortLabels: Record<EffortChoice, { label: string; description: string }> = {
  auto: { label: 'Auto', description: 'The model decides how long to think' },
  low: { label: 'Low', description: 'Quick answers for simple things' },
  medium: { label: 'Medium', description: 'A balance of speed and care' },
  high: { label: 'High', description: 'Careful thinking for real work' },
  xhigh: { label: 'Extra', description: 'Extra thinking for tricky problems' },
  max: { label: 'Max', description: 'As much thinking as it takes' },
};

export function effortOptions(model: ModelInfo | undefined) {
  const levels: EffortChoice[] = ['auto', ...(model?.efforts ?? [])];
  return model?.efforts.length ? levels.map((value) => ({ value, ...effortLabels[value] })) : [];
}

export interface ModeInfo {
  value: PermissionMode;
  label: string;
  description: string;
  /** What it means for this chat, after "{name} can make mistakes, and ". */
  hint: string;
  icon: ReactNode;
  tone: 'default' | 'caution' | 'danger';
}

/**
 * Permission modes, named for what they mean to a person. The words are the
 * same whichever provider answers, so each one must be true of all of them;
 * providers say which modes they honour, and a mode one can't honour isn't
 * offered (see `honouredMode`).
 */
export const modes: ModeInfo[] = [
  {
    value: 'default',
    label: 'Ask first',
    description: 'Asks before editing files or running commands.',
    hint: 'asks before changing anything on your computer',
    icon: <Hand />,
    tone: 'default',
  },
  {
    value: 'auto',
    label: 'Auto',
    description: 'Safe actions go ahead; anything risky still asks.',
    hint: 'goes ahead with safe steps but asks before risky ones',
    icon: <ShieldCheck />,
    tone: 'default',
  },
  {
    value: 'acceptEdits',
    label: 'Edit freely',
    // Not "commands still ask": some providers run commands in this folder without asking.
    description: 'Changes files in this folder without asking; anything more needs your OK.',
    hint: 'changes files in this folder without asking',
    icon: <FilePen />,
    tone: 'caution',
  },
  {
    value: 'plan',
    label: 'Plan only',
    description: 'Reads and plans but doesn’t change anything.',
    hint: 'only reads and plans: it won’t change anything',
    icon: <Eye />,
    tone: 'default',
  },
  {
    value: 'bypassPermissions',
    label: 'Full trust',
    description:
      'Can do anything without asking — and a web page or file it reads could trick it. Only in a folder you can afford to lose.',
    hint: 'can change anything on your computer without asking',
    icon: <Zap />,
    tone: 'danger',
  },
];

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

/** The mark each provider wears in the picker. */
export const providerLogos: Record<EngineId, ProviderId> = {
  'claude-code': 'claude',
  'anthropic-api': 'claude',
  'codex-cli': 'openai',
  openrouter: 'openrouter',
  ollama: 'generic',
  mock: 'claude',
};

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
      logo: providerLogos[provider.engine],
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
      })),
    };
  });
}
