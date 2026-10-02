import {
  Badge,
  Callout,
  ChannelSoon,
  Handset,
  IntegrationLogo,
  LinkCard,
  LinkedDevicesSketch,
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
      {(
        PERSONAL[channel.id] ?? [
          'A bot of your own',
          'No public address',
          'Private chats only',
          'Nobody gets in unless you let them',
        ]
      ).map((fact) => (
        <li key={fact}>
          <Badge tone="neutral">{fact}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** Channels through an account that's already yours (ADR 0044): no bot, and strangers never hear back. */
const PERSONAL: Record<string, string[]> = {
  whatsapp: [
    'Your own account, linked',
    'No public address',
    'Only the chat with yourself',
    'Nobody gets in unless you let them',
  ],
  signal: [
    'Your own account, linked',
    'No public address',
    'Only Note to Self',
    'Nobody gets in unless you let them',
  ],
  imessage: [
    'Only on a Mac',
    'Nothing to make',
    'Reads only the chat with yourself',
    'Others’ chats never read',
  ],
  email: [
    'Your own address',
    'Reads only mail to you+conch',
    'Checks who really sent it',
    'Others’ chats never read',
  ],
};

const BOT = 'Conch';
const KEY = '7312945602:AAHf3kX9…';
/** What your assistant writes in the chat with yourself once linked (`channels/service.ts`). */
const SELF_WELCOME = `Hi Ada! 👋 I’m ${BOT}, and I’m connected to Conch on your computer. Write to me here, in the chat with yourself.`;

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
  whatsapp: {
    link: () => (
      <LinkedDevicesSketch
        label="Linked devices in WhatsApp, with Link a device to press"
        color={colorOf('whatsapp')}
        action="Link a device"
        note="Your personal messages are end-to-end encrypted on all your devices."
        alive
      />
    ),
    hello: () => (
      <Handset
        label="Message yourself in WhatsApp, where you talk to your assistant"
        brand="whatsapp"
        color={colorOf('whatsapp')}
        title="Ada Lovelace (You)"
        subtitle="Message yourself"
        messages={[
          { id: '1', from: 'you', text: SELF_WELCOME },
          { id: '2', from: 'you', text: 'What’s on my calendar tomorrow?' },
        ]}
        footer={<Handset.Composer />}
      />
    ),
  },
  signal: {
    link: () => (
      <LinkedDevicesSketch
        label="Linked devices in Signal, with Link a new device to press"
        color={colorOf('signal')}
        action="Link a new device"
        alive
      />
    ),
    hello: () => (
      <Handset
        label="Note to Self in Signal, where you talk to your assistant"
        brand="signal"
        color={colorOf('signal')}
        title="Note to Self"
        messages={[
          { id: '1', from: 'you', text: SELF_WELCOME },
          { id: '2', from: 'you', text: 'Did the build pass?' },
        ]}
        footer={<Handset.Composer />}
      />
    ),
  },
  imessage: {
    key: () => (
      <PortalSketch
        label="System Settings on your Mac, on Full Disk Access"
        address="System Settings"
        nav={['General', 'Privacy & Security', 'Notifications']}
        active="Privacy & Security"
        title="Full Disk Access"
        color={colorOf('imessage')}
      >
        <PortalSketch.Bar width={70} />
        <PortalSketch.Toggle label="Terminal" press />
        <PortalSketch.Bar width={45} />
      </PortalSketch>
    ),
    hello: () => (
      <Handset
        label="Messages on your iPhone: the chat with yourself"
        brand="imessage"
        color={colorOf('imessage')}
        title="Ada Lovelace"
        subtitle="iMessage · you"
        messages={[
          { id: '1', from: 'them', text: WELCOME },
          { id: '2', from: 'you', text: 'what’s on today?' },
          {
            id: '3',
            from: 'them',
            text: 'I’d like to look at your calendar. Reply yes to allow it, or no.',
          },
          { id: '4', from: 'you', text: 'yes' },
        ]}
        footer={<Handset.Composer placeholder="iMessage" />}
      />
    ),
  },
  email: {
    key: () => (
      <PortalSketch
        label="Google’s App passwords page"
        address="myaccount.google.com/apppasswords"
        title="App passwords"
        color={colorOf('email')}
      >
        <PortalSketch.Field label="App name">Conch</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>Create</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Field label="Your app password">abcd efgh ijkl mnop</PortalSketch.Field>
      </PortalSketch>
    ),
    hello: () => (
      <Handset
        label="Mail on your phone: writing to your assistant"
        brand="email"
        color={colorOf('email')}
        title="ada+conch@gmail.com"
        subtitle="Re: Friday"
        messages={[
          { id: '1', from: 'you', text: 'Can you find a table for four on Friday?' },
          {
            id: '2',
            from: 'them',
            text: 'Two places have room at 8: Ottolenghi and Dishoom. Want me to book one?',
          },
        ]}
        footer={<Handset.Composer placeholder="Reply" />}
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
