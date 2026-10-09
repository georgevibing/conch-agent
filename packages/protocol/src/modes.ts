/**
 * The permission modes in words (ADR 0100): one definition for the chat's
 * picker, Settings → Models, the chat apps' `/mode` menu and the
 * documentation, so every place says exactly the same thing. Every mode
 * means the same with every provider: where a provider has no way of its
 * own to do one, Conch's layer does it (the risk policy, its own tools).
 */
import type { PermissionMode } from './common';

export interface ModeWords {
  value: PermissionMode;
  label: string;
  /** One short line: what it does without asking, and when it stops. */
  description: string;
  /** What it means for this chat, after "{name} can make mistakes, and ". */
  hint: string;
  tone: 'default' | 'caution' | 'danger';
}

/**
 * From the least the assistant may do alone to the most (ADR 0119: four
 * modes, Auto by default). Read only changes nothing; Ask first asks before
 * any change; Auto gets on with the work and stops only for something
 * serious; Full trust never stops, but for the few checks no mode lifts.
 */
export const MODE_WORDS: readonly ModeWords[] = [
  {
    value: 'plan',
    label: 'Read only',
    description: 'Looks and plans. Changes nothing.',
    hint: 'only looks and plans',
    tone: 'default',
  },
  {
    value: 'default',
    label: 'Ask first',
    description: 'Asks before each change.',
    hint: 'asks before each change',
    tone: 'default',
  },
  {
    value: 'auto',
    label: 'Auto',
    description: 'Gets on with it. Asks only before risky steps.',
    hint: 'asks only before risky steps',
    tone: 'caution',
  },
  {
    value: 'bypassPermissions',
    label: 'Full trust',
    description: 'Never asks. Runs anything.',
    hint: 'never asks before acting',
    tone: 'danger',
  },
];

/** The words for one mode. */
export function modeWordsFor(mode: PermissionMode): ModeWords {
  return MODE_WORDS.find((m) => m.value === mode) ?? (MODE_WORDS[1] as ModeWords);
}

/** The mode a chat starts in when nothing chose another (ADR 0119). */
export const DEFAULT_MODE: PermissionMode = 'auto';

/**
 * How much each mode lets happen without asking, as a ladder: a task never
 * runs with more than its chat (ADR 0033), and a chat app asks before a raise.
 */
export const MODE_POWER: Record<PermissionMode, number> = {
  plan: 0,
  default: 1,
  auto: 2,
  bypassPermissions: 3,
};

/**
 * Every mode, safest first: what a provider offers when Conch's layer can do
 * all of them for it. The first is what a mode it can't honour becomes
 * (`honouredMode`).
 */
export const ALL_MODES: readonly PermissionMode[] = [
  'default',
  'plan',
  'auto',
  'bypassPermissions',
];
