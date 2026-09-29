import type { EffortChoice, ModelInfo, PermissionMode } from '@conch/protocol';
import { Eye, FilePen, Hand, ShieldCheck, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

/** Plain-language names for effort levels. */
export const effortLabels: Record<EffortChoice, { label: string; description: string }> = {
  auto: { label: 'Auto', description: 'Claude decides how long to think' },
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
  icon: ReactNode;
  tone: 'default' | 'caution' | 'danger';
}

/** Claude Code's permission modes, named for what they mean to a person. */
export const modes: ModeInfo[] = [
  {
    value: 'default',
    label: 'Ask first',
    description: 'Claude asks before editing files or running commands.',
    icon: <Hand />,
    tone: 'default',
  },
  {
    value: 'auto',
    label: 'Auto',
    description: 'Safe actions go ahead; anything risky still asks.',
    icon: <ShieldCheck />,
    tone: 'default',
  },
  {
    value: 'acceptEdits',
    label: 'Edit freely',
    description: 'File edits happen without asking; commands still ask.',
    icon: <FilePen />,
    tone: 'caution',
  },
  {
    value: 'plan',
    label: 'Plan only',
    description: 'Claude reads and plans but doesn’t change anything.',
    icon: <Eye />,
    tone: 'default',
  },
  {
    value: 'bypassPermissions',
    label: 'Full trust',
    description:
      'Claude can do anything without asking — and a web page or file it reads could trick it. Only in a folder you can afford to lose.',
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
