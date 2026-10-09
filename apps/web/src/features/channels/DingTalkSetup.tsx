import type { Channel } from '@conch/protocol';
import { Button, Callout, GuideSteps, Handset, KeyField, PortalSketch, Text } from '@conch/nacre';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import styles from './Channels.module.css';
import { Answer, OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { DINGTALK_CONSOLE, DINGTALK_PERMISSIONS } from './guides';
import { HelloStep } from './HelloStep';
import { useKeyCheck } from './hooks';

/**
 * DingTalk (ADR 0120): an internal app with a robot in Stream mode, so
 * Conch connects out and nothing is opened to the internet. The Client ID
 * and Client Secret are checked as they're pasted (an access token and a
 * Stream ticket); the permissions and publishing are the console's own.
 */
export function DingTalkSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [made, setMade] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const body =
    clientId.trim() && clientSecret.trim()
      ? ({ kind: 'dingtalk', clientId, clientSecret } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, `${clientId}${clientSecret}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });

  const at = !channel ? (made || clientId ? 1 : 0) : !allowed ? 2 : 3;

  return (
    <SetupPage
      kind="dingtalk"
      intro="About six minutes. Your assistant becomes a robot in your DingTalk organisation. Conch connects out to DingTalk in Stream mode, so nothing on this computer is opened to the internet. Only you can talk to it until you let someone in."
      preview={<DingTalkPreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect DingTalk">
        <GuideSteps.Step
          number={1}
          title="Make an app with a robot (创建应用)"
          state={stepState(0, at)}
          summary="Made, in Stream mode"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            In the DingTalk developer console, press <b>Create App</b> (创建应用) and name it as
            below. Under <b>Add capability</b> (添加应用能力), add a <b>Robot</b> (机器人). In its
            settings, set <b>Message receiving mode</b> (消息接收模式) to <b>Stream mode</b>{' '}
            (Stream模式), and publish the robot.
          </Text>
          <Answer label="App name" value={assistant} />
          <OpenButton href={DINGTALK_CONSOLE}>Open the DingTalk developer console</OpenButton>
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            I made it
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Paste its Client ID and Client Secret"
          state={stepState(1, at)}
          summary="Connected"
        >
          <Text tone="muted">
            They’re on the app’s <b>Credentials & Basic Info</b> page (凭证与基础信息). The Client
            ID is also called the AppKey.
          </Text>
          <KeyField
            label="Client ID"
            value={clientId}
            onValueChange={(v) => {
              reset();
              setClientId(v.trim());
            }}
            status={clientId ? 'ok' : 'idle'}
            placeholder="ding…"
            found={<>Now its Client Secret.</>}
            focusOnShow
          />
          <KeyField
            label="Client Secret"
            value={clientSecret}
            onValueChange={(v) => {
              reset();
              setClientSecret(v.trim());
            }}
            status={error ? 'error' : clientSecret ? status : 'idle'}
            checkingLabel="Checking with DingTalk…"
            description="Conch connects out to DingTalk with these. They never leave this computer for anywhere else."
            found={<>DingTalk accepts them. {busy ? 'Connecting…' : ''}</>}
            error={error ?? (check && !check.ok ? check.message : undefined)}
          />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={3}
          title="Turn on its permission, and publish"
          state={stepState(2, at)}
          summary="Published"
        >
          <Text tone="muted">
            <b>Permissions</b> (权限管理): search for this and press <b>Apply</b> (申请权限):
          </Text>
          <ul className={styles.how}>
            {DINGTALK_PERMISSIONS.map((p) => (
              <li key={p.name}>
                <b>{p.name}</b>: {p.why}
              </li>
            ))}
          </ul>
          <Text tone="muted">
            Then <b>Version Management & Release</b> (版本管理与发布): create a version, choose who
            can see it (可见范围), at least yourself, and <b>Publish</b>.
          </Text>
          <Callout tone="info" title="Messages a month">
            DingTalk’s free plan allows 5,000 robot messages a month for the whole organisation. If
            they run out, the channel’s page says so.
          </Callout>
          <Button variant="ghost" className={styles.fit} onClick={() => setAllowed(true)}>
            It’s published
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step number={4} title="Say hello (打个招呼)" state={stepState(3, at)}>
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

function DingTalkPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.dingtalk.color;
  const nav = ['Credentials & Basic Info', 'Robot', 'Permissions', 'Version Management & Release'];
  if (at === 0)
    return (
      <PortalSketch
        label="The DingTalk developer console, on your app’s robot"
        address="open-dev.dingtalk.com"
        nav={nav}
        active="Robot"
        title="Robot configuration"
        color={color}
      >
        <PortalSketch.Field label="Robot name">{assistant}</PortalSketch.Field>
        <PortalSketch.Field label="Message receiving mode">Stream mode</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>Publish</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  if (at === 1)
    return (
      <PortalSketch
        label="The DingTalk developer console, on your app’s credentials"
        address="open-dev.dingtalk.com"
        nav={nav}
        active="Credentials & Basic Info"
        title="Credentials & Basic Info"
        color={color}
      >
        <PortalSketch.Field label="Client ID (AppKey)">dingabc123…</PortalSketch.Field>
        <PortalSketch.Field label="Client Secret">••••••••••••</PortalSketch.Field>
      </PortalSketch>
    );
  if (at === 2)
    return (
      <PortalSketch
        label="The DingTalk developer console, on Permissions"
        address="open-dev.dingtalk.com"
        nav={nav}
        active="Permissions"
        title="Permissions"
        color={color}
      >
        {DINGTALK_PERMISSIONS.map((p) => (
          <PortalSketch.Toggle key={p.name} label={p.name} press />
        ))}
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Your robot in DingTalk"
      brand="dingtalk"
      color={color}
      title={assistant}
      subtitle="Robot · 机器人"
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
