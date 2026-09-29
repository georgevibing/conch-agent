/**
 * @conch/protocol — every message exchanged between the browser and the gateway.
 *
 * Both sides MUST parse incoming data with these schemas (`ClientCommand.parse`,
 * `ServerEvent.parse`); types are inferred from the schemas so they never drift.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

// ── Shared ──────────────────────────────────────────────────────────────────

export const SessionId = z.string().min(1).max(128);
export type SessionId = z.infer<typeof SessionId>;

export const PermissionMode = z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
export type PermissionMode = z.infer<typeof PermissionMode>;

export const SessionStatus = z.enum(['idle', 'running', 'awaiting-permission', 'error', 'closed']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const Attachment = z.object({
  name: z.string().max(512),
  mediaType: z.string().max(128),
  /** Base64 payload for small files; large files go through the upload endpoint. */
  data: z.string().optional(),
  uploadId: z.string().optional(),
});
export type Attachment = z.infer<typeof Attachment>;

// ── Client → server ─────────────────────────────────────────────────────────

export const ClientCommand = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.create'),
    requestId: z.string(),
    cwd: z.string().min(1),
    /** Resume an existing Claude Code session (e.g. one started in the terminal). */
    resume: SessionId.optional(),
    permissionMode: PermissionMode.default('default'),
    model: z.string().optional(),
  }),
  z.object({
    type: z.literal('session.subscribe'),
    sessionId: SessionId,
    /** Replay events with `seq` greater than this. Omit for the full buffer. */
    afterSeq: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('session.unsubscribe'),
    sessionId: SessionId,
  }),
  z.object({
    type: z.literal('session.send'),
    sessionId: SessionId,
    text: z.string().max(200_000),
    attachments: z.array(Attachment).max(20).default([]),
  }),
  z.object({
    type: z.literal('session.interrupt'),
    sessionId: SessionId,
  }),
  z.object({
    type: z.literal('session.setMode'),
    sessionId: SessionId,
    permissionMode: PermissionMode,
  }),
  z.object({
    type: z.literal('permission.respond'),
    sessionId: SessionId,
    permissionId: z.string(),
    decision: z.enum(['allow', 'allow-always', 'deny']),
    /** Optional note returned to Claude when denying. */
    message: z.string().max(4000).optional(),
  }),
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

// ── Server → client ─────────────────────────────────────────────────────────

const base = { sessionId: SessionId, seq: z.number().int().nonnegative(), at: z.number() };

export const ToolStatus = z.enum(['pending', 'running', 'success', 'error']);
export type ToolStatus = z.infer<typeof ToolStatus>;

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number().int(),
    serverVersion: z.string(),
  }),
  z.object({
    type: z.literal('session.created'),
    requestId: z.string(),
    sessionId: SessionId,
  }),
  z.object({
    ...base,
    type: z.literal('session.state'),
    status: SessionStatus,
    permissionMode: PermissionMode,
    cwd: z.string(),
    model: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('message.user'),
    messageId: z.string(),
    text: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('message.delta'),
    messageId: z.string(),
    kind: z.enum(['text', 'thinking']),
    delta: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('message.complete'),
    messageId: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('tool.started'),
    toolUseId: z.string(),
    messageId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    ...base,
    type: z.literal('tool.finished'),
    toolUseId: z.string(),
    status: ToolStatus,
    output: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('permission.requested'),
    permissionId: z.string(),
    toolUseId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    /** Human-readable reason Claude Code gave for asking, if any. */
    reason: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('permission.resolved'),
    permissionId: z.string(),
    decision: z.enum(['allow', 'allow-always', 'deny', 'timeout']),
  }),
  z.object({
    ...base,
    type: z.literal('result'),
    outcome: z.enum(['success', 'interrupted', 'error', 'max-turns']),
    usage: Usage,
  }),
  z.object({
    type: z.literal('error'),
    sessionId: SessionId.optional(),
    requestId: z.string().optional(),
    code: z.enum(['bad-request', 'unauthorized', 'not-found', 'conflict', 'internal']),
    message: z.string(),
  }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;

/** Events that belong to a session's ordered log (they carry `seq`). */
export type SessionEvent = Extract<ServerEvent, { seq: number }>;

export function isSessionEvent(event: ServerEvent): event is SessionEvent {
  return 'seq' in event;
}
