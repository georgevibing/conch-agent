import { type Channel, FEISHU_APP_ID, type FeishuScan } from '@conch/protocol';
import {
  Button,
  DeviceLinkCard,
  Field,
  GuideSteps,
  Handset,
  KeyField,
  PortalSketch,
  RadioGroup,
  Text,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from './api';
import styles from './Channels.module.css';
import { Answer, OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { FEISHU_CONSOLE, FEISHU_EVENTS, FEISHU_SCOPES, feishuScopesJson } from './guides';
import { HelloStep } from './HelloStep';
import { useKeyCheck, usePasteAnywhere, usePointerFine } from './hooks';
import { channelKeys, errorText, useChannel } from './queries';

type Region = 'feishu' | 'lark';

/**
 * Feishu and Lark (ADR 0120): one card, two clouds. The quick way is a code
 * to scan with Feishu: Feishu makes the app (its bot, permissions, events
 * and card callback filled in), hands Conch its keys, and whoever scanned is
 * the owner, so there's no hello to say. By hand, it's the console's steps
 * with the App ID and App Secret checked as they're pasted. Either way two
 * switches are only the console's: the long connection, and publishing.
 */
export function FeishuSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [region, setRegion] = useState<Region>(() =>
    typeof navigator !== 'undefined' && /^zh-(CN|Hans)/i.test(navigator.language)
      ? 'feishu'
      : 'lark',
  );
  const [way, setWay] = useState<'scan' | 'hand'>('scan');
  const [made, setMade] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [published, setPublished] = useState(false);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [scannedId, setScannedId] = useState<string>();
  const body =
    appId.trim() && appSecret.trim()
      ? ({ kind: 'feishu', region, appId, appSecret } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, `${region}${appId}${appSecret}`);
  const { channel: typed, connect, busy, error, reset, dialog } = useConnect();
  const { channel: scanned } = useChannel(scannedId);
  const channel = typed ?? scanned;
  useEffect(() => {
    if (status === 'ok' && body && !typed) void connect(body);
  });
  usePasteAnywhere(
    FEISHU_APP_ID,
    (found) => {
      setWay('hand');
      setMade(true);
      setAppId(found);
    },
    !channel,
  );

  const name = region === 'lark' ? 'Lark' : 'Feishu';
  const console = FEISHU_CONSOLE[region];
  const hand = way === 'hand';
  // By hand: make, paste, let it hear, publish, hello. Scanned: scan, the long connection, publish, done.
  const at = hand
    ? !channel
      ? made || appId
        ? 1
        : 0
      : !switched
        ? 2
        : !published
          ? 3
          : 4
    : !channel
      ? 0
      : !switched
        ? 1
        : !published
          ? 2
          : 3;
  const idWrong = check && !check.ok && check.field === 'appId';
  const step = (index: number) => stepState(index, at);
  const finish = channel ? () => void navigate(`/channels/${channel.id}`) : undefined;

  const longConnection = (
    <Text tone="muted">
      <b>Events & Callbacks</b> (事件与回调): set <b>Event configuration</b> and{' '}
      <b>Callback configuration</b> to <b>Receive through persistent connection</b>{' '}
      (使用长连接接收), and save. Conch is connected, so {name} accepts it.
    </Text>
  );
  const publish = (
    <GuideSteps.Step
      number={hand ? 4 : 3}
      title="Publish it"
      state={step(hand ? 3 : 2)}
      summary="Published"
    >
      <Text tone="muted">
        <b>Version Management & Release</b> (版本管理与发布): press <b>Create a version</b>, give it
        a number like 1.0.0, and <b>Submit for release</b>. If you’re your organisation’s admin,
        approve it in the admin console; otherwise your admin gets the request.
      </Text>
      <Button variant="ghost" className={styles.fit} onClick={() => setPublished(true)}>
        It’s published
      </Button>
    </GuideSteps.Step>
  );

  return (
    <SetupPage
      kind="feishu"
      intro={`About ${hand ? 'five minutes' : 'two minutes'}. Your assistant becomes a bot in ${name}, as an app of your own. Conch connects out to ${name}, so nothing on this computer is opened to the internet. Only you can talk to it until you let someone in.`}
      preview={
        <FeishuPreview
          at={hand ? at : at === 0 ? -1 : at + 1}
          region={region}
          channel={channel}
          assistant={assistant}
        />
      }
    >
      <Field>
        <Field.Label>Which one do you use?</Field.Label>
        <RadioGroup
          variant="card"
          value={region}
          onValueChange={(v) => {
            if (channel) return;
            reset();
            setRegion(v as Region);
          }}
        >
          <RadioGroup.Item
            value="feishu"
            icon={<MapPin />}
            label="Feishu (飞书)"
            description="In mainland China, at feishu.cn."
            disabled={Boolean(channel)}
          />
          <RadioGroup.Item
            value="lark"
            icon={<Globe2 />}
            label="Lark"
            description="Everywhere else, at larksuite.com."
            disabled={Boolean(channel)}
          />
        </RadioGroup>
      </Field>
      {hand ? (
        <GuideSteps label={`Connect ${name} by hand`}>
          <GuideSteps.Step
            number={1}
            title={
              region === 'lark' ? 'Make an app with a bot' : 'Make an app with a bot (创建应用)'
            }
            state={step(0)}
            summary="Made"
            onEdit={channel ? undefined : () => setMade(false)}
          >
            <Text tone="muted">
              In the developer console, press <b>Create Custom App</b> (创建企业自建应用) and name
              it as below. Then, under <b>Features</b> (添加应用能力), add <b>Bot</b> (机器人).
            </Text>
            <Answer label="App name" value={assistant} />
            <div className={styles.openRow}>
              <OpenButton href={console}>Open the {name} developer console</OpenButton>
              {!channel && (
                <Button variant="ghost" size="sm" onClick={() => setWay('scan')}>
                  Scan a code instead
                </Button>
              )}
            </div>
            <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
              I made it
            </Button>
          </GuideSteps.Step>
          <GuideSteps.Step
            number={2}
            title="Paste its App ID and App Secret"
            state={step(1)}
            summary={channel ? `Connected as ${channel.bot.name}` : 'Connected'}
          >
            <Text tone="muted">
              They’re on the app’s <b>Credentials & Basic Info</b> page (凭证与基础信息).
            </Text>
            <KeyField
              label="App ID"
              value={appId}
              onValueChange={(v) => {
                reset();
                setAppId(FEISHU_APP_ID.exec(v)?.[1] ?? v.trim());
              }}
              status={
                idWrong ? 'error' : appId ? (FEISHU_APP_ID.test(appId) ? 'ok' : 'error') : 'idle'
              }
              placeholder="cli_…"
              found={<>Now its App Secret.</>}
              error={
                idWrong ? check.message : 'An App ID starts with cli_, then 16 letters and digits.'
              }
              focusOnShow
            />
            <KeyField
              label="App Secret"
              value={appSecret}
              onValueChange={(v) => {
                reset();
                setAppSecret(v.trim());
              }}
              status={error ? 'error' : appSecret ? (idWrong ? 'idle' : status) : 'idle'}
              checkingLabel={`Checking with ${name}…`}
              description={`Conch connects out to ${name} with these. They never leave this computer for anywhere else.`}
              found={
                <>
                  {name} accepts them. {busy ? 'Connecting…' : ''}
                </>
              }
              error={error ?? (check && !check.ok && !idWrong ? check.message : undefined)}
            />
          </GuideSteps.Step>
          <GuideSteps.Step
            number={3}
            title="Let it hear messages"
            state={step(2)}
            summary="Permissions and events on"
          >
            <Text tone="muted">
              <b>Permissions & Scopes</b> (权限管理): press <b>Batch import</b> (批量导入), paste
              these {FEISHU_SCOPES.length} permissions, and confirm. They let it read what’s sent to
              it and its @mentions, answer with words, pictures and files, and see who’s writing.
            </Text>
            <Answer label="Permissions" value={feishuScopesJson()} />
            {longConnection}
            <Text tone="muted">Then add these:</Text>
            <div className={styles.answers}>
              {FEISHU_EVENTS.map((event) => (
                <Answer key={event.id} label={event.label} value={event.id} />
              ))}
            </div>
            <Button variant="ghost" className={styles.fit} onClick={() => setSwitched(true)}>
              Done
            </Button>
          </GuideSteps.Step>
          {publish}
          <GuideSteps.Step number={5} title="Say hello (打个招呼)" state={step(4)}>
            {channel && <HelloStep channel={channel} onFinish={finish} />}
          </GuideSteps.Step>
        </GuideSteps>
      ) : (
        <GuideSteps label={`Connect ${name} with a code`}>
          <GuideSteps.Step
            number={1}
            title={`Scan the code with ${name}`}
            state={step(0)}
            summary={channel ? `Made ${channel.bot.name}, and it knows you` : 'Made'}
          >
            {!channel && (
              <ScanCode
                key={region}
                region={region}
                onMade={setScannedId}
                onHand={() => setWay('hand')}
              />
            )}
          </GuideSteps.Step>
          <GuideSteps.Step
            number={2}
            title="Turn on its long connection"
            state={step(1)}
            summary="On"
          >
            <Text tone="muted">
              {name} made the app with what it needs. One switch is only the console’s: open the app
              (it’s named {channel?.bot.name ?? assistant}) in the developer console.
            </Text>
            {longConnection}
            <OpenButton href={console}>Open the {name} developer console</OpenButton>
            <Button variant="ghost" className={styles.fit} onClick={() => setSwitched(true)}>
              Done
            </Button>
          </GuideSteps.Step>
          {publish}
          <GuideSteps.Step number={4} title="Say hello (打个招呼)" state={step(3)}>
            {channel && <HelloStep channel={channel} onFinish={finish} />}
          </GuideSteps.Step>
        </GuideSteps>
      )}
      {dialog}
    </SetupPage>
  );
}

const ENDED = new Set<FeishuScan['state']>(['done', 'expired', 'denied', 'failed']);

/**
 * The code to scan: shown at once, kept current, and stopped when the page
 * closes, so it can't be scanned later by someone else.
 */
function ScanCode({
  region,
  onMade,
  onHand,
}: {
  region: Region;
  onMade: (channelId: string) => void;
  onHand: () => void;
}) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const fine = usePointerFine();
  const [id, setId] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const name = region === 'lark' ? 'Lark' : 'Feishu';
  const { data: scan } = useQuery({
    queryKey: ['feishu-scan', id ?? ''],
    queryFn: () => channelsApi.feishuScanStatus(id ?? ''),
    enabled: Boolean(id),
    refetchInterval: (query) => (ENDED.has(query.state.data?.state ?? 'waiting') ? false : 2_000),
  });

  const start = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await guard(async () => {
        const made = await channelsApi.feishuScan(region);
        client.setQueryData(['feishu-scan', made.id], made);
        setId(made.id);
      });
    } catch (e) {
      setError(errorText(e, 'Couldn’t show a code.'));
    } finally {
      setBusy(false);
    }
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
    // Once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = useRef<FeishuScan | undefined>(undefined);
  useEffect(() => {
    current.current = scan;
  }, [scan]);
  useEffect(
    () => () => {
      const open = current.current;
      if (open && !ENDED.has(open.state))
        void channelsApi.stopFeishuScan(open.id).catch(() => undefined);
    },
    [],
  );

  const told = useRef<string>(undefined);
  useEffect(() => {
    if (scan?.state === 'done' && scan.channelId && told.current !== scan.id) {
      told.current = scan.id;
      void client.invalidateQueries({ queryKey: channelKeys.all });
      onMade(scan.channelId);
    }
  }, [scan, onMade, client]);

  const cardState =
    error || scan?.state === 'failed' || scan?.state === 'denied'
      ? 'failed'
      : scan?.state === 'expired'
        ? 'expired'
        : scan?.state === 'done'
          ? 'finishing'
          : scan?.url
            ? 'showing'
            : 'starting';

  return (
    <>
      <DeviceLinkCard
        state={cardState}
        {...(scan?.url && { qr: scan.url })}
        title={`Scan with ${name} on your phone`}
        qrLabel={`Scan with ${name}: it makes your bot`}
        message={error ?? scan?.message}
        onRetry={() => void start()}
        retrying={busy}
        retryLabel="Show a new code"
      >
        <p>
          {fine
            ? `Open ${name} on your phone, tap +, then Scan, and point it here.`
            : `Open the code in ${name}.`}{' '}
          {name} makes an app named for your assistant with everything it needs, and asks you to
          confirm. Whoever scans it is its owner.
        </p>
        {!fine && scan?.url && (
          <Button asChild variant="surface">
            <a href={scan.url}>Open in {name}</a>
          </Button>
        )}
      </DeviceLinkCard>
      <Button variant="ghost" size="sm" className={styles.fit} onClick={onHand}>
        Make the app by hand instead
      </Button>
      {dialog}
    </>
  );
}

function FeishuPreview({
  at,
  region,
  channel,
  assistant,
}: {
  /** The by-hand step; -1 while a code waits to be scanned. */
  at: number;
  region: Region;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.feishu.color;
  const address = region === 'lark' ? 'open.larksuite.com/app' : 'open.feishu.cn/app';
  const nav = [
    'Credentials & Basic Info',
    'Add Features',
    'Permissions & Scopes',
    'Events & Callbacks',
  ];
  if (at === -1)
    return (
      <Handset
        label={`What ${region === 'lark' ? 'Lark' : 'Feishu'} shows once you scan`}
        brand="feishu"
        color={color}
        title={region === 'lark' ? 'Lark' : '飞书'}
        subtitle="Create an app"
        messages={[
          {
            id: 'c',
            from: 'them',
            text: `Create “${assistant}”, a bot of your own, with permission to read the messages sent to it and to answer?`,
            buttons: [{ label: 'Create', tone: 'primary' }, { label: 'Cancel' }],
          },
        ]}
      />
    );
  if (at <= 1)
    return (
      <PortalSketch
        label="The developer console, on your app’s credentials"
        address={address}
        nav={nav}
        active={at === 0 ? 'Add Features' : 'Credentials & Basic Info'}
        title={at === 0 ? 'Add Features' : 'Credentials & Basic Info'}
        color={color}
      >
        {at === 0 ? (
          <>
            <PortalSketch.Field label="Bot">Add</PortalSketch.Field>
            <PortalSketch.Bar width={55} />
          </>
        ) : (
          <>
            <PortalSketch.Field label="App ID">cli_a1b2c3d4e5f6…</PortalSketch.Field>
            <PortalSketch.Field label="App Secret">••••••••••••</PortalSketch.Field>
          </>
        )}
      </PortalSketch>
    );
  if (at === 2)
    return (
      <PortalSketch
        label="The developer console, on Events & Callbacks"
        address={address}
        nav={nav}
        active="Events & Callbacks"
        title="Event configuration"
        color={color}
      >
        <PortalSketch.Field label="Subscription mode">
          Receive through persistent connection
        </PortalSketch.Field>
        <PortalSketch.Field label="Connected">✓ {assistant} on this computer</PortalSketch.Field>
        <PortalSketch.Field label="Events">im.message.receive_v1</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>Save</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  if (at === 3)
    return (
      <PortalSketch
        label="The developer console, publishing a version"
        address={address}
        nav={['Events & Callbacks', 'Version Management & Release']}
        active="Version Management & Release"
        title="Create a version"
        color={color}
      >
        <PortalSketch.Field label="Version">1.0.0</PortalSketch.Field>
        <PortalSketch.Field label="Availability">Only me</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>Submit for release</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label={`Your bot in ${region === 'lark' ? 'Lark' : 'Feishu'}`}
      brand="feishu"
      color={color}
      title={channel?.bot.name ?? assistant}
      subtitle="Bot · 机器人"
      avatar={channel?.bot.avatar}
      alive={!owner}
      messages={
        owner
          ? [
              {
                id: 'w',
                from: 'them',
                text: `Hi ${owner.name.split(' ')[0]}! 👋 I’m ${assistant}, and I’m connected to Conch on your computer. Ask me anything.`,
              },
            ]
          : [{ id: 'h', from: 'you', text: '你好' }]
      }
      footer={<Handset.Composer placeholder={`发送给 ${channel?.bot.name ?? assistant}`} />}
    />
  );
}
