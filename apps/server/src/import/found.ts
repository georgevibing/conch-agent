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
  /**
   * Telegram, Discord: the bot token. Slack: the bot token, which may be
   * missing when only the app-level one was kept (ADR 0042).
   */
  token?: string;
  /** Slack's app-level token, missing when the app answered over HTTP instead. */
  appToken?: string;
  /** Where it was found, for the card. */
  from: string;
}

/** A Slack bot with one of its two keys: offered anyway, with a step to get the other. */
export const slackHalf = (c: FoundChannel): 'botToken' | 'appToken' | undefined =>
  c.kind !== 'slack' || Boolean(c.token) === Boolean(c.appToken)
    ? undefined
    : c.token
      ? 'botToken'
      : 'appToken';

/** The model it answered with (ADR 0042), as the app wrote it. */
export interface FoundModel {
  /** The app's own name for where the model ran: `openrouter`, `anthropic`, `auto`. */
  provider?: string;
  /** `anthropic/claude-sonnet-4.5`, `gpt-5`. */
  model: string;
  /** Where it was set, for the card: `config.yaml`. */
  from: string;
  /** It ran on this computer (a server on localhost). */
  local?: boolean;
}

/**
 * One of OpenClaw's other agents (ADR 0042): its own workspace with a
 * persona, memories and skills, and the cron jobs that ran as it.
 */
export interface FoundAgent {
  /** OpenClaw's id for it: `work`. */
  id: string;
  /** What it's called: its IDENTITY.md name, else its name in the config. */
  name: string;
  persona?: { name?: string; instructions?: string; from: string };
  about?: { text: string; from: string };
  memories: { text: string; from: string; daily?: boolean }[];
  skills: { name: string; path: string }[];
  routines: FoundRoutine[];
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
  /** The model it answered with, when it said. */
  model?: FoundModel;
  /** OpenClaw's agents other than the main one, each with its own things. */
  agents: FoundAgent[];
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
  agents: [],
  problems: [],
});
