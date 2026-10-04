import type { Channel } from '@conch/protocol';
import { Button, GuideSteps, Handset, KeyField, PortalSketch, Text } from '@conch/nacre';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import styles from './Channels.module.css';
import { OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { DoorStep } from './DoorStep';
import { LINE_CONSOLE_URL, LINE_MANAGER_URL } from './guides';
import { HelloStep } from './HelloStep';
import { useKeyCheck } from './hooks';
import { useDoor } from './queries';

/** A channel secret is 32 hex digits; whatever was pasted around it is left behind. */
const SECRET = /\b([0-9a-f]{32})\b/;

/**
 * LINE (ADR 0082): a LINE Official Account with the Messaging API on. LINE
 * delivers to a web address, so Conch opens one and points the channel's
 * webhook at it itself; the one switch only you can turn is “Use webhook”.
 */
export function LineSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [made, setMade] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [channelSecret, setChannelSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const body =
    channelSecret.trim() && accessToken.trim()
      ? ({ kind: 'line', channelSecret, accessToken } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, `${channelSecret}${accessToken}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  const { data: door } = useDoor();

  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });

  const heard = Boolean(channel?.hook?.heardAt);
  const at = !channel
    ? made || channelSecret
      ? 1
      : 0
    : door?.state !== 'ready'
      ? 2
      : !switched && !heard
        ? 3
        : 4;
  const secretWrong = check && !check.ok && check.field === 'channelSecret';

  return (
    <SetupPage
      kind="line"
      intro="About six minutes. Your assistant gets a LINE Official Account of its own, and you add it as a friend. Only you can talk to it."
      preview={<LinePreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect LINE">
        <GuideSteps.Step
          number={1}
          title="Make an Official Account"
          state={stepState(0, at)}
          summary="Made, with the Messaging API on"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            In LINE Official Account Manager, make a new account named <b>{assistant}</b> (the free
            plan is fine). Then open <b>Settings → Messaging API</b> and press{' '}
            <b>Enable Messaging API</b>.
          </Text>
          <OpenButton href={LINE_MANAGER_URL}>Open LINE Official Account Manager</OpenButton>
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            I made it
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Copy its secret and a token"
          state={stepState(1, at)}
          summary="Connected"
        >
          <Text tone="muted">
            In the LINE Developers Console, open your account’s channel. Copy the{' '}
            <b>Channel secret</b> from <b>Basic settings</b>. Then on the <b>Messaging API</b> tab,
            press <b>Issue</b> under <b>Channel access token</b> and copy it.
          </Text>
          <OpenButton href={LINE_CONSOLE_URL}>Open the LINE Developers Console</OpenButton>
          <KeyField
            label="Channel secret"
            value={channelSecret}
            onValueChange={(v) => {
              reset();
              setChannelSecret(SECRET.exec(v)?.[1] ?? v);
            }}
            status={
              secretWrong
                ? 'error'
                : channelSecret
                  ? SECRET.test(channelSecret)
                    ? 'ok'
                    : 'error'
                  : 'idle'
            }
            found={<>That’s a channel secret.</>}
            error={secretWrong ? check.message : 'A channel secret is 32 letters and digits.'}
            focusOnShow
          />
          <KeyField
            label="Channel access token"
            value={accessToken}
            onValueChange={(v) => {
              reset();
              setAccessToken(v.trim());
            }}
            status={error ? 'error' : accessToken ? status : 'idle'}
            checkingLabel="Checking with LINE…"
            found={<>LINE accepts it. {busy ? 'Connecting…' : ''}</>}
            error={error ?? (check && !check.ok && !secretWrong ? check.message : undefined)}
          />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={3}
          title="Give it an address LINE can reach"
          state={stepState(2, at)}
          summary={door?.url ? `At ${door.url}` : 'On'}
        >
          <Text tone="muted">
            LINE delivers messages to a web address. Turn one on here, and Conch tells LINE to use
            it.
          </Text>
          <DoorStep />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={4}
          title="Turn on Use webhook"
          state={stepState(3, at)}
          summary="On"
        >
          <Text tone="muted">
            Back on the <b>Messaging API</b> tab, turn on <b>Use webhook</b>. In LINE Official
            Account Manager, under <b>Response settings</b>, turn off <b>Auto-response messages</b>{' '}
            so only your assistant answers.
          </Text>
          <Button variant="ghost" className={styles.fit} onClick={() => setSwitched(true)}>
            It’s on
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step number={5} title="Say hello" state={stepState(4, at)}>
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

function LinePreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.line.color;
  if (at <= 1)
    return (
      <PortalSketch
        label="The LINE Developers Console, on your channel"
        address="developers.line.biz/console"
        nav={['Basic settings', 'Messaging API', 'Statistics']}
        active={at === 0 ? 'Basic settings' : 'Messaging API'}
        title={assistant}
        color={color}
      >
        {at === 0 ? (
          <>
            <PortalSketch.Field label="Channel secret">0123456789abcdef…</PortalSketch.Field>
            <PortalSketch.Bar width={60} />
          </>
        ) : (
          <>
            <PortalSketch.Field label="Channel access token (long-lived)" />
            <PortalSketch.Row>
              <PortalSketch.Button>Issue</PortalSketch.Button>
            </PortalSketch.Row>
          </>
        )}
      </PortalSketch>
    );
  if (at <= 3)
    return (
      <PortalSketch
        label="Your channel’s Messaging API tab"
        address="developers.line.biz/console"
        nav={['Basic settings', 'Messaging API', 'Statistics']}
        active="Messaging API"
        title="Webhook settings"
        color={color}
      >
        <PortalSketch.Field label="Webhook URL">
          {channel?.hook?.url ?? 'Conch sets this for you'}
        </PortalSketch.Field>
        <PortalSketch.Field label="Use webhook">On</PortalSketch.Field>
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Your assistant in LINE"
      brand="line"
      color={color}
      title={channel?.bot.name ?? assistant}
      subtitle="Official account"
      avatar={channel?.bot.avatar}
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
      footer={<Handset.Composer placeholder="Aa" />}
    />
  );
}
