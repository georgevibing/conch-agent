import {
  Badge,
  Callout,
  ChannelSoon,
  Handset,
  IntegrationLogo,
  LinkCard,
  PortalSketch,
} from '@conch/nacre';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import reference from 'virtual:conch-reference';

import type { ChannelRef } from '../../reference/types';
import styles from './embeds.module.css';

const minutes = (channel: ChannelRef) =>
  channel.minutes ? `About ${channel.minutes} min` : undefined;

/** The chat apps you can connect today, and the ones that are coming. */
export function ChannelGrid() {
  const ready = reference.channels.filter((channel) => channel.available);
  const soon = reference.channels.filter((channel) => !channel.available);
  return (
    <div className={styles.stack}>
      <div className={styles.grid}>
        {ready.map((channel, index) => (
          <LinkCard
            key={channel.id}
            index={index}
            icon={
              <IntegrationLogo
                brand={channel.id}
                name={channel.name}
                color={channel.color}
                decorative
              />
            }
            title={channel.name}
            meta={minutes(channel)}
            description={channel.tagline}
            asChild
          >
            <Link to={`/channels/${channel.id}`} />
          </LinkCard>
        ))}
      </div>
      {soon.length > 0 && (
        <ChannelSoon
          apps={soon.map((channel) => ({
            brand: channel.id,
            name: channel.name,
            color: channel.color,
          }))}
        />
      )}
    </div>
  );
}

/** One channel at a glance: how long it takes, and what holds for every channel. */
export function ChannelFacts({ id }: { id: string }) {
  const channel = reference.channels.find((c) => c.id === id);
  if (!channel)
    return (
      <Callout tone="danger" title={`There’s no channel “${id}”`}>
        The channels are listed in apps/server/src/channels/catalog.ts.
      </Callout>
    );
  return (
    <ul className={styles.chips} aria-label={`${channel.name} at a glance`}>
      {channel.minutes && (
        <li>
          <Badge tone="accent">About {channel.minutes} minutes</Badge>
        </li>
      )}
      <li>
        <Badge tone="neutral">A bot of your own</Badge>
      </li>
      <li>
        <Badge tone="neutral">No public address</Badge>
      </li>
      <li>
        <Badge tone="neutral">Private chats only</Badge>
      </li>
      <li>
        <Badge tone="neutral">Nobody gets in unless you let them</Badge>
      </li>
    </ul>
  );
}

const BOT = 'Conch';
const KEY = '7312945602:AAHf3kX9…';
/** What the bot says once it knows you (`channels/service.ts`). */
const WELCOME = `Hi Ada! 👋 I’m ${BOT}, and I’m connected to Conch on your computer. Ask me anything.`;

/**
 * What you'll see in the other app while you set a channel up, drawn with the
 * same pictures Conch shows beside its own steps.
 */
const SCENES: Record<string, Record<string, () => ReactNode>> = {
  telegram: {
    key: () => (
      <Handset
        label="BotFather in Telegram, replying with your bot’s key"
        brand="telegram"
        color={colorOf('telegram')}
        title="BotFather"
        subtitle="bot"
        messages={[
          { id: '1', from: 'you', text: '/newbot' },
          { id: '2', from: 'them', text: 'Alright, a new bot. How are we going to call it?' },
          { id: '3', from: 'you', text: `${BOT} for Ada` },
          {
            id: '4',
            from: 'them',
            text: (
              <>
                <p>Done! Congratulations on your new bot.</p>
                <p>
                  Use this token to access the HTTP API:
                  <br />
                  <Handset.Key>{KEY}</Handset.Key>
                </p>
              </>
            ),
          },
        ]}
        footer={<Handset.Composer />}
      />
    ),
    hello: () => (
      <Handset
        label="Your bot in Telegram, waiting for your hello"
        brand="telegram"
        color={colorOf('telegram')}
        title={`${BOT} for Ada`}
        subtitle="bot"
        alive
        messages={[
          {
            id: '1',
            from: 'them',
            text: `I’m ${BOT}. I run on your computer through Conch and can do everything there. I’m private: only people who were let in can talk to me.`,
          },
        ]}
        footer={<Handset.Action>START</Handset.Action>}
      />
    ),
  },
  discord: {
    key: () => (
      <PortalSketch
        label="Your app’s Bot page in the Discord Developer Portal"
        address="discord.com/developers/applications"
        nav={['General Information', 'Installation', 'OAuth2', 'Bot']}
        active="Bot"
        title="Bot"
        color={colorOf('discord')}
      >
        <PortalSketch.Bar width={60} />
        <PortalSketch.Field label="Token" />
        <PortalSketch.Row>
          <PortalSketch.Button>Reset Token</PortalSketch.Button>
          <PortalSketch.Button quiet>Copy</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Bar width={80} />
      </PortalSketch>
    ),
    hello: () => (
      <Handset
        label="Your bot in Discord, once Conch knows it’s you"
        brand="discord"
        color={colorOf('discord')}
        title={BOT}
        subtitle="bot"
        messages={[
          { id: '1', from: 'you', text: 'hi' },
          { id: '2', from: 'them', text: WELCOME },
        ]}
        footer={<Handset.Composer placeholder={`Message @${BOT}`} />}
      />
    ),
  },
  slack: {
    key: () => (
      <PortalSketch
        label="Your Slack app, on Install App"
        address="api.slack.com/apps"
        nav={['Basic Information', 'Socket Mode', 'Install App']}
        active="Install App"
        title="Install App"
        color={colorOf('slack')}
      >
        <PortalSketch.Row>
          <PortalSketch.Button>Install to Workspace</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Field label="Bot User OAuth Token">xoxb-1234-5678-AbCdEf…</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button quiet>Copy</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    ),
    hello: () => (
      <Handset
        label="Your app in Slack, once Conch knows it’s you"
        brand="slack"
        color={colorOf('slack')}
        title={BOT}
        subtitle="App"
        messages={[
          { id: '1', from: 'you', text: 'hi' },
          { id: '2', from: 'them', text: WELCOME },
        ]}
        footer={<Handset.Composer placeholder={`Message ${BOT}`} />}
      />
    ),
  },
};

function colorOf(id: string): string | undefined {
  return reference.channels.find((channel) => channel.id === id)?.color;
}

/** Every scene a page may ask for, as `channel scene`; `content.test.ts` checks pages against it. */
export const CHANNEL_SCENES: readonly string[] = Object.entries(SCENES).flatMap(([id, scenes]) =>
  Object.keys(scenes).map((scene) => `${id} ${scene}`),
);

export function ChannelScene({ id, scene = 'key' }: { id: string; scene?: string }) {
  const draw = SCENES[id]?.[scene];
  if (!draw)
    return (
      <Callout tone="danger" title={`There’s no picture “${id} ${scene}”`}>
        The pictures are in apps/docs/src/embeds/channels.tsx.
      </Callout>
    );
  return <div className={styles.scene}>{draw()}</div>;
}
