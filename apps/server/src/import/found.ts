/**
 * What another agent has, in Conch's terms (ADR 0035): read from its files
 * by `openclaw.ts` or `hermes.ts`, and turned into a plan of items a person
 * ticks. Secrets are kept here only long enough to import the ticked ones.
 */
import type { EffortChoice, ImportSourceId, Schedule } from '@conch/protocol';

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
 * Another agent's things (ADR 0042): its own workspace (OpenClaw) or profile
 * (Hermes) with memories, about you and skills, and the jobs that ran as it.
 * Its name, face and voice are its `FoundIdentity`.
 */
export interface FoundAgent {
  /** The app's own id for it: `work`, `coder`. */
  id: string;
  /** What it's called. */
  name: string;
  about?: { text: string; from: string };
  memories: { text: string; from: string; daily?: boolean }[];
  skills: { name: string; path: string }[];
  routines: FoundRoutine[];
}

/**
 * Where an agent's picture was, as its app wrote it. A file is read only
 * inside its own folder (`root`, no links); a web address is never fetched.
 */
export type FoundAvatar =
  | { kind: 'file'; root: string; path: string }
  | { kind: 'data'; data: string }
  | { kind: 'web' }
  | { kind: 'outside' };

/**
 * One agent the app ran (ADR 0101), the main one included: what makes it
 * itself. Each can become one of Conch's agents (`import/agents.ts` shapes it).
 */
export interface FoundIdentity {
  /** The app's own id: `main`, `work`; Hermes's `default` or a profile's name. */
  id: string;
  name: string;
  /** One line on what it's for (a Hermes profile's description). */
  role?: string;
  /** Its emoji there (OpenClaw's IDENTITY.md or `identity.emoji`). */
  emoji?: string;
  avatar?: FoundAvatar;
  /** Its own words about its manner: IDENTITY.md's Theme, Creature or Vibe. */
  vibe?: string;
  /** Its personality (SOUL.md). */
  soul?: { text: string; from: string };
  /** The person's own standing orders for it (AGENTS.md, without the app's template). */
  conventions?: { text: string; from: string };
  /** Its own model, when it had one apart from the app's default. */
  model?: FoundModel;
  effort?: EffortChoice;
  /** The chat apps whose bot (the one Come home brings) answered as it. */
  channels: FoundChannel['kind'][];
}

/** The providers a key from another app can connect (ADR 0042, ADR 0053). */
export type KeyProvider =
  | 'anthropic-api'
  | 'openrouter'
  | 'openai'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'groq'
  | 'cerebras'
  | 'zai'
  | 'moonshot'
  | 'minimax'
  | 'qwen';

export interface FoundKey {
  provider: KeyProvider;
  value: string;
  from: string;
}

/**
 * Where another app keeps each provider's key: its own provider name (an
 * OpenClaw profile) and the environment variable (a Hermes `.env`). A coding
 * plan's key (`kimi-coding`, Z.ai's coding plan) only works in the tools its
 * terms list, so it isn't brought.
 */
export const KEY_SOURCES: readonly {
  provider: KeyProvider;
  names: readonly string[];
  env: readonly string[];
}[] = [
  { provider: 'anthropic-api', names: ['anthropic'], env: ['ANTHROPIC_API_KEY'] },
  { provider: 'openrouter', names: ['openrouter'], env: ['OPENROUTER_API_KEY'] },
  { provider: 'openai', names: ['openai'], env: ['OPENAI_API_KEY'] },
  { provider: 'gemini', names: ['google', 'gemini'], env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
  { provider: 'xai', names: ['xai'], env: ['XAI_API_KEY'] },
  { provider: 'deepseek', names: ['deepseek'], env: ['DEEPSEEK_API_KEY'] },
  { provider: 'mistral', names: ['mistral'], env: ['MISTRAL_API_KEY'] },
  { provider: 'groq', names: ['groq'], env: ['GROQ_API_KEY'] },
  { provider: 'cerebras', names: ['cerebras'], env: ['CEREBRAS_API_KEY'] },
  { provider: 'zai', names: ['zai', 'z-ai', 'zhipu'], env: ['ZAI_API_KEY', 'ZHIPUAI_API_KEY'] },
  { provider: 'moonshot', names: ['moonshot', 'kimi'], env: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'] },
  { provider: 'minimax', names: ['minimax'], env: ['MINIMAX_API_KEY'] },
  { provider: 'qwen', names: ['qwen', 'alibaba', 'dashscope'], env: ['DASHSCOPE_API_KEY'] },
];

/** The keys in an app's `.env`, one per provider. */
export function keysInEnv(env: Record<string, string | undefined>, from: string): FoundKey[] {
  return KEY_SOURCES.flatMap(({ provider, env: names }) => {
    const value = names.map((name) => env[name]?.trim()).find(Boolean);
    return value ? [{ provider, value, from }] : [];
  });
}

export interface Found {
  source: ImportSourceId;
  label: string;
  /** Its folder. */
  path: string;
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
  /** Its agents other than the main one, each with its own things (the main one's are above). */
  agents: FoundAgent[];
  /** Every agent it ran, the main one first: each can come over as one of Conch's (ADR 0101). */
  identities: FoundIdentity[];
  /** The id of its own default agent, when it said which. */
  defaultAgent?: string;
  /** The id of the agent whose things are the ones above (`memories`, `routines`…). */
  mainAgent?: string;
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
  identities: [],
  problems: [],
});
