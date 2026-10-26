/**
 * How long one app call may hold a turn, the same for every engine: the
 * bridge passes these to the MCP client, Claude Code gets them in its
 * environment (`engines/claude-code/env.ts`).
 */

/**
 * How long a call may go without a word from the app. A code-mode server
 * (Cloudflare's `execute`) can work for a while, and progress it reports
 * keeps the call alive; silence this long means it's stuck.
 */
export const CALL_IDLE_MS = 180_000;
/** However much progress it reports, no single call holds the turn longer than this. */
export const CALL_MAX_MS = 600_000;
