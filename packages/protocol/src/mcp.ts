/**
 * Other apps using Conch (ADR 0073): Claude Desktop, Cursor, VS Code and any
 * other app that speaks MCP reach Conch's memory, skills, your apps and the
 * browser through one door on this computer, each paired by you and held to
 * what you let it use.
 */
import { z } from 'zod';

/** One of your apps, as a scope: its integration id (`app:<id>`). */
const AppScope = z.templateLiteral(['app:', z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)]);

/**
 * What a paired app may use. Nothing is implied: an app with `memory.read`
 * can't add memories, and one with `app:gmail` can't reach Slack.
 */
export const McpScope = z.union([
  z.enum([
    /** Search what Conch knows about you. */
    'memory.read',
    /** Suggest something to remember; it waits for your OK. */
    'memory.write',
    /** Your saved skills: list them and read one. */
    'skills',
    /** Conch's browser, in a tab of its own. */
    'browser',
  ]),
  AppScope,
]);
export type McpScope = z.infer<typeof McpScope>;

/** The scopes that aren't one of your apps, in the order a person reads them. */
export const MCP_BASE_SCOPES = ['memory.read', 'memory.write', 'skills', 'browser'] as const;

/** Each scope in a person's words, for the pairing card and the list. */
export const MCP_SCOPE_WORDS: Record<
  (typeof MCP_BASE_SCOPES)[number],
  { title: string; detail: string }
> = {
  'memory.read': {
    title: 'Search what Conch knows about you',
    detail: 'Your memories, found by meaning.',
  },
  'memory.write': {
    title: 'Suggest things to remember',
    detail: 'Each one waits for your OK in What Conch knows.',
  },
  skills: {
    title: 'Use your skills',
    detail: 'Read the instructions you saved. It follows them itself.',
  },
  browser: {
    title: 'Use Conch’s browser',
    detail: 'In a tab of its own. It asks you before each new site, as Conch does.',
  },
};

/** The apps Conch can connect itself to in one press; `other` is any app, set up by hand. */
export const McpClientApp = z.enum(['claude-desktop', 'cursor', 'vscode', 'other']);
export type McpClientApp = z.infer<typeof McpClientApp>;

/** An app paired with Conch. Its key is never here: only a hash of it is kept. */
export const McpClient = z.object({
  id: z.string(),
  /** "Claude Desktop", or what you called it. */
  name: z.string().max(60),
  app: McpClientApp,
  scopes: z.array(McpScope).max(300),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
  /** Its own chat in Conch, where what it did and what it asked are kept. */
  conversationId: z.string().optional(),
  /** It may connect with its key over HTTP, not only through Conch's launcher. */
  http: z.boolean().default(false),
  /** It may come in through your own address, when that's turned on for other apps. */
  remote: z.boolean().default(false),
});
export type McpClient = z.infer<typeof McpClient>;

/** An app on this computer Conch can connect in one press, and whether it is. */
export const McpTarget = z.object({
  app: McpClientApp.exclude(['other']),
  name: z.string(),
  /** The app is on this computer (its settings folder is there). */
  found: z.boolean(),
  /** Its settings name Conch, as Conch wrote it. */
  connected: z.boolean(),
  /** The paired client its settings use. */
  clientId: z.string().optional(),
  /** The settings file Conch writes, to show before it's written. */
  file: z.string(),
});
export type McpTarget = z.infer<typeof McpTarget>;

/** Something a paired app could be allowed to use, for the pairing card. */
export const McpChoice = z.object({
  scope: McpScope,
  title: z.string(),
  detail: z.string().optional(),
  /** An app's catalog id, for its logo. */
  catalogId: z.string().optional(),
  brand: z.string().optional(),
  color: z.string().optional(),
});
export type McpChoice = z.infer<typeof McpChoice>;

export const McpOverview = z.object({
  clients: z.array(McpClient),
  targets: z.array(McpTarget),
  /** Paired apps marked for it may come in through your own address. */
  remote: z.boolean(),
  /** Your own address, when there is one: where a remote app would connect. */
  address: z.string().optional(),
  /** What an app could be allowed to use, now. */
  choices: z.array(McpChoice),
  /** The door on this computer, for an app set up by hand. */
  endpoint: z.string(),
});
export type McpOverview = z.infer<typeof McpOverview>;

export const PairMcpClientBody = z.object({
  app: McpClientApp,
  name: z.string().trim().min(1).max(60).optional(),
  scopes: z.array(McpScope).min(1).max(300),
  /** For `other`: it connects with its key over HTTP (shown once). */
  http: z.boolean().optional(),
  remote: z.boolean().optional(),
});
export type PairMcpClientBody = z.infer<typeof PairMcpClientBody>;

/** How to set up an app by hand: the launcher, and the HTTP door with its key (shown once). */
export const McpSetup = z.object({
  command: z.string(),
  args: z.array(z.string()),
  /** The same, as the `mcpServers` entry most apps take. */
  json: z.string(),
  url: z.string(),
  key: z.string().optional(),
});
export type McpSetup = z.infer<typeof McpSetup>;

export const PairedMcpClient = z.object({
  client: McpClient,
  /** The settings file Conch wrote it into. */
  wrote: z.string().optional(),
  /** What to tell the person next ("Restart Claude Desktop to see Conch."). */
  next: z.string().optional(),
  /** For an app set up by hand. */
  setup: McpSetup.optional(),
});
export type PairedMcpClient = z.infer<typeof PairedMcpClient>;

export const UpdateMcpClientBody = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    scopes: z.array(McpScope).min(1).max(300).optional(),
    remote: z.boolean().optional(),
  })
  .refine((b) => b.name !== undefined || b.scopes !== undefined || b.remote !== undefined, {
    message: 'Nothing to change.',
  });
export type UpdateMcpClientBody = z.infer<typeof UpdateMcpClientBody>;

export const McpRemoteBody = z.object({ on: z.boolean() });
export type McpRemoteBody = z.infer<typeof McpRemoteBody>;
