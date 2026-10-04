/**
 * Writing to you in your chat apps: the assistant's `message_user`. Any chat
 * app you talk to Conch from (Telegram, WhatsApp, Slack, Discord, Signal,
 * email…) can carry a message Conch starts — "text me when it's done", a
 * routine that sends you the weather. It only ever reaches your own private
 * chat with Conch there, so nobody else can be written to, whatever the chat
 * has read.
 */
import { z } from 'zod';

import type { ConversationSummary } from '@conch/protocol';

import type { HostTool } from '../engines/types';
import type { ChannelService } from './service';

/** A turn that loops can't flood your phone. */
const PER_TURN = 5;

export function channelTools(
  channels: Pick<ChannelService, 'reachable' | 'messageOwner'>,
  ctx: { conversationId: string; origin?: ConversationSummary['origin'] },
): HostTool[] {
  const apps = channels.reachable();
  if (!apps.length) return [];
  const names = [...new Set(apps.map((a) => a.name))];
  const from = ctx.origin?.kind === 'channel' ? ctx.origin : undefined;
  let sent = 0;

  const tool: HostTool<{ text: z.ZodString; app: z.ZodOptional<z.ZodString> }> = {
    name: 'message_user',
    description: [
      `Send the user a message in one of their chat apps: ${names.join(', ')}. It goes to their own private chat with you there, nobody else.`,
      'Use it when they ask to be messaged, texted, pinged or told there ("telegram me…", "send it to my WhatsApp"), or when a routine’s instructions say to send something there. Write the message itself, in Markdown, as they should read it.',
      `Leave out \`app\` to use the app they wrote from last${names.length === 1 ? '' : ', or name one'}.`,
      from
        ? 'This chat already came from a chat app: your ordinary reply reaches them there, so use this only for a different app.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    searchHint: ['message', 'text', 'send', 'notify', 'chat app', ...names].join(' '),
    // Small and often what a routine is for: never hidden behind a search.
    alwaysLoad: true,
    input: {
      text: z.string().trim().min(1).max(4000),
      app: z.string().max(40).optional(),
    },
    async run({ text, app }) {
      if (sent >= PER_TURN)
        return `Not sent: that’s ${PER_TURN} messages this turn already. Put the rest in your reply.`;
      try {
        const done = await channels.messageOwner(text, {
          ...(app && { app }),
          conversationId: ctx.conversationId,
        });
        sent += 1;
        return `Sent to the user on ${done.app}.`;
      } catch (error) {
        return `Not sent: ${(error as Error).message} Say so in your reply, and that they can connect a chat app in Apps.`;
      }
    },
  };
  return [tool as HostTool];
}
