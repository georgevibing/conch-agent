/**
 * How the chat names a call to one of Conch's own apps' tools (ADR 0060): the
 * app it belongs to (its catalog id, for the logo) and what it did, the way a
 * person would say it: "Looking at your calendar" while it runs, "Looked at
 * your calendar" once it's done. The tools themselves are declared by the
 * apps that run them (`google/apps.ts`, `slack/service.ts`), by these names.
 */
import { z } from 'zod';

import type { ToolView } from './chat-cards';
import { type GoogleAppId } from './google';
import { SlackToolName } from './slack';

/** Every tool of Conch's own Google apps (ADR 0048), by its own name. */
export const GoogleToolName = z.enum([
  'google_mail_search',
  'google_mail_read',
  'google_mail_create_draft',
  'google_calendar_briefing',
  'google_drive_search',
  'google_drive_read',
]);
export type GoogleToolName = z.infer<typeof GoogleToolName>;

export type AppToolName = GoogleToolName | SlackToolName;

interface AppToolWords {
  /** The app's catalog id. */
  app: GoogleAppId | 'slack';
  /** While it runs. */
  doing: string;
  /** Once it's done (or stopped, or failed: the row says which). */
  done: string;
  /** Where it happened, when that's worth saying instead: "Read #design". */
  at?: { doing: string; done: string };
}

export const APP_TOOL_WORDS: Record<AppToolName, AppToolWords> = {
  google_mail_search: { app: 'gmail', doing: 'Searching your mail', done: 'Searched your mail' },
  google_mail_read: { app: 'gmail', doing: 'Reading an email', done: 'Read an email' },
  google_mail_create_draft: { app: 'gmail', doing: 'Saving a draft', done: 'Saved a draft' },
  google_calendar_briefing: {
    app: 'google-calendar',
    doing: 'Looking at your calendar',
    done: 'Looked at your calendar',
  },
  google_drive_search: { app: 'google-drive', doing: 'Searching Drive', done: 'Searched Drive' },
  google_drive_read: {
    app: 'google-drive',
    doing: 'Reading a file’s details',
    done: 'Read a file’s details',
  },
  slack_channels: {
    app: 'slack',
    doing: 'Looking at your channels',
    done: 'Looked at your channels',
  },
  slack_search: { app: 'slack', doing: 'Searching Slack', done: 'Searched Slack' },
  slack_read_channel: {
    app: 'slack',
    doing: 'Catching up on a channel',
    done: 'Caught up on a channel',
    at: { doing: 'Reading', done: 'Read' },
  },
  slack_send_message: {
    app: 'slack',
    doing: 'Sending a message',
    done: 'Sent a message',
  },
};

/** What a call to one of Conch's own app tools is called in the chat, or undefined for any other tool. */
export function appToolLine(
  /** As the engine reports it: `mcp__conch__google_…` (Claude Code) or bare. */
  toolName: string,
  { running, input, view }: { running: boolean; input?: unknown; view?: ToolView | undefined },
): { app: AppToolWords['app']; title: string; summary?: string } | undefined {
  const name = toolName.replace(/^mcp__conch__/, '');
  if (!Object.hasOwn(APP_TOOL_WORDS, name)) return undefined;
  const words = APP_TOOL_WORDS[name as AppToolName];
  const args = (input ?? {}) as Record<string, unknown>;
  // Where: the place the result names ("#design"), never an id from the input.
  const place = view?.kind === 'messages' ? view.place : undefined;
  const title =
    words.at && place
      ? `${running ? words.at.doing : words.at.done} ${place}`
      : running
        ? words.doing
        : words.done;
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 80) : '';
  return { app: words.app, title, ...(query && { summary: `“${query}”` }) };
}
