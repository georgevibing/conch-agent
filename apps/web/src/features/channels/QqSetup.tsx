import { type Channel, QQ_APP_ID } from '@conch/protocol';
import { Button, Callout, GuideSteps, Handset, KeyField, PortalSketch, Text } from '@conch/nacre';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import styles from './Channels.module.css';
import { OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { QQ_BOTS_URL, QQ_QUICK_BOT_URL } from './guides';
import { HelloStep } from './HelloStep';
import { useKeyCheck } from './hooks';

/**
 * QQ (ADR 0120): a bot on QQ's bot platform, over its WebSocket gateway, so
 * Conch connects out. QQ's quick page makes a bot with one scan; its AppID
 * and AppSecret are checked as they're pasted, and adding the bot in QQ is
 * the hello.
 */
export function QqSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [made, setMade] = useState(false);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const body =
    appId.trim() && appSecret.trim() ? ({ kind: 'qq', appId, appSecret } as const) : undefined;
  const { status, check } = useKeyCheck(body, `${appId}${appSecret}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });

  const at = !channel ? (made || appId ? 1 : 0) : 2;
  const idWrong = check && !check.ok && check.field === 'appId';

  return (
    <SetupPage
      kind="qq"
      intro="About three minutes. Your assistant becomes a QQ bot of your own. Conch connects out to QQ, so nothing on this computer is opened to the internet. Only you can talk to it until you let someone in."
      preview={<QqPreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect QQ">
        <GuideSteps.Step
          number={1}
          title="Make a bot (创建机器人)"
          state={stepState(0, at)}
          summary="Made"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            Open QQ’s quick bot page and sign in by scanning the code with QQ on your phone. Press{' '}
            <b>Create</b> (创建), name it <b>{assistant}</b>, and it shows the bot’s <b>AppID</b>{' '}
            and <b>AppSecret</b>. Any QQ account can make up to five.
          </Text>
          <div className={styles.openRow}>
            <OpenButton href={QQ_QUICK_BOT_URL}>Open QQ’s bot page</OpenButton>
            <Button asChild variant="ghost" size="sm">
              <a href={QQ_BOTS_URL} target="_blank" rel="noreferrer noopener">
                The full platform (q.qq.com)
              </a>
            </Button>
          </div>
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            I made it
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Paste its AppID and AppSecret"
          state={stepState(1, at)}
          summary="Connected"
        >
          <KeyField
            label="AppID"
            value={appId}
            onValueChange={(v) => {
              reset();
              setAppId(QQ_APP_ID.exec(v)?.[1] ?? v.trim());
            }}
            status={idWrong ? 'error' : appId ? (QQ_APP_ID.test(appId) ? 'ok' : 'error') : 'idle'}
            placeholder="102…"
            found={<>Now its AppSecret.</>}
            error={idWrong ? check.message : 'An AppID is a number, like 102345678.'}
            focusOnShow
          />
          <KeyField
            label="AppSecret"
            value={appSecret}
            onValueChange={(v) => {
              reset();
              setAppSecret(v.trim());
            }}
            status={error ? 'error' : appSecret ? (idWrong ? 'idle' : status) : 'idle'}
            checkingLabel="Checking with QQ…"
            description="A bot made on the full platform: set its events to WebSocket (not Webhook) in its development settings."
            found={<>QQ accepts them. {busy ? 'Connecting…' : ''}</>}
            error={error ?? (check && !check.ok && !idWrong ? check.message : undefined)}
          />
        </GuideSteps.Step>
        <GuideSteps.Step number={3} title="Add it in QQ, and say hello" state={stepState(2, at)}>
          {channel && (
            <HelloStep
              channel={channel}
              onFinish={() => void navigate(`/channels/${channel.id}`)}
            />
          )}
          <Callout tone="info" title="Who can find it">
            Until you verify your identity on q.qq.com (实名认证), only you can use the bot, plus up
            to 20 test accounts you add there. After that, choose who it’s for in its settings, and
            others can find and add it. Nobody gets an answer until you let them in, either way.
          </Callout>
        </GuideSteps.Step>
      </GuideSteps>
      {dialog}
    </SetupPage>
  );
}

function QqPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.qq.color;
  if (at <= 1)
    return (
      <PortalSketch
        label="QQ’s bot page, with your new bot’s AppID and AppSecret"
        address="q.qq.com/qqbot"
        nav={['My bots', 'Create']}
        active={at === 0 ? 'Create' : 'My bots'}
        title={assistant}
        color={color}
      >
        <PortalSketch.Field label="AppID">102345678</PortalSketch.Field>
        <PortalSketch.Field label="AppSecret">••••••••••••</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>{at === 0 ? 'Create' : 'Copy'}</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Your bot in QQ"
      brand="qq"
      color={color}
      title={channel?.bot.name ?? assistant}
      subtitle="QQ机器人"
      avatar={channel?.bot.avatar}
      alive={!owner}
      messages={
        owner
          ? [
              { id: 'h', from: 'you', text: '你好' },
              {
                id: 'w',
                from: 'them',
                text: `Hi ${owner.name.split(' ')[0]}! 👋 I’m ${assistant}, and I’m connected to Conch on your computer. Ask me anything.`,
              },
            ]
          : [{ id: 'h', from: 'you', text: '你好' }]
      }
      footer={<Handset.Composer placeholder="发消息" />}
    />
  );
}
