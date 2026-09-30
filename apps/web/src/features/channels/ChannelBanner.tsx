import { IntegrationLogo } from '@conch/nacre';
import { Link } from 'react-router';

import { useConversations } from '../../api/queries';
import styles from '../routines/Routines.module.css';
import { APPS } from './describe';
import { useChannels } from './queries';

/**
 * A chat that started in a chat app says so at the top: answers to what you
 * send from there go back there, and anything typed here stays in Conch.
 */
export function ChannelBanner({ conversationId }: { conversationId?: string }) {
  const { data: conversations } = useConversations();
  const { data: channels } = useChannels();
  const origin = conversations?.find((c) => c.id === conversationId)?.origin;
  if (origin?.kind !== 'channel') return null;
  const app = APPS[origin.channel];
  const channel = channels?.channels.find((c) => c.id === origin.channelId);
  const bot = channel?.bot.username ? `@${channel.bot.username}` : (channel?.bot.name ?? app.name);
  return (
    <div className={styles.runBanner} role="note">
      <IntegrationLogo
        brand={origin.channel}
        name={app.name}
        color={app.color}
        size="xs"
        decorative
      />
      <span>
        From {app.name}. Answers to what you send {bot} go back there; what you write here stays in
        Conch.
      </span>
      {channel && <Link to={`/channels/${channel.id}`}>See channel</Link>}
    </div>
  );
}
