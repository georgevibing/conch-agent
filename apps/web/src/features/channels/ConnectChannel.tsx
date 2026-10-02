import {
  type Channel,
  type ChannelKind,
  type ChannelSecrets,
  DISCORD_TOKEN,
  ImportSourceId,
  type ImportSlackHalf,
  SLACK_APP_TOKEN,
  SLACK_BOT_TOKEN,
  TELEGRAM_TOKEN,
} from '@conch/protocol';
import {
  Button,
  Callout,
  CodeBlock,
  Collapsible,
  CopyButton,
  Field,
  GuideSteps,
  Handset,
  Heading,
  Input,
  IntegrationLogo,
  KeyField,
  PortalSketch,
  QRCode,
  Stack,
  Text,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useAppState } from '../../api/queries';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { importApi } from '../import/api';
import { channelsApi } from './api';
import styles from './Channels.module.css';
import { APPS, isKind } from './describe';
import {
  BOTFATHER_URL,
  DISCORD_PORTAL_URL,
  randomDigits,
  slackAppUrl,
  slackCreateUrl,
  slackManifest,
  telegramNames,
} from './guides';
import { EmailSetup } from './ConnectEmail';
import { ImessageSetup } from './ConnectImessage';
import { HelloStep } from './HelloStep';
import { LinkedSetup } from './LinkedSetup';
import { TALK_PATH } from '../integrations/paths';
import { MatrixSetup } from './MatrixSetup';
import { TeamsSetup } from './TeamsSetup';
import { WeChatSetup } from './WeChatSetup';
import { useKeyCheck, usePasteAnywhere, usePointerFine } from './hooks';
import { errorText, putChannel, useChannel } from './queries';

/** `/channels/new/:kind`: connect one app, step by step, beside a picture of what you'll see. */
export function ConnectChannel({ kind }: { kind: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isKind(kind)) void navigate('/apps?show=talk', { replace: true });
  }, [kind, navigate]);
  if (!isKind(kind)) return null;
  if (kind === 'telegram') return <TelegramSetup />;
  if (kind === 'discord') return <DiscordSetup />;
  if (kind === 'whatsapp' || kind === 'signal') return <LinkedSetup kind={kind} />;
  if (kind === 'imessage') return <ImessageSetup />;
  if (kind === 'email') return <EmailSetup />;
  if (kind === 'microsoftteams') return <TeamsSetup />;
  if (kind === 'matrix') return <MatrixSetup />;
  if (kind === 'wechat') return <WeChatSetup />;
  return <SlackSetup />;
}

/** The page around a setup: the path on the left, the picture on the right. */
export function SetupPage({
  kind,
  intro,
  preview,
  children,
}: {
  kind: ChannelKind;
  intro: ReactNode;
  preview: ReactNode;
  children: ReactNode;
}) {
  const app = APPS[kind];
  return (
    <div className={styles.page}>
      <div className={styles.setup}>
        <div className={styles.setupMain}>
          <Button
            asChild
            variant="ghost"
            tone="neutral"
            size="sm"
            leadingIcon={<ArrowLeft />}
            className={styles.back}
          >
            <Link to={TALK_PATH}>Apps</Link>
          </Button>
          <Stack gap={2}>
            <IntegrationLogo brand={kind} name={app.name} color={app.color} size="lg" decorative />
            <Heading level={1} display size="4xl">
              Connect {app.name}
            </Heading>
            <Text tone="muted">{intro}</Text>
          </Stack>
          {children}
        </div>
        <aside className={styles.setupPreview} aria-label={`What you’ll see in ${app.name}`}>
          {preview}
        </aside>
      </div>
    </div>
  );
}

/**
 * Keeps the key, connects, and remembers the channel made (for the steps
 * after). `create` connects another way: a Slack bot brought from another
 * app with one key, finished with the other (ADR 0042).
 */
export function useConnect(
  create: (secrets: ChannelSecrets) => Promise<Channel> = channelsApi.create,
) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [id, setId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const tried = useRef<string>(undefined);
  const { channel } = useChannel(id);

  const connect = async (secrets: ChannelSecrets) => {
    const key = JSON.stringify(secrets);
    if (tried.current === key || busy) return;
    tried.current = key;
    setBusy(true);
    setError(undefined);
    try {
      await guard(async () => {
        const made = await create(secrets);
        putChannel(client, made);
        setId(made.id);
      });
    } catch (e) {
      // The same key isn't tried again by itself (that would loop); a changed one is.
      setError(errorText(e, 'Couldn’t connect it.'));
    } finally {
      setBusy(false);
    }
  };
  /** A new key is a new try: forget the last one's failure. */
  const reset = () => setError(undefined);
  return { channel, connect, busy, error, reset, dialog };
}

export function Answer({ label, value }: { label: string; value: string }) {
  return (
    <Field>
      <Field.Label size="sm">{label}</Field.Label>
      <Input
        readOnly
        value={value}
        size="sm"
        trailing={<CopyButton value={value} label={`Copy the ${label.toLowerCase()}`} />}
      />
    </Field>
  );
}

export function OpenButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="solid" trailingIcon={<SquareArrowOutUpRight />} className={styles.fit}>
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    </Button>
  );
}

export const stepState = (index: number, at: number) =>
  index < at ? 'done' : index === at ? 'current' : 'upcoming';

// ── Telegram ─────────────────────────────────────────────────────────────

const FAKE_TOKEN = '7312945602:' + 'AAHf3kX9-2mQpLr8TzV1bN4cWd7YeUo0sJg';

function TelegramSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const fine = usePointerFine();
  const assistant = state.data?.persona.name ?? 'Conch';
  const owner = state.data?.profile.name || undefined;
  const [digits] = useState(randomDigits);
  const names = telegramNames(assistant, owner, digits);
  const [made, setMade] = useState(false);
  const [token, setToken] = useState('');
  const body = token.trim() ? ({ kind: 'telegram', token } as const) : undefined;
  const { status, check } = useKeyCheck(body, token);
  const { channel, connect, busy, error, reset, dialog } = useConnect();

  // A good key connects straight away: there's nothing else to decide.
  useEffect(() => {
    if (status === 'ok' && !channel) void connect({ kind: 'telegram', token });
  });
  usePasteAnywhere(
    TELEGRAM_TOKEN,
    (found) => {
      setMade(true);
      setToken(found);
    },
    !channel,
  );

  const at = channel ? 2 : made || token ? 1 : 0;
  const bot = check?.ok ? check.bot : channel?.bot;

  return (
    <SetupPage
      kind="telegram"
      intro="About two minutes. You make a bot of your own in Telegram, and your assistant answers through it. Only you can talk to it."
      preview={<TelegramPreview at={at} names={names} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect Telegram">
        <GuideSteps.Step
          number={1}
          title="Make your bot in Telegram"
          state={stepState(0, at)}
          summary="Made with BotFather"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            Bots are made by <b>BotFather</b>, Telegram’s own bot. Open it and send <b>/newbot</b>.
            It asks two questions; these answers work:
          </Text>
          <div className={styles.answers}>
            <Answer label="Name" value={names.name} />
            <Answer label="Username" value={names.username} />
          </div>
          <Text size="sm" tone="subtle">
            If the username is taken, change the number. It has to end in “bot”.
          </Text>
          <div className={styles.openRow}>
            <OpenButton href={BOTFATHER_URL}>Open BotFather</OpenButton>
            {fine && (
              <span className={styles.qrSmall}>
                <QRCode
                  value={BOTFATHER_URL}
                  size={72}
                  label="Scan to open BotFather on your phone"
                />
                <Text size="xs" tone="subtle">
                  Or scan it
                  <br />
                  with your phone
                </Text>
              </span>
            )}
          </div>
          {fine && (
            <Text size="sm" tone="subtle">
              When BotFather sends the key, copy it and press Ctrl+V anywhere on this page.
            </Text>
          )}
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            I have the key
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Paste its key"
          state={stepState(1, at)}
          summary={bot?.username ? `Connected @${bot.username}` : 'Connected'}
        >
          <KeyField
            label="Bot key"
            value={token}
            onValueChange={(v) => {
              reset();
              setToken(v);
            }}
            status={error ? 'error' : status}
            placeholder="123456789:ABC…"
            checkingLabel="Checking with Telegram…"
            description="It’s in BotFather’s last message. Pasting the whole message is fine."
            found={
              <>
                Found <b>@{bot?.username}</b>. {busy ? 'Connecting…' : ''}
              </>
            }
            error={error ?? (check && !check.ok ? check.message : undefined)}
            focusOnShow
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

function TelegramPreview({
  at,
  names,
  channel,
  assistant,
}: {
  at: number;
  names: { name: string; username: string };
  channel?: Channel;
  assistant: string;
}) {
  if (!channel || at < 2)
    return (
      <Handset
        label="BotFather in Telegram"
        brand="telegram"
        color={APPS.telegram.color}
        title="BotFather"
        subtitle="bot"
        messages={[
          { id: '1', from: 'you', text: '/newbot' },
          { id: '2', from: 'them', text: 'Alright, a new bot. How are we going to call it?' },
          { id: '3', from: 'you', text: names.name },
          {
            id: '4',
            from: 'them',
            text: 'Good. Now let’s choose a username for your bot. It must end in “bot”.',
          },
          { id: '5', from: 'you', text: names.username },
          {
            id: '6',
            from: 'them',
            text: (
              <>
                <p>Done! Congratulations on your new bot.</p>
                <p>
                  Use this token to access the HTTP API:
                  <br />
                  <Handset.Key>{FAKE_TOKEN}</Handset.Key>
                </p>
              </>
            ),
          },
        ]}
        footer={<Handset.Composer />}
      />
    );
  const owner = channel.people[0];
  return (
    <Handset
      label="Your bot in Telegram"
      brand="telegram"
      color={APPS.telegram.color}
      title={channel.bot.name}
      subtitle="bot"
      avatar={channel.bot.avatar}
      alive={!owner}
      messages={
        owner
          ? [
              { id: 's', from: 'you', text: '/start' },
              {
                id: 'w',
                from: 'them',
                text: (
                  <p>
                    Hi {owner.name.split(' ')[0]}! 👋 I’m <b>{assistant}</b>, and I’m connected to
                    Conch on your computer. Ask me anything.
                  </p>
                ),
              },
            ]
          : [
              {
                id: 'd',
                from: 'them',
                text: `I’m ${assistant}. I run on your computer through Conch and can do everything there. I’m private: only people who were let in can talk to me.`,
              },
            ]
      }
      footer={owner ? <Handset.Composer /> : <Handset.Action>START</Handset.Action>}
    />
  );
}

// ── Discord ──────────────────────────────────────────────────────────────

function DiscordSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [made, setMade] = useState(false);
  const [token, setToken] = useState('');
  const [skipInvite, setSkipInvite] = useState(false);
  const body = token.trim() ? ({ kind: 'discord', token } as const) : undefined;
  const { status, check } = useKeyCheck(body, token);
  const { channel, connect, busy, error, reset, dialog } = useConnect();

  useEffect(() => {
    if (status === 'ok' && !channel) void connect({ kind: 'discord', token });
  });
  usePasteAnywhere(
    DISCORD_TOKEN,
    (found) => {
      setMade(true);
      setToken(found);
    },
    !channel,
  );

  const inServer = Boolean(channel && (channel.bot.servers ?? 0) > 0) || skipInvite;
  const at = channel ? (inServer ? 3 : 2) : made || token ? 1 : 0;
  const bot = check?.ok ? check.bot : channel?.bot;

  return (
    <SetupPage
      kind="discord"
      intro="About four minutes. You make a Discord app of your own, add it to your server, and message it privately. Nothing to turn on in its settings: Conch handles that."
      preview={<DiscordPreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect Discord">
        <GuideSteps.Step
          number={1}
          title="Make a Discord app"
          state={stepState(0, at)}
          summary="Made in the Developer Portal"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            Open the Developer Portal (sign in with your Discord account), press{' '}
            <b>New Application</b>, name it <b>{assistant}</b>, tick the box and press <b>Create</b>
            .
          </Text>
          <OpenButton href={DISCORD_PORTAL_URL}>Open the Developer Portal</OpenButton>
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            I made it
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Copy its token"
          state={stepState(1, at)}
          summary={bot?.username ? `Connected @${bot.username}` : 'Connected'}
        >
          <Text tone="muted">
            In your app, open <b>Bot</b> on the left, press <b>Reset Token</b>, confirm, then press{' '}
            <b>Copy</b>.
          </Text>
          <KeyField
            label="Bot token"
            value={token}
            onValueChange={(v) => {
              reset();
              setToken(v);
            }}
            status={error ? 'error' : status}
            placeholder="MTEw…"
            checkingLabel="Checking with Discord…"
            description="Discord shows it once. If you lost it, press Reset Token again."
            found={
              <>
                Found <b>@{bot?.username}</b>. {busy ? 'Connecting…' : ''}
              </>
            }
            error={error ?? (check && !check.ok ? check.message : undefined)}
            focusOnShow
          />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={3}
          title="Add it to your server"
          state={stepState(2, at)}
          summary="In your server"
        >
          <Text tone="muted">
            Discord only lets you message a bot you share a server with. Add it to yours: it gets no
            permissions, so it can’t read or post anything there.
          </Text>
          {channel?.bot.inviteUrl && (
            <OpenButton href={channel.bot.inviteUrl}>Add {channel.bot.name} to Discord</OpenButton>
          )}
          <Text size="sm" tone="subtle">
            No server of your own? In Discord, press <b>+</b> in the list of servers, then{' '}
            <b>Create My Own</b> → <b>For me and my friends</b>. It takes ten seconds.
          </Text>
          <Text size="sm" tone="subtle" aria-live="polite">
            This step ticks itself off when the bot arrives.
          </Text>
          <Button
            variant="ghost"
            size="sm"
            className={styles.fit}
            onClick={() => setSkipInvite(true)}
          >
            It’s already in my server
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step number={4} title="Say hello" state={stepState(3, at)}>
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

function DiscordPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.discord.color;
  if (at === 0)
    return (
      <PortalSketch
        label="The Discord Developer Portal"
        address="discord.com/developers/applications"
        nav={['Applications', 'Teams', 'Embedded App Directory']}
        active="Applications"
        title="Applications"
        color={color}
      >
        <PortalSketch.Row>
          <PortalSketch.Button>New Application</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Field label="Name">{assistant}</PortalSketch.Field>
        <PortalSketch.Bar width={75} />
        <PortalSketch.Bar width={50} />
      </PortalSketch>
    );
  if (at === 1)
    return (
      <PortalSketch
        label="Your app’s Bot page in the Developer Portal"
        address="discord.com/developers/applications"
        nav={['General Information', 'Installation', 'OAuth2', 'Bot', 'Emojis']}
        active="Bot"
        title="Bot"
        color={color}
      >
        <PortalSketch.Bar width={60} />
        <PortalSketch.Field label="Token" />
        <PortalSketch.Row>
          <PortalSketch.Button>Reset Token</PortalSketch.Button>
          <PortalSketch.Button quiet>Copy</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Bar width={80} />
        <PortalSketch.Bar width={45} />
      </PortalSketch>
    );
  if (at === 2)
    return (
      <PortalSketch
        label="Discord asking where to add the bot"
        address="discord.com/oauth2/authorize"
        title={`Add ${channel?.bot.name ?? assistant} to a server`}
        color={color}
      >
        <PortalSketch.Field label="Add to server">My server</PortalSketch.Field>
        <PortalSketch.Bar width={70} />
        <PortalSketch.Row>
          <PortalSketch.Button quiet>Back</PortalSketch.Button>
          <PortalSketch.Button>Authorize</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Your bot in Discord"
      brand="discord"
      color={color}
      title={channel?.bot.name ?? assistant}
      subtitle="bot"
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
      footer={<Handset.Composer placeholder={`Message @${channel?.bot.username ?? 'bot'}`} />}
    />
  );
}

// ── Slack ────────────────────────────────────────────────────────────────

/**
 * A Slack bot another app had one of the two keys for (ADR 0042): offered
 * here, and used when the person came from Come home or says so. The key
 * itself never reaches the page; the gateway adds it when connecting.
 */
function useSlackHalf() {
  const [params] = useSearchParams();
  const from = ImportSourceId.safeParse(params.get('from'));
  const source = from.success ? from.data : undefined;
  const { data } = useQuery({
    queryKey: ['import', 'slack', source],
    queryFn: () => importApi.slack(source),
    staleTime: 60_000,
    retry: false,
  });
  const [chosen, setChosen] = useState(false);
  const half = data?.half;
  const usable = half && !half.problem ? half : undefined;
  const used =
    usable && (chosen || (from.success && from.data === usable.source)) ? usable : undefined;
  return { half, used, use: () => setChosen(true), from: from.success ? from.data : undefined };
}

function SlackHalfNote({
  half,
  used,
  onUse,
  from,
}: {
  half: ImportSlackHalf | undefined;
  used: ImportSlackHalf | undefined;
  onUse: () => void;
  from: string | undefined;
}) {
  if (!half || used) return null;
  if (half.problem)
    return from === half.source ? <Callout tone="warning" title={half.problem} /> : null;
  return (
    <Callout
      tone="info"
      title={`${half.label} had this bot’s ${half.has === 'botToken' ? 'bot token' : 'app-level token'}`}
      action={
        <Button size="sm" variant="surface" onClick={onUse}>
          Use it
        </Button>
      }
    >
      {half.bot
        ? `It’s ${half.bot.name}${half.bot.workspace ? ` in ${half.bot.workspace}` : ''}. `
        : ''}
      Then you only need the other key.
    </Callout>
  );
}

function SlackSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [created, setCreated] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const { half, used, use, from } = useSlackHalf();
  // From Slack's page in Apps (ADR 0052): the app is made already, with the user token Slack
  // in Apps has. Its bot token and app-level token are separate keys, copied on purpose.
  const [params] = useSearchParams();
  const fromApp = !used && params.get('with') === 'app';

  // Keys pasted into each other's boxes are put right.
  const place = (value: string, into: 'bot' | 'app') => {
    const bot = SLACK_BOT_TOKEN.exec(value)?.[1];
    const app = SLACK_APP_TOKEN.exec(value)?.[1];
    if (bot) setBotToken(bot);
    if (app) setAppToken(app);
    if (!bot && !app) (into === 'bot' ? setBotToken : setAppToken)(value);
  };
  usePasteAnywhere(/\b(x(?:oxb|app)-[A-Za-z0-9-]{20,250})\b/, (found) => {
    setCreated(true);
    place(found, 'bot');
  });

  const botCheck = useKeyCheck(botToken.trim() ? { kind: 'slack', botToken } : undefined, botToken);
  const appCheck = useKeyCheck(
    appToken.trim() ? { kind: 'slack', botToken: botToken || undefined, appToken } : undefined,
    appToken,
  );
  const { channel, connect, busy, error, reset, dialog } = useConnect(
    used
      ? // Only the key that was missing travels; the gateway has the other.
        (secrets) =>
          importApi.finishSlack(
            used.source,
            secrets.kind === 'slack'
              ? used.has === 'botToken'
                ? { appToken: secrets.appToken }
                : { botToken: secrets.botToken }
              : {},
          )
      : undefined,
  );
  const hasBot = used?.has === 'botToken';
  const hasApp = used?.has === 'appToken';
  const botOk = hasBot || botCheck.status === 'ok';
  const appOk = hasApp || appCheck.status === 'ok';
  useEffect(() => {
    if (botOk && appOk && !channel)
      // With a bot from another app, the key it had is empty here: the gateway adds it.
      void connect({ kind: 'slack', botToken, appToken });
  });

  const at = channel ? 3 : botOk ? 2 : used || fromApp || created || botToken ? 1 : 0;
  const bot = botCheck.check?.ok ? botCheck.check.bot : (channel?.bot ?? used?.bot);
  // The app's id, from a key: links go straight to its own settings pages.
  const appId =
    used?.appId ??
    (botCheck.check?.ok ? botCheck.check.appId : undefined) ??
    (appCheck.check?.ok ? appCheck.check.appId : undefined);
  const manifest = JSON.stringify(slackManifest(assistant), null, 2);
  const kept = used && `From ${used.label}`;

  return (
    <SetupPage
      kind="slack"
      intro={
        used
          ? `Your Slack app is already made: ${used.label} had one of its two keys. Get the other from Slack, and it’s connected.`
          : fromApp
            ? `Your Slack app is already made: Slack in Apps uses it. Copy two more keys from it, and you can message ${assistant} there.`
            : 'About four minutes. Slack makes the app from settings Conch fills in; you press a few buttons and copy two keys.'
      }
      preview={<SlackPreview at={at} channel={channel} assistant={assistant} />}
    >
      <SlackHalfNote half={half} used={used} onUse={use} from={from} />
      <GuideSteps label="Connect Slack">
        <GuideSteps.Step
          number={1}
          title="Make the Slack app"
          state={used || fromApp ? 'done' : stepState(0, at)}
          summary={
            used
              ? `Made, in ${used.label}`
              : fromApp
                ? 'Made: Slack in Apps uses it'
                : 'Made in Slack'
          }
          onEdit={channel || used || fromApp ? undefined : () => setCreated(false)}
        >
          <Text tone="muted">
            This opens Slack with everything filled in. Pick your workspace, press <b>Next</b>, then{' '}
            <b>Create</b>.
          </Text>
          <OpenButton href={slackCreateUrl(assistant)}>Make the app in Slack</OpenButton>
          <Collapsible>
            <Collapsible.Trigger asChild>
              <Button variant="ghost" size="sm" className={styles.fit}>
                Slack showed an empty form?
              </Button>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <Stack gap={2} className={styles.fallback}>
                <Text size="sm" tone="muted">
                  Press <b>Create New App</b> → <b>From a manifest</b>, pick your workspace, and
                  paste this in place of what’s there:
                </Text>
                <CodeBlock
                  code={manifest}
                  language="json"
                  filename="Slack app settings"
                  maxLines={12}
                />
              </Stack>
            </Collapsible.Content>
          </Collapsible>
          <Button variant="ghost" className={styles.fit} onClick={() => setCreated(true)}>
            I made it
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title={fromApp ? 'Copy its bot token' : 'Install it, and copy its key'}
          state={hasBot ? 'done' : stepState(1, at)}
          summary={
            hasBot
              ? `${kept}${bot ? `: ${bot.name}${bot.workspace ? ` in ${bot.workspace}` : ''}` : ''}`
              : bot?.workspace
                ? `Installed in ${bot.workspace}`
                : 'Installed'
          }
        >
          {hasApp ? (
            <>
              <Text tone="muted">
                {used?.label} only had the app-level token. Open your app’s <b>Install App</b> page
                and press <b>Install to Workspace</b> (or <b>Reinstall</b>), then <b>Allow</b>. Copy
                the <b>Bot User OAuth Token</b> it shows.
              </Text>
              <OpenButton href={slackAppUrl(appId, 'install-on-team')}>
                Open your app’s Install App page
              </OpenButton>
            </>
          ) : fromApp ? (
            <>
              <Text tone="muted">
                Open your app’s <b>Install App</b> page, where you copied the User OAuth Token. Copy
                the <b>Bot User OAuth Token</b> from the same page.
              </Text>
              <OpenButton href={slackAppUrl(appId, 'install-on-team')}>
                Open your Slack apps
              </OpenButton>
            </>
          ) : (
            <Text tone="muted">
              In your app’s settings, open <b>Install App</b> and press <b>Install to Workspace</b>,
              then <b>Allow</b>. Copy the <b>Bot User OAuth Token</b> it shows.
            </Text>
          )}
          <KeyField
            label="Bot token"
            value={botToken}
            onValueChange={(v) => {
              reset();
              place(v, 'bot');
            }}
            status={hasApp && error ? 'error' : botCheck.status}
            placeholder="xoxb-…"
            checkingLabel="Checking with Slack…"
            description="It starts with xoxb-."
            found={
              <>
                Found <b>{bot?.name}</b> in {bot?.workspace ?? 'your workspace'}.{' '}
                {hasApp && busy ? 'Connecting…' : ''}
              </>
            }
            error={
              (hasApp ? error : undefined) ??
              (botCheck.check && !botCheck.check.ok ? botCheck.check.message : undefined)
            }
            focusOnShow
          />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={3}
          title="Let it stay connected"
          state={hasApp ? 'done' : stepState(2, at)}
          summary={hasApp ? kept : 'Connected'}
        >
          {hasBot ? (
            <>
              <Text tone="muted">
                {used?.label} only had the bot token, so Slack needs the app-level token too. Open
                your app’s <b>Socket Mode</b> page and turn on <b>Enable Socket Mode</b>. Slack asks
                for a token: name it “conch”, keep the <b>connections:write</b> scope it suggests,
                and press <b>Generate</b>. Copy the token.
              </Text>
              <OpenButton href={slackAppUrl(appId, 'socket-mode')}>
                Open your app’s Socket Mode page
              </OpenButton>
            </>
          ) : (
            <>
              <Text tone="muted">
                Open <b>Basic Information</b>, scroll to <b>App-Level Tokens</b> and press{' '}
                <b>Generate Token and Scopes</b>. Name it “conch”, press <b>Add Scope</b>, choose{' '}
                <b>connections:write</b>, then <b>Generate</b>. Copy the token.
              </Text>
              {appId && (
                <OpenButton href={slackAppUrl(appId, 'general')}>
                  Open your app’s Basic Information
                </OpenButton>
              )}
            </>
          )}
          <KeyField
            label="App-level token"
            value={appToken}
            onValueChange={(v) => {
              reset();
              place(v, 'app');
            }}
            status={error && !hasApp ? 'error' : appCheck.status}
            placeholder="xapp-…"
            checkingLabel="Checking with Slack…"
            description="It starts with xapp-. This lets Conch reach Slack without a public address."
            found={<>That’s the one. {busy ? 'Connecting…' : ''}</>}
            error={
              (hasApp ? undefined : error) ??
              (appCheck.check && !appCheck.check.ok ? appCheck.check.message : undefined)
            }
          />
        </GuideSteps.Step>
        <GuideSteps.Step number={4} title="Say hello" state={stepState(3, at)}>
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

function SlackPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.slack.color;
  const nav = [
    'Basic Information',
    'Install App',
    'OAuth & Permissions',
    'Socket Mode',
    'App Home',
  ];
  if (at === 0)
    return (
      <PortalSketch
        label="Slack making your app"
        address="api.slack.com/apps"
        title="Create an app"
        color={color}
      >
        <PortalSketch.Field label="Pick a workspace to develop your app in">
          Your workspace
        </PortalSketch.Field>
        <PortalSketch.Bar width={65} />
        <PortalSketch.Row>
          <PortalSketch.Button quiet>Cancel</PortalSketch.Button>
          <PortalSketch.Button>Next</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  if (at === 1)
    return (
      <PortalSketch
        label="Your Slack app, on Install App"
        address="api.slack.com/apps"
        nav={nav}
        active="Install App"
        title="Install App"
        color={color}
      >
        <PortalSketch.Row>
          <PortalSketch.Button>Install to Workspace</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Field label="Bot User OAuth Token">xoxb-1234-5678-AbCdEf…</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button quiet>Copy</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  if (at === 2)
    return (
      <PortalSketch
        label="Your Slack app, on Basic Information"
        address="api.slack.com/apps"
        nav={nav}
        active="Basic Information"
        title="App-Level Tokens"
        color={color}
      >
        <PortalSketch.Bar width={70} />
        <PortalSketch.Row>
          <PortalSketch.Button>Generate Token and Scopes</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Field label="Token Name">conch</PortalSketch.Field>
        <PortalSketch.Field label="Scope">connections:write</PortalSketch.Field>
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Your app in Slack"
      brand="slack"
      title={channel?.bot.name ?? assistant}
      subtitle="App"
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
      footer={<Handset.Composer placeholder={`Message ${channel?.bot.name ?? assistant}`} />}
    />
  );
}
