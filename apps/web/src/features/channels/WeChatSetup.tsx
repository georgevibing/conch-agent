import { WECHAT_APP_ID } from '@conch/protocol';
import {
  Button,
  Callout,
  Field,
  GuideSteps,
  Handset,
  KeyField,
  PortalSketch,
  RadioGroup,
  Text,
} from '@conch/nacre';
import { Building2, MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import styles from './Channels.module.css';
import { OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { DoorStep } from './DoorStep';
import { WECHAT_SANDBOX_URL, WECOM_BOT_DOCS_URL, WECOM_URL } from './guides';
import { HelloStep } from './HelloStep';
import { WeChatServerFields } from './HookSection';
import { useKeyCheck, usePasteAnywhere } from './hooks';
import { useDoor } from './queries';

type Way = 'wecom' | 'official';

/**
 * WeChat, the honest way (ADR 0045). A personal WeChat account has no
 * official way to be a bot, and the tools that log in as one get accounts
 * banned, so Conch offers Tencent's own two:
 *
 * - a WeCom (企业微信) AI bot, the default: it connects out, so there's
 *   nothing to open to the internet, and you chat with it in WeCom;
 * - an Official Account (公众号), or its free test account (测试号), which
 *   you chat with in WeChat itself, through the public door.
 */
export function WeChatSetup() {
  const [way, setWay] = useState<Way>('wecom');
  return (
    <SetupPage
      kind="wechat"
      intro="About five minutes. Personal WeChat accounts can’t be bots (tools that pretend get accounts banned), so your assistant uses one of Tencent’s own ways in. 个人微信没有官方的机器人接口，所以用腾讯官方的方式。"
      preview={way === 'wecom' ? <WeComPreview /> : <OfficialPreview />}
    >
      <Field>
        <Field.Label>Which way in?</Field.Label>
        <RadioGroup variant="card" value={way} onValueChange={(v) => setWay(v as Way)}>
          <RadioGroup.Item
            value="wecom"
            icon={<Building2 />}
            label="A WeCom bot (企业微信机器人) — recommended"
            description="Nothing to open to the internet. You chat with it in the WeCom app, which is free and signs in with WeChat."
          />
          <RadioGroup.Item
            value="official"
            icon={<MessageCircle />}
            label="An Official Account (公众号 / 测试号)"
            description="Chat in WeChat itself. Needs a public address, and WeChat’s limits apply to answers that take a while."
          />
        </RadioGroup>
      </Field>
      {way === 'wecom' ? <WeComSteps /> : <OfficialSteps />}
    </SetupPage>
  );
}

function WeComSteps() {
  const navigate = useNavigate();
  const [made, setMade] = useState(false);
  const [botId, setBotId] = useState('');
  const [secret, setSecret] = useState('');
  const body =
    botId.trim() && secret.trim()
      ? ({ kind: 'wechat', mode: 'wecom', appId: botId, secret } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, `${botId}${secret}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });
  const at = channel ? 2 : made || botId ? 1 : 0;
  return (
    <GuideSteps label="Connect WeChat through WeCom">
      <GuideSteps.Step
        number={1}
        title="Make an AI bot in WeCom (创建智能机器人)"
        state={stepState(0, at)}
        summary="Made in WeCom"
        onEdit={channel ? undefined : () => setMade(false)}
      >
        <Text tone="muted">
          No WeCom yet? Download it and create a team of your own (创建企业): it’s free and takes a
          minute. Then in WeCom’s admin, make an <b>AI bot</b> (智能机器人), choose <b>API mode</b>{' '}
          (API模式) and <b>long connection</b> (长连接), and note its <b>Bot ID</b> and{' '}
          <b>Secret</b>.
        </Text>
        <div className={styles.openRow}>
          <OpenButton href={WECOM_URL}>Open WeCom</OpenButton>
          <Button asChild variant="ghost" size="sm">
            <a href={WECOM_BOT_DOCS_URL} target="_blank" rel="noreferrer noopener">
              Tencent’s guide (中文)
            </a>
          </Button>
        </div>
        <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
          I made it
        </Button>
      </GuideSteps.Step>
      <GuideSteps.Step
        number={2}
        title="Paste its Bot ID and Secret"
        state={stepState(1, at)}
        summary="Connected"
      >
        <KeyField
          label="Bot ID"
          value={botId}
          onValueChange={(v) => {
            reset();
            setBotId(v.trim());
          }}
          status={botId ? 'ok' : 'idle'}
          found={<>Now its Secret.</>}
          focusOnShow
        />
        <KeyField
          label="Secret"
          value={secret}
          onValueChange={(v) => {
            reset();
            setSecret(v);
          }}
          status={error ? 'error' : secret ? status : 'idle'}
          checkingLabel="Checking with WeCom…"
          description="Conch connects out to WeCom with these, so nothing on this computer is opened to the internet."
          found={<>WeCom accepts them. {busy ? 'Connecting…' : ''}</>}
          error={error ?? (check && !check.ok ? check.message : undefined)}
        />
      </GuideSteps.Step>
      <GuideSteps.Step number={3} title="Say hello (打个招呼)" state={stepState(2, at)}>
        {channel && (
          <HelloStep channel={channel} onFinish={() => void navigate(`/channels/${channel.id}`)} />
        )}
      </GuideSteps.Step>
      {dialog}
    </GuideSteps>
  );
}

function OfficialSteps() {
  const navigate = useNavigate();
  const [made, setMade] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const body =
    appId.trim() && secret.trim()
      ? ({ kind: 'wechat', mode: 'official', appId, secret } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, `${appId}${secret}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  const { data: door } = useDoor();
  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });
  usePasteAnywhere(
    WECHAT_APP_ID,
    (found) => {
      setMade(true);
      setAppId(found);
    },
    !channel,
  );
  const heard = Boolean(channel?.hook?.heardAt);
  const at = !channel
    ? made || appId
      ? 1
      : 0
    : door?.state !== 'ready'
      ? 2
      : !heard && !submitted
        ? 3
        : 4;
  // An address with a port of its own (8443): WeChat won't deliver there.
  const offPort = Boolean(door?.url && /^https:\/\/[^/]+:\d+/.test(door.url));
  return (
    <GuideSteps label="Connect WeChat through an Official Account">
      <GuideSteps.Step
        number={1}
        title="Get an Official Account (公众号)"
        state={stepState(0, at)}
        summary="Have one"
        onEdit={channel ? undefined : () => setMade(false)}
      >
        <Text tone="muted">
          The quickest is WeChat’s free <b>test account</b> (测试号): open the page, scan the code
          with WeChat, and it shows an <b>appID</b> and <b>appsecret</b>. Up to about 100 people can
          follow one. If you have a real Official Account, its AppID and AppSecret are under{' '}
          <b>设置与开发 → 基本配置</b>.
        </Text>
        <OpenButton href={WECHAT_SANDBOX_URL}>Open the test account page</OpenButton>
        <Text size="sm" tone="subtle">
          An account of your own (个人主体), not verified, can only answer within five seconds.
          Conch then keeps longer answers until your next message, and says so.
        </Text>
        <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
          I have one
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
            setAppId(WECHAT_APP_ID.exec(v)?.[1] ?? v.trim());
          }}
          status={appId ? (WECHAT_APP_ID.test(appId) ? 'ok' : 'error') : 'idle'}
          placeholder="wx…"
          found={<>Now its AppSecret.</>}
          error="An AppID starts with wx, then 16 letters and digits."
          focusOnShow
        />
        <KeyField
          label="AppSecret"
          value={secret}
          onValueChange={(v) => {
            reset();
            setSecret(v);
          }}
          status={error ? 'error' : secret ? status : 'idle'}
          checkingLabel="Checking with WeChat…"
          found={<>WeChat accepts it. {busy ? 'Connecting…' : ''}</>}
          error={error ?? (check && !check.ok ? check.message : undefined)}
        />
      </GuideSteps.Step>
      <GuideSteps.Step
        number={3}
        title="Give it an address WeChat can reach"
        state={stepState(2, at)}
        summary={door?.url ? `At ${door.url}` : 'On'}
      >
        <Text tone="muted">
          WeChat delivers messages to a web address, on the standard HTTPS port.
        </Text>
        <DoorStep />
      </GuideSteps.Step>
      <GuideSteps.Step
        number={4}
        title="Paste three things in WeChat (服务器配置)"
        state={stepState(3, at)}
        summary="WeChat checked the address"
      >
        <Text tone="muted">
          Test account: under <b>接口配置信息</b>, press <b>修改</b>. Your own account:{' '}
          <b>设置与开发 → 基本配置 → 服务器配置</b>, press <b>修改配置</b> and choose{' '}
          <b>安全模式</b> (safe mode). Paste these, then press <b>提交</b> (Submit).
        </Text>
        {offPort && (
          <Callout tone="warning" title="WeChat needs the standard port">
            WeChat only delivers to addresses on port 443, and your phone’s private address is using
            it. Use an address of your own for WeChat, or turn the phone address off.
          </Callout>
        )}
        {channel && <WeChatServerFields channel={channel} />}
        <Text size="sm" tone="subtle" aria-live="polite">
          {heard
            ? 'WeChat checked the address. ✓'
            : 'This ticks itself off when WeChat checks the address.'}
        </Text>
        <Button variant="ghost" size="sm" className={styles.fit} onClick={() => setSubmitted(true)}>
          I pressed Submit
        </Button>
      </GuideSteps.Step>
      <GuideSteps.Step number={5} title="Say hello (打个招呼)" state={stepState(4, at)}>
        {channel && (
          <HelloStep channel={channel} onFinish={() => void navigate(`/channels/${channel.id}`)} />
        )}
      </GuideSteps.Step>
      {dialog}
    </GuideSteps>
  );
}

function WeComPreview() {
  return (
    <Handset
      label="Your bot in WeCom"
      brand="wechat"
      color={APPS.wechat.color}
      title="Conch"
      subtitle="智能机器人"
      messages={[
        { id: 'h', from: 'you', text: '你好' },
        {
          id: 'w',
          from: 'them',
          text: 'Hi! To finish connecting, go back to Conch on your computer and press That’s me.',
        },
      ]}
      footer={<Handset.Composer placeholder="发消息" />}
    />
  );
}

function OfficialPreview() {
  return (
    <PortalSketch
      label="WeChat’s server settings"
      address="mp.weixin.qq.com"
      nav={['设置与开发', '基本配置', '服务器配置']}
      active="服务器配置"
      title="服务器配置"
      color={APPS.wechat.color}
    >
      <PortalSketch.Field label="URL">https://…/conch/hooks/…</PortalSketch.Field>
      <PortalSketch.Field label="Token">••••••••</PortalSketch.Field>
      <PortalSketch.Field label="EncodingAESKey">••••••••</PortalSketch.Field>
      <PortalSketch.Field label="消息加解密方式">安全模式</PortalSketch.Field>
      <PortalSketch.Row>
        <PortalSketch.Button>提交</PortalSketch.Button>
      </PortalSketch.Row>
    </PortalSketch>
  );
}
