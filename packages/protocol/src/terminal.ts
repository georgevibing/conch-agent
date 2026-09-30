/**
 * The terminal — real shells on the host, in a panel (ADR 0015).
 *
 * - REST `/api/terminal…` for status, settings, and opening or closing terminals;
 * - `POST /api/terminal/:id/ticket` for a one-time ticket, then
 *   `/api/terminal/live?ticket=…` (its own WebSocket) for the screen: output as
 *   binary frames, input and resizes as JSON;
 * - `terminal.changed` on the main socket when terminals come or go.
 */
import { z } from 'zod';

import { Id } from './common';

export const TerminalShell = z.object({
  /** `pwsh`, `powershell`, `cmd`, `zsh`, `bash`… */
  id: z.string(),
  /** "PowerShell 7", "zsh". */
  name: z.string(),
  path: z.string(),
});
export type TerminalShell = z.infer<typeof TerminalShell>;

export const TerminalSettings = z.object({
  enabled: z.boolean().default(true),
  /** Other devices may open terminals (each time with a recent password or key). Off by default. */
  allowRemote: z.boolean().default(false),
  /** A shell id, or `auto` for your usual one. */
  shell: z.string().max(40).default('auto'),
  fontSize: z.number().int().min(9).max(28).default(13),
  cursorBlink: z.boolean().default(true),
  /** Make output readable by screen readers (xterm's screen reader mode). */
  screenReader: z.boolean().default(false),
});
export type TerminalSettings = z.infer<typeof TerminalSettings>;

export const UpdateTerminalSettingsBody = z
  .object({
    enabled: z.boolean(),
    allowRemote: z.boolean(),
    shell: z.string().max(40),
    fontSize: z.number().int().min(9).max(28),
    cursorBlink: z.boolean(),
    screenReader: z.boolean(),
  })
  .partial();
export type UpdateTerminalSettingsBody = z.infer<typeof UpdateTerminalSettingsBody>;

export const TerminalInfo = z.object({
  id: Id,
  /** What the shell calls itself (its title), else the folder. */
  title: z.string(),
  shell: z.string(),
  cwd: z.string(),
  createdAt: z.number(),
  status: z.enum(['running', 'exited']),
  exitCode: z.number().optional(),
  /** Started without your shell profile (after a profile broke it). */
  safeMode: z.boolean().default(false),
  /** It exited within moments of starting with an error: usually a broken profile. */
  endedEarly: z.boolean().optional(),
  /** Opened on this computer, or from another device. */
  openedFrom: z.enum(['this-computer', 'another-device']),
});
export type TerminalInfo = z.infer<typeof TerminalInfo>;

/** How terminals run here. `pty`: a real terminal; `python`/`basic`: fallbacks. */
export const TerminalBackend = z.enum(['pty', 'python', 'basic', 'none']);
export type TerminalBackend = z.infer<typeof TerminalBackend>;

export const TerminalStatus = z.object({
  /** Terminals can be opened from the device asking (settings, where it is, the backend). */
  available: z.boolean(),
  /** Why not, in one sentence, when not. */
  unavailable: z.string().optional(),
  backend: TerminalBackend,
  settings: TerminalSettings,
  shells: z.array(TerminalShell),
  terminals: z.array(TerminalInfo),
  /** The device asking isn't this computer. */
  remote: z.boolean(),
  /** What Conch fixed on its own lately, newest first. */
  healed: z.array(z.object({ at: z.number(), message: z.string() })).default([]),
});
export type TerminalStatus = z.infer<typeof TerminalStatus>;

export const CreateTerminalBody = z.object({
  shell: z.string().max(40).optional(),
  cwd: z.string().max(4096).optional(),
  /** Start without your shell profile (`-NoProfile`, `--noprofile --norc`, `-f`). */
  safeMode: z.boolean().optional(),
  cols: z.number().int().min(2).max(1000).optional(),
  rows: z.number().int().min(1).max(500).optional(),
});
export type CreateTerminalBody = z.infer<typeof CreateTerminalBody>;

export const TerminalTicket = z.object({
  /** One use, for about a minute: `/api/terminal/live?ticket=…`. */
  ticket: z.string(),
  terminal: TerminalInfo,
});
export type TerminalTicket = z.infer<typeof TerminalTicket>;

// ── Live: /api/terminal/live?ticket=… ────────────────────────────────────

/** Server → client, as text frames. Output arrives as binary frames (UTF-8). */
export const TerminalLiveEvent = z.discriminatedUnion('type', [
  /** Attached. Scrollback follows as binary frames, then live output. */
  z.object({ type: z.literal('ready'), terminal: TerminalInfo }),
  z.object({ type: z.literal('title'), title: z.string().max(400) }),
  z.object({ type: z.literal('exit'), code: z.number(), signal: z.number().optional() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type TerminalLiveEvent = z.infer<typeof TerminalLiveEvent>;

/** Client → server. */
export const TerminalLiveCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(65_536) }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(1).max(500),
  }),
]);
export type TerminalLiveCommand = z.infer<typeof TerminalLiveCommand>;
