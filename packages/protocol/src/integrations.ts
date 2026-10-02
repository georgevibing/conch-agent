/**
 * Integrations — the apps and services your assistant can use on your behalf.
 *
 * MCP integrations share this model; native Google accounts have their own
 * GoogleStatus contract. Conch keeps a small catalog of
 * well-known ones (one click, no config files) and lets you add any other by
 * URL or command. They belong to Conch, so every provider can use them; what a
 * provider has set up on its own is listed separately.
 *
 * Secrets (tokens, OAuth credentials) never appear in these schemas: the
 * browser sends them once, and the gateway only ever says whether one is saved.
 */
import { z } from 'zod';

import { EngineId } from './common';

/** How you sign in to an integration. */
export const IntegrationAuth = z.enum([
  /** Sign in on the service's own page; Conch keeps the token fresh. */
  'oauth',
  /** Paste a token or key the service gives you. */
  'token',
  /** Nothing to sign in to (runs on this computer, or is public). */
  'none',
]);
export type IntegrationAuth = z.infer<typeof IntegrationAuth>;

/**
 * How a catalog entry connects. `google` uses Conch’s native Google account flow.
 * `account` services (such as Slack) only let
 * pre-approved apps sign in, so they connect through the AI provider's own
 * account connectors (e.g. your Claude account) and the engine loads them by
 * itself. Engines without account connectors don't offer them.
 */
export const CatalogAuth = z.enum([...IntegrationAuth.options, 'account', 'google']);
export type CatalogAuth = z.infer<typeof CatalogAuth>;

export const IntegrationCategory = z.enum([
  'productivity',
  'developer',
  'files',
  'home',
  'browser',
  'other',
]);
export type IntegrationCategory = z.infer<typeof IntegrationCategory>;

/** A value you type to set an integration up (a token, an address). */
export const IntegrationField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  label: z.string(),
  /** Kept in `secrets.json`, never sent back to the browser. */
  secret: z.boolean().default(false),
  placeholder: z.string().optional(),
  /** One plain sentence on where to find it. */
  help: z.string().optional(),
  /** Page that creates it (e.g. a token page with the right scopes ticked). */
  helpUrl: z.string().optional(),
  optional: z.boolean().default(false),
  /** Shape the value must have, checked on both sides. */
  pattern: z.string().optional(),
  patternHint: z.string().optional(),
});
export type IntegrationField = z.infer<typeof IntegrationField>;

/** A catalog entry's id: `linear`, `google-calendar`. */
export const CatalogId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Unknown app.');
export type CatalogId = z.infer<typeof CatalogId>;

/** A well-known integration Conch knows how to set up. */
export const CatalogEntry = z.object({
  id: z.string(),
  name: z.string(),
  /** Four or five words: "Pages, docs and databases". */
  tagline: z.string(),
  /** A sentence on what Claude can do with it. */
  description: z.string(),
  category: IntegrationCategory,
  auth: CatalogAuth,
  /** What runs on this computer, shown before you agree to it. */
  command: z.string().optional(),
  /** Runs on this computer rather than the service's servers. */
  local: z.boolean().default(false),
  fields: z.array(IntegrationField).default([]),
  /** Short, numbered steps shown next to the fields. */
  steps: z.array(z.string()).default([]),
  /** Things to try once it's connected. */
  examples: z.array(z.string()).default([]),
  /** What it can see and do, in plain words. */
  access: z.array(z.string()).default([]),
  /** Brand colour for the logo tile, as a hex value. */
  color: z.string().optional(),
  homepage: z.string().optional(),
  /** Needs something installed first (e.g. Google Chrome). */
  requires: z.string().optional(),
  /** Shown first on the page. */
  featured: z.boolean().default(false),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

/**
 * What an integration's tools may do without asking. Tool hints come from
 * the integration itself, so "read" is its claim, not a guarantee.
 */
export const IntegrationPolicy = z.enum([
  /** Ask before every action. */
  'ask',
  /** Let it look things up; ask before it changes anything. */
  'ask-writes',
  /** Never ask. */
  'trust',
]);
export type IntegrationPolicy = z.infer<typeof IntegrationPolicy>;

/** A per-tool override of the integration's policy. */
export const ToolPolicy = z.enum(['allow', 'ask', 'off']);
export type ToolPolicy = z.infer<typeof ToolPolicy>;

export const IntegrationTool = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().default(''),
  /** From the tool's own hints: `read` only looks, `write` changes things. */
  access: z.enum(['read', 'write']),
  /** The server says this can delete or overwrite. */
  destructive: z.boolean().default(false),
  /** Set when you overrode the integration's policy for this tool. */
  policy: ToolPolicy.optional(),
});
export type IntegrationTool = z.infer<typeof IntegrationTool>;

export const HealthState = z.enum([
  /** Working: connected and offering tools. */
  'ok',
  /** Being checked right now. */
  'checking',
  /** Waiting for you to finish signing in. */
  'connecting',
  /** Sign-in is missing, expired or was revoked. */
  'needs-auth',
  /** Works, but something is worth knowing (e.g. no tools, expiring soon). */
  'warning',
  /** Can't be reached or failed to start. */
  'error',
  /** Turned off; Claude won't see it. */
  'off',
]);
export type HealthState = z.infer<typeof HealthState>;

/**
 * What the user can do about a problem — the UI renders it as one button.
 * `setup`: something it needs isn't on this computer yet, or is switched off;
 * the connect dialog shows what, and offers to get it.
 */
export const HealthAction = z.enum(['reconnect', 'edit', 'retry', 'turn-on', 'setup']);
export type HealthAction = z.infer<typeof HealthAction>;

export const IntegrationHealth = z.object({
  state: HealthState,
  /** One plain sentence: what's wrong and what to do. */
  message: z.string().optional(),
  /** The underlying error, for the curious (trimmed, never contains secrets). */
  detail: z.string().optional(),
  action: HealthAction.optional(),
  checkedAt: z.number().optional(),
  /** The last time it worked. */
  okAt: z.number().optional(),
  /** Conch will look again by itself at this time (a failure that usually passes). */
  retryAt: z.number().optional(),
  /** Something Conch can get for it (`GET /api/needs/:id`), when that's what's missing. */
  need: z.string().optional(),
});
export type IntegrationHealth = z.infer<typeof IntegrationHealth>;

/**
 * Where the MCP server lives, minus secrets. `url` is https (or loopback);
 * `command` runs on this computer as you.
 */
export const IntegrationTransport = z.discriminatedUnion('type', [
  z.object({ type: z.literal('http'), url: z.string() }),
  z.object({ type: z.literal('stdio'), command: z.string(), args: z.array(z.string()) }),
]);
export type IntegrationTransport = z.infer<typeof IntegrationTransport>;

/** MCP server names become tool prefixes (`mcp__notion__search`). */
export const ServerName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, 'Use lowercase letters, numbers, dashes and underscores.')
  .refine((name) => name !== 'conch', 'That name is taken.');

export const Integration = z.object({
  id: z.string(),
  /** The catalog entry it came from; unset for ones you added yourself. */
  catalogId: z.string().optional(),
  name: z.string(),
  /** Its MCP server name — how its tools are named. */
  server: ServerName,
  transport: IntegrationTransport,
  auth: IntegrationAuth,
  enabled: z.boolean(),
  policy: IntegrationPolicy,
  health: IntegrationHealth,
  tools: z.array(IntegrationTool).default([]),
  /** Non-secret field values (e.g. a Home Assistant address). */
  values: z.record(z.string(), z.string()).default({}),
  /** Keys of secret fields that have a value saved. */
  secrets: z.array(z.string()).default([]),
  /** Who you're signed in as, when the service says. */
  account: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastUsedAt: z.number().optional(),
});
export type Integration = z.infer<typeof Integration>;

/**
 * An MCP server a provider loads by itself (its own settings, its account's
 * connectors, plugins). It only works when that provider answers — unlike
 * integrations connected in Conch, which every provider gets.
 */
export const ExternalIntegration = z.object({
  name: z.string(),
  /** The provider that brings it. */
  provider: EngineId,
  /** "Claude Code" */
  providerName: z.string(),
  /** `engine`: the engine's own settings; `account`: the provider account's connectors. */
  source: z.enum(['engine', 'project', 'account', 'plugin', 'other']),
  state: z.enum(['ok', 'needs-auth', 'error', 'off', 'checking']),
  message: z.string().optional(),
  toolCount: z.number().int().nonnegative().default(0),
  /** The plugin that adds it, when a plugin does. */
  plugin: z.string().optional(),
  /** A catalog entry it looks like, for its logo. */
  catalogId: z.string().optional(),
  /**
   * A server on the web that Conch can connect to itself, so it works with every
   * model (`POST /api/integrations/adopt`). Its address stays on the gateway.
   */
  adoptable: z.boolean().default(false),
});
export type ExternalIntegration = z.infer<typeof ExternalIntegration>;

/**
 * What one connected provider does with integrations. Every provider gets them:
 * `native` engines (Claude Code, Codex CLI) load MCP servers themselves;
 * `bridge` engines (plain APIs such as OpenRouter) get their tools from
 * Conch, which connects to the servers on their behalf.
 */
export const IntegrationProvider = z.object({
  id: EngineId,
  /** "Claude Code", "Codex", "OpenRouter"… */
  engine: z.string(),
  mode: z.enum(['native', 'bridge']),
  /** Lists servers configured in the engine itself. */
  hasOwnServers: z.boolean().default(false),
  /** The provider account's own connectors, when it has them. */
  account: z
    .object({
      /** "your Claude account" */
      label: z.string(),
      /** Where you connect them. */
      url: z.string(),
      /** Usable with the current sign-in. */
      ready: z.boolean(),
      /** Why not, in plain words. */
      hint: z.string().optional(),
    })
    .optional(),
});
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

export const IntegrationsList = z.object({
  catalog: z.array(CatalogEntry),
  integrations: z.array(Integration),
  /** Every connected provider — integrations connected in Conch work with all of them. */
  providers: z.array(IntegrationProvider),
});
export type IntegrationsList = z.infer<typeof IntegrationsList>;

export const ExternalList = z.object({
  servers: z.array(ExternalIntegration),
  /** Why the list is empty or partial (e.g. a provider couldn't be asked). */
  message: z.string().optional(),
  checkedAt: z.number(),
});
export type ExternalList = z.infer<typeof ExternalList>;

const FieldValues = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  z.string().max(4096),
);

/** A URL Conch will talk to: https anywhere, plain http only on this computer or your network. */
export const IntegrationUrl = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https?$/, error: 'Enter a full address starting with https://' }))
  .refine((value) => !/^[a-z]+:\/\/[^/?#]*@/i.test(value), 'Addresses can’t contain a password.');

export const CustomIntegration = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('http'),
    name: z.string().trim().min(1).max(40),
    url: IntegrationUrl,
    /** Sent as `Authorization: Bearer …`. Leave empty to sign in with OAuth (or nothing). */
    token: z.string().trim().max(4096).optional(),
  }),
  z.object({
    type: z.literal('stdio'),
    name: z.string().trim().min(1).max(40),
    command: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .regex(/^[^\r\n\0]+$/),
    args: z
      .array(
        z
          .string()
          .max(4096)
          .regex(/^[^\0]*$/),
      )
      .max(64)
      .default([]),
    /** Environment variables for the command; values are stored as secrets. */
    env: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.string().max(4096))
      .default({}),
  }),
]);
export type CustomIntegration = z.infer<typeof CustomIntegration>;

/** Bring a server a provider set up by itself into Conch, by the provider and its name. */
export const AdoptIntegrationBody = z.object({
  provider: EngineId,
  name: z.string().min(1).max(200),
});
export type AdoptIntegrationBody = z.infer<typeof AdoptIntegrationBody>;

export const CreateIntegrationBody = z.union([
  z.object({ catalogId: z.string().min(1).max(64), values: FieldValues.default({}) }),
  z.object({ custom: CustomIntegration }),
]);
export type CreateIntegrationBody = z.infer<typeof CreateIntegrationBody>;

export const UpdateIntegrationBody = z
  .object({
    name: z.string().trim().min(1).max(40),
    enabled: z.boolean(),
    policy: IntegrationPolicy,
    /** `null` clears a tool's override. */
    tools: z.record(z.string().min(1).max(128), ToolPolicy.nullable()),
    /** New field values (secrets included); omitted keys keep their value. */
    values: FieldValues,
  })
  .partial();
export type UpdateIntegrationBody = z.infer<typeof UpdateIntegrationBody>;

/** Created, or asked to sign in: open `authorizeUrl` to finish. */
export const IntegrationResult = z.object({
  integration: Integration,
  authorizeUrl: z.string().optional(),
});
export type IntegrationResult = z.infer<typeof IntegrationResult>;

/** Plain-language labels shared by the UI and the agent's prompt. */
export const POLICY_LABELS: Record<IntegrationPolicy, string> = {
  ask: 'Ask every time',
  'ask-writes': 'Ask before changes',
  trust: 'Don’t ask',
};

/** Whether a tool call needs a person, given the integration's policy. */
export function toolDecision(
  integration: Pick<Integration, 'policy' | 'tools'>,
  toolName: string,
): 'allow' | 'ask' | 'off' {
  const tool = integration.tools.find((t) => t.name === toolName);
  if (tool?.policy === 'off') return 'off';
  if (tool?.policy === 'allow') return 'allow';
  if (tool?.policy === 'ask') return 'ask';
  if (integration.policy === 'trust') return 'allow';
  if (integration.policy === 'ask-writes' && tool?.access === 'read' && !tool.destructive)
    return 'allow';
  return 'ask';
}
