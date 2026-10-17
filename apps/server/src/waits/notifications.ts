import type { ChannelService } from '../channels/service';
import type { WaitServiceDeps } from './service';

/** A wait's one requested app, independent of routine notification preferences. */
export function waitNotifications(
  channels: () => Pick<ChannelService, 'sendable' | 'messageOwner'>,
): Pick<WaitServiceDeps, 'notificationTarget' | 'tell'> {
  return {
    notificationTarget: async (app) => {
      const wanted = app.trim().toLowerCase();
      const choices = (await channels().sendable()).filter(
        (c) => c.id === app || c.kind.toLowerCase() === wanted || c.name.toLowerCase() === wanted,
      );
      if (choices.length !== 1)
        throw new Error(
          choices.length
            ? 'More than one account matches that app. Ask which account to notify.'
            : 'That notification app is not connected. Keep the result in this chat or ask the person to choose another app.',
        );
      const chosen = choices[0];
      if (!chosen) throw new Error('No notification destination selected.');
      return { id: chosen.id, name: chosen.name };
    },
    tell: async ({ title, body, conversationId, notification }) => {
      await channels().messageOwner(`**${title}**\n${body}`, {
        channelId: notification.id,
        conversationId,
      });
    },
  };
}
