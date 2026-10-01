/**
 * What another agent has, in Conch's terms (ADR 0035): read from its files
 * by `openclaw.ts` or `hermes.ts`, and turned into a plan of items a person
 * ticks. Secrets are kept here only long enough to import the ticked ones.
 */
import type { ImportSourceId, Schedule } from '@conch/protocol';

export interface FoundRoutine {
  title: string;
  prompt: string;
  schedule: Schedule;
  timezone: string;
  /** It ran by itself there: it still comes over as a draft here. */
  enabled: boolean;
}

export interface FoundChannel {
  kind: 'telegram' | 'discord' | 'slack';
  /** Telegram, Discord: the bot token. Slack: the bot token. */
  token: string;
  /** Slack's app-level token. */
  appToken?: string;
  /** Where it was found, for the card. */
  from: string;
}

export interface FoundKey {
  provider: 'anthropic-api' | 'openrouter';
  value: string;
  from: string;
}

export interface Found {
  source: ImportSourceId;
  label: string;
  /** Its folder. */
  path: string;
  persona?: { name?: string; instructions?: string; from: string };
  about?: { text: string; from: string };
  /** Each memory, and the file it came from. */
  memories: { text: string; from: string; daily?: boolean }[];
  /** Skill folders (each with a SKILL.md). */
  skills: { name: string; path: string }[];
  routines: FoundRoutine[];
  channels: FoundChannel[];
  keys: FoundKey[];
  /** What couldn't be read, in a sentence each. */
  problems: string[];
}

export const empty = (source: ImportSourceId, label: string, path: string): Found => ({
  source,
  label,
  path,
  memories: [],
  skills: [],
  routines: [],
  channels: [],
  keys: [],
  problems: [],
});
