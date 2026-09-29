/**
 * The engine — the agent runtime Conch delegates to, and what it can do.
 *
 * Providers (`providers.ts`) wrap these with the copy and connection details
 * the UI needs; everything here is what the gateway and the engines agree on.
 */
import { z } from 'zod';

import { EffortChoice, PermissionMode } from './common';

/**
 * Engines Conch can drive. Only `claude-code` ships today; the rest are
 * reserved so the data model, settings and UI never need a migration.
 */
export const EngineId = z.enum(['claude-code', 'codex-cli', 'anthropic-api', 'openrouter', 'mock']);
export type EngineId = z.infer<typeof EngineId>;

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
  commands: z.array(EngineCommand),
  permissionModes: z.array(PermissionMode),
});
export type Capabilities = z.infer<typeof Capabilities>;
