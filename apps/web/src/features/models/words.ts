/**
 * The words for thinking effort and permission modes: plain data, so the app
 * and the documentation (`apps/docs/reference`) say exactly the same thing.
 */
import type { EffortChoice, PermissionMode } from '@conch/protocol';

/** Plain-language names for effort levels. */
export const effortLabels: Record<EffortChoice, { label: string; description: string }> = {
  auto: { label: 'Auto', description: 'The model decides how long to think' },
  low: { label: 'Low', description: 'Quick answers for simple things' },
  medium: { label: 'Medium', description: 'A balance of speed and care' },
  high: { label: 'High', description: 'Careful thinking for real work' },
  xhigh: { label: 'Extra', description: 'Extra thinking for tricky problems' },
  max: { label: 'Max', description: 'As much thinking as it takes' },
};

export interface ModeWords {
  value: PermissionMode;
  label: string;
  description: string;
  /** What it means for this chat, after "{name} can make mistakes, and ". */
  hint: string;
  tone: 'default' | 'caution' | 'danger';
}

/**
 * Permission modes, named for what they mean to a person. The words are the
 * same whichever provider answers, so each one must be true of all of them;
 * providers say which modes they honour, and a mode one can't honour isn't
 * offered (see `honouredMode`).
 */
export const modeWords: ModeWords[] = [
  {
    value: 'default',
    label: 'Ask first',
    description: 'Asks before editing files or running commands.',
    hint: 'asks before changing anything on your computer',
    tone: 'default',
  },
  {
    value: 'auto',
    label: 'Auto',
    description: 'Safe actions go ahead; anything risky still asks.',
    hint: 'goes ahead with safe steps but asks before risky ones',
    tone: 'default',
  },
  {
    value: 'acceptEdits',
    label: 'Edit freely',
    // Not "commands still ask": some providers run commands in this folder without asking.
    description: 'Changes files in this folder without asking; anything more needs your OK.',
    hint: 'changes files in this folder without asking',
    tone: 'caution',
  },
  {
    value: 'plan',
    label: 'Plan only',
    description: 'Reads and plans but doesn’t change anything.',
    hint: 'only reads and plans: it won’t change anything',
    tone: 'default',
  },
  {
    value: 'bypassPermissions',
    label: 'Full trust',
    description:
      'Can do anything without asking — and a web page or file it reads could trick it. Only in a folder you can afford to lose.',
    hint: 'can change anything on your computer without asking',
    tone: 'danger',
  },
];
