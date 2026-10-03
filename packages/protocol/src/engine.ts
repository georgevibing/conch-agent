/**
 * The engine — the agent runtime Conch delegates to, and what it can do.
 *
 * Providers (`providers.ts`) wrap these with the copy and connection details
 * the UI needs; everything here is what the gateway and the engines agree on.
 */
import { z } from 'zod';

import { EffortChoice, EngineId, PermissionMode } from './common';

export const EngineState = z.enum([
  /** Detection in progress. */
  'checking',
  /** The engine's CLI couldn't be found on this machine. */
  'not-installed',
  /** Installed, but no credentials. */
  'signed-out',
  /** Installed and authenticated — ready to chat. */
  'ready',
  /** Something unexpected (e.g. the CLI crashed while probing). */
  'error',
]);
export type EngineState = z.infer<typeof EngineState>;

export const AuthMethod = z.enum([
  'subscription',
  'console',
  'api-key',
  'bedrock',
  'vertex',
  'foundry',
  'other',
]);
export type AuthMethod = z.infer<typeof AuthMethod>;

export const InstallHint = z.object({
  label: z.string(),
  command: z.string(),
});
export type InstallHint = z.infer<typeof InstallHint>;

export const EngineStatus = z.object({
  engine: EngineId,
  label: z.string(),
  state: EngineState,
  version: z.string().optional(),
  executablePath: z.string().optional(),
  auth: z
    .object({
      method: AuthMethod,
      /** Human description, e.g. "Claude Pro · ada@example.com" or "Amazon Bedrock". */
      description: z.string(),
      email: z.string().optional(),
    })
    .optional(),
  /** Shown when the state needs explaining (errors, odd setups). */
  message: z.string().optional(),
  install: z.array(InstallHint).default([]),
  docsUrl: z.string().optional(),
  /** Whether the engine supports signing in from Conch. */
  canSignIn: z.boolean().default(false),
  /** Conch is using the copy of the program that comes with it: nothing to install. */
  bundled: z.boolean().optional(),
  /**
   * Conch can install or update it itself: the need to offer (see `Readiness`),
   * shown as one button instead of commands to copy.
   */
  fix: z.object({ need: z.string(), kind: z.enum(['install', 'update']) }).optional(),
  checkedAt: z.number(),
});
export type EngineStatus = z.infer<typeof EngineStatus>;

export const LoginMethod = z.enum(['subscription', 'console', 'api-key']);
export type LoginMethod = z.infer<typeof LoginMethod>;

export const LoginState = z.object({
  loginId: z.string(),
  phase: z.enum([
    'starting',
    'waiting-for-browser',
    'needs-code',
    'verifying',
    'done',
    'failed',
    'cancelled',
  ]),
  /** Sign-in page to open if the browser didn't open automatically. */
  url: z.string().optional(),
  /**
   * A short code the provider's sign-in page asks for ("AXC7-NV0ME"), for
   * providers that sign in that way. Shown to the person, who enters it on `url`.
   */
  code: z.string().max(64).optional(),
  message: z.string().optional(),
});
export type LoginState = z.infer<typeof LoginState>;

export const StartLoginBody = z.object({ method: LoginMethod.default('subscription') });
export const LoginCodeBody = z.object({
  // Written to the CLI's stdin: a line break would smuggle in extra input.
  code: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n]+$/, 'The code should be a single line.'),
});
export const ApiKeyBody = z.object({ apiKey: z.string().min(10).max(512) });

// ── Models, thinking and modes ──────────────────────────────────────────────

export const ModelInfo = z.object({
  /** Value passed to the engine (an alias like `opus` or a full id). */
  id: z.string(),
  label: z.string(),
  description: z.string().default(''),
  /** Effort levels this model accepts; empty = no effort control. */
  efforts: z.array(EffortChoice.exclude(['auto'])).default([]),
  supportsFastMode: z.boolean().default(false),
  supportsAutoMode: z.boolean().default(false),
  /** Whether it can look at images. Unset = the provider's `attachments.images`. */
  images: z.boolean().optional(),
  /** Provider-declared function calling support; false means chat only. */
  tools: z.boolean().optional(),
  /**
   * How many tokens it reads at once (its context window), when the provider
   * says — for a model on this computer, the window Conch runs it with.
   */
  context: z.number().int().positive().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export const CommandSource = z.enum(['conch', 'custom', 'engine']);
export type CommandSource = z.infer<typeof CommandSource>;

/** A slash command offered by the engine itself (e.g. Claude Code's /compact). */
export const EngineCommand = z.object({
  name: z.string(),
  description: z.string().default(''),
  argumentHint: z.string().default(''),
});
export type EngineCommand = z.infer<typeof EngineCommand>;

export const Capabilities = z.object({
  engine: EngineId,
  label: z.string(),
  models: z.array(ModelInfo),
  /** Effective host capabilities; individual model support can narrow these. */
  tools: z
    .object({ host: z.boolean(), files: z.boolean(), shell: z.boolean(), approvals: z.boolean() })
    .optional(),
  commands: z.array(EngineCommand),
  /** The modes this provider honours, safest first (see `honouredMode`). */
  permissionModes: z.array(PermissionMode),
  /**
   * What it can do with attachments (ADR 0017). Text always reaches it; `images`:
   * it can look at pictures; `files`: it can open files on this computer (a PDF,
   * a spreadsheet) with its own tools. Absent means neither.
   */
  attachments: z.object({ images: z.boolean(), files: z.boolean() }).optional(),
});
export type Capabilities = z.infer<typeof Capabilities>;

/**
 * The mode a provider actually runs in. Every mode means the same thing with
 * every provider, so one it can't honour isn't stretched to fit: it becomes the
 * provider's first mode, which engines list as their safest. The chat shows
 * this, and the gateway runs it, so the two can never disagree.
 */
export function honouredMode(
  wanted: PermissionMode,
  honoured: readonly PermissionMode[] | undefined,
): PermissionMode {
  const first = honoured?.[0];
  return first && !honoured.includes(wanted) ? first : wanted;
}

/** One provider's offer in the model picker: its capabilities, and why they're empty if they are. */
export const ProviderModels = Capabilities.extend({
  /** Set when the provider is connected but couldn't list its models right now. */
  message: z.string().optional(),
  /** Runs on this computer: works with no internet, spends nothing. */
  local: z.boolean().default(false),
});
export type ProviderModels = z.infer<typeof ProviderModels>;

/**
 * Every connected provider's models at once (ADR 0012). Providers that aren't
 * connected aren't listed: the picker only offers what would work.
 */
export const ModelCatalog = z.object({
  /** The provider new chats start with (`preferences.engine`). */
  default: EngineId,
  providers: z.array(ProviderModels),
});
export type ModelCatalog = z.infer<typeof ModelCatalog>;
