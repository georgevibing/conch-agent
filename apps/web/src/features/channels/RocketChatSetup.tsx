import type { Channel } from '@conch/protocol';
import { Button, GuideSteps, Handset, KeyField, PortalSketch, Text } from '@conch/nacre';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import styles from './Channels.module.css';
import { Answer, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { HelloStep } from './HelloStep';
import { useKeyCheck } from './hooks';

const botName = (assistant: string) =>
  assistant
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 22) || 'conch';

/**
 * Rocket.Chat (ADR 0083): a bot user on your own server, with a personal
 * access token. Conch connects to the server's realtime API from this
 * computer, so no public address.
 */
export function RocketChatSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [made, setMade] = useState(false);
  const [server, setServer] = useState('');
  const [userId, setUserId] = useState('');
  const [token, setToken] = useState('');
  const body =
    server.trim() && userId.trim() && token.trim()
      ? ({ kind: 'rocketchat', server, userId, token } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, `${server}${userId}${token}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();

  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });

  const at = !channel ? (made || token ? 1 : 0) : 2;
  const wrongServer = check && !check.ok && check.field === 'server';

  return (
    <SetupPage
      kind="rocketchat"
      intro="About three minutes. You make a bot user on your Rocket.Chat server and a token for it. Conch connects from this computer, so nothing needs a public address. Only you can talk to it."
      preview={<RocketChatPreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect Rocket.Chat">
        <GuideSteps.Step
          number={1}
          title="Make a bot user and its token"
          state={stepState(0, at)}
          summary="Made"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            In Rocket.Chat, open <b>Administration → Users → New user</b>. Fill it in as below, give
            it the <b>bot</b> role, and save. Then sign in as that user once (or ask whoever runs
            the server) and make a token in <b>Profile → Personal Access Tokens</b>, with{' '}
            <b>Ignore Two Factor Authentication</b> on. Copy the token and the user id it shows.
          </Text>
          <Answer label="Username" value={botName(assistant)} />
          <Answer label="Name" value={assistant} />
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            I have the token
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Paste the address, the user id and the token"
          state={stepState(1, at)}
          summary={channel?.bot.workspace ? `On ${channel.bot.workspace}` : 'Connected'}
        >
          <KeyField
            label="Server address"
            value={server}
            onValueChange={(v) => {
              reset();
              setServer(v);
            }}
            status={wrongServer ? 'error' : 'idle'}
            placeholder="https://chat.example.com"
            description="The address you open Rocket.Chat at."
            error={wrongServer ? check.message : undefined}
            focusOnShow
          />
          <KeyField
            label="User id"
            value={userId}
            onValueChange={(v) => {
              reset();
              setUserId(v.trim());
            }}
            status="idle"
          />
          <KeyField
            label="Personal access token"
            value={token}
            onValueChange={(v) => {
              reset();
              setToken(v.trim());
            }}
            status={error ? 'error' : token ? (wrongServer ? 'idle' : status) : 'idle'}
            checkingLabel="Checking with your server…"
            found={<>Your server accepts it. {busy ? 'Connecting…' : ''}</>}
            error={error ?? (check && !check.ok && !wrongServer ? check.message : undefined)}
          />
        </GuideSteps.Step>
        <GuideSteps.Step number={3} title="Say hello" state={stepState(2, at)}>
          {channel && (
            <HelloStep
              channel={channel}
              onFinish={() => void navigate(`/channels/${channel.id}`)}
            />
          )}
        </GuideSteps.Step>
      </GuideSteps>
      {dialog}
    </SetupPage>
  );
}

function RocketChatPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.rocketchat.color;
  if (at < 2)
    return (
      <PortalSketch
        label="Rocket.Chat, making a personal access token"
        address="chat.example.com/account/tokens"
        nav={['Profile', 'Preferences', 'Personal Access Tokens']}
        active="Personal Access Tokens"
        title="Personal Access Tokens"
        color={color}
      >
        <PortalSketch.Field label="Token name">Conch</PortalSketch.Field>
        <PortalSketch.Field label="Ignore Two Factor Authentication">On</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>Add</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="A direct message with your bot in Rocket.Chat"
      brand="rocketchat"
      color={color}
      title={channel?.bot.name ?? assistant}
      subtitle="Bot"
      alive={!owner}
      messages={
        owner
          ? [
              { id: 'h', from: 'you', text: 'hi' },
              {
                id: 'w',
                from: 'them',
                text: `Hi ${owner.name.split(' ')[0]}! 👋 I’m ${assistant}, and I’m connected to Conch on your computer. Ask me anything.`,
              },
            ]
          : [{ id: 'h', from: 'you', text: 'hi' }]
      }
      footer={<Handset.Composer placeholder="Message" />}
    />
  );
}
