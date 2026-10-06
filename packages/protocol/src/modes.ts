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
 * From the least the assistant may do alone to the most. Plan only changes
 * nothing; Ask first asks before any change; Edit freely changes files in the
 * work folder; Auto gets on with the work and stops only for something
 * serious; Full trust never stops, but for the few checks no mode lifts.
 */
export const MODE_WORDS: readonly ModeWords[] = [
  {
    value: 'plan',
    label: 'Plan only',
    description: 'Looks around and plans. Changes nothing until you say go.',
    hint: 'only reads and plans: it won’t change anything',
    tone: 'default',
  },
  {
    value: 'default',
    label: 'Ask first',
    description: 'Asks before it changes a file, runs a command or acts in an app.',
    hint: 'asks before changing anything on your computer',
    tone: 'default',
  },
  {
    value: 'acceptEdits',
    label: 'Edit freely',
    // Not "commands still ask": some providers run read-only commands without asking.
    description: 'Changes files in this folder without asking. Anything more needs your OK.',
    hint: 'changes files in this folder without asking',
    tone: 'caution',
  },
  {
    value: 'auto',
    label: 'Auto',
    description:
      'Gets on with the work. Stops to ask only before something serious, like deleting, publishing or reaching your keys.',
    hint: 'gets on with the work and asks only before something serious',
    tone: 'caution',
  },
  {
    value: 'bypassPermissions',
    label: 'Full trust',
    description:
      'Never stops to ask. A page or file it reads could trick it, so only in a folder you can afford to lose.',
    hint: 'can change anything on your computer without asking',
    tone: 'danger',
  },
];

/** The words for one mode. */
export function modeWordsFor(mode: PermissionMode): ModeWords {
  return MODE_WORDS.find((m) => m.value === mode) ?? (MODE_WORDS[1] as ModeWords);
}

/**
 * How much each mode lets happen without asking, as a ladder: a task never
 * runs with more than its chat (ADR 0033), and a chat app asks before a raise.
 */
export const MODE_POWER: Record<PermissionMode, number> = {
  plan: 0,
  default: 1,
  acceptEdits: 2,
  auto: 3,
  bypassPermissions: 4,
};

/**
 * Every mode, safest first: what a provider offers when Conch's layer can do
 * all of them for it. The first is what a mode it can't honour becomes
 * (`honouredMode`).
 */
export const ALL_MODES: readonly PermissionMode[] = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'bypassPermissions',
];
