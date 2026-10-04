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

/** What a person would call the bot's username: lowercase, no spaces. */
const botName = (assistant: string) =>
  assistant
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 22) || 'conch';

/**
 * Mattermost (ADR 0081): a bot account on your own server. Conch connects
 * to the server's WebSocket from this computer, so no public address.
 */
export function MattermostSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [made, setMade] = useState(false);
  const [server, setServer] = useState('');
  const [token, setToken] = useState('');
  const body =
    server.trim() && token.trim() ? ({ kind: 'mattermost', server, token } as const) : undefined;
  const { status, check } = useKeyCheck(body, `${server}${token}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();

  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });

  const at = !channel ? (made || token ? 1 : 0) : 2;
  const username = botName(assistant);
  const wrongServer = check && !check.ok && check.field === 'server';

  return (
    <SetupPage
      kind="mattermost"
      intro="About three minutes. You make a bot account on your Mattermost server and paste its token. Conch connects from this computer, so nothing needs a public address. Only you can talk to it."
      preview={<MattermostPreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect Mattermost">
        <GuideSteps.Step
          number={1}
          title="Make a bot account"
          state={stepState(0, at)}
          summary="Made"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            In Mattermost, open the menu → <b>Integrations</b> → <b>Bot Accounts</b> →{' '}
            <b>Add Bot Account</b>. Fill it in as below, press <b>Create Bot Account</b>, and copy
            the token it shows (once).
          </Text>
          <Answer label="Username" value={username} />
          <Answer label="Display name" value={assistant} />
          <Text size="sm" tone="subtle">
            No Bot Accounts there? Someone who runs the server turns them on in{' '}
            <b>System Console → Integrations → Bot Accounts</b>.
          </Text>
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            I made it
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Paste the address and the token"
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
            description="The address you open Mattermost at."
            error={wrongServer ? check.message : undefined}
            focusOnShow
          />
          <KeyField
            label="Access token"
            value={token}
            onValueChange={(v) => {
              reset();
              setToken(v);
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

function MattermostPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.mattermost.color;
  if (at < 2)
    return (
      <PortalSketch
        label="Mattermost, adding a bot account"
        address="chat.example.com/integrations/bots/add"
        nav={['Incoming Webhooks', 'Slash Commands', 'Bot Accounts']}
        active="Bot Accounts"
        title={at === 0 ? 'Add Bot Account' : 'Setup Successful'}
        color={color}
      >
        {at === 0 ? (
          <>
            <PortalSketch.Field label="Username">{botName(assistant)}</PortalSketch.Field>
            <PortalSketch.Field label="Display Name">{assistant}</PortalSketch.Field>
            <PortalSketch.Row>
              <PortalSketch.Button>Create Bot Account</PortalSketch.Button>
            </PortalSketch.Row>
          </>
        ) : (
          <>
            <PortalSketch.Field label="Token">••••••••••••••••••••••••••</PortalSketch.Field>
            <PortalSketch.Bar width={70} />
            <PortalSketch.Row>
              <PortalSketch.Button>Done</PortalSketch.Button>
            </PortalSketch.Row>
          </>
        )}
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="A direct message with your bot in Mattermost"
      brand="mattermost"
      color={color}
      title={channel?.bot.name ?? assistant}
      subtitle="BOT"
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
      footer={<Handset.Composer placeholder={`Write to ${channel?.bot.name ?? assistant}`} />}
    />
  );
}
