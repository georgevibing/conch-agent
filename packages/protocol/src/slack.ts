/**
 * Slack, connected to Conch itself (ADR 0049) — so it works with every model,
 * whatever provider answers. Conch keeps one user token (`xoxp-…`) from a
 * Slack app the person made in their own workspace (the same app the Slack
 * channel uses, when there is one), sealed on this computer, and gives every
 * provider the same few tools: list and read the channels you're in, search,
 * and send a message — which always asks first.
 *
 * The token never appears here: the browser sends it once and only learns
 * who it belongs to.
 */
import { z } from 'zod';

/**
 * What the token must be allowed to do (the `user` scopes in the app's
 * settings). One list for the Slack app's settings and for the check that
 * says which are missing.
 */
export const SLACK_USER_SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'search:read',
  'users:read',
  'chat:write',
] as const;

export const SlackToolName = z.enum([
  'slack_channels',
  'slack_search',
  'slack_read_channel',
  'slack_send_message',
]);
export type SlackToolName = z.infer<typeof SlackToolName>;

/** A Slack app Conch already knows (the Slack channel's), offered for this too. */
export const SlackChannelApp = z.object({
  /** The app's name in Slack, as the channel shows it. */
  name: z.string(),
  workspace: z.string().optional(),
  /** For links straight to the app's own settings pages. */
  appId: z
    .string()
    .regex(/^A[A-Z0-9]{6,20}$/)
    .optional(),
});
export type SlackChannelApp = z.infer<typeof SlackChannelApp>;

/** What the connect dialog can offer (`GET /api/slack/setup`). */
export const SlackSetup = z.object({
  /** Set when a Slack channel is connected and its app could be used for this too. */
  channelApp: SlackChannelApp.optional(),
});
export type SlackSetup = z.infer<typeof SlackSetup>;

/** A Slack user token: `xoxp-` and the digits and letters Slack gives it. */
export const SLACK_USER_TOKEN = /^xoxp-[A-Za-z0-9-]{20,250}$/;

export const SlackConnectBody = z.object({ token: z.string().trim().min(1).max(400) });
export type SlackConnectBody = z.infer<typeof SlackConnectBody>;
