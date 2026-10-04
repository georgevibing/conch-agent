import type { Channel, ReplaceChannelTokenBody } from '@conch/protocol';
import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  ChannelRequest,
  channelStateMeta,
  EmptyState,
  Heading,
  IntegrationLogo,
  KeyField,
  Page,
  PersonRow,
  Skeleton,
  Stack,
  Switch,
  Text,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, RotateCw, Send, Unplug } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useAppState, useConversations } from '../../api/queries';
import { relativeTime } from '../../lib/time';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from './api';
import styles from './Channels.module.css';
import { FullDiskAccessSteps, openOnMac, useImessageSetup } from './ConnectImessage';
import {
  APPS,
  channelState,
  handleOf,
  isLinkedKind,
  isOwnAccount,
  readablePhone,
  whereYouTalk,
  whoOf,
} from './describe';
import { LinkStep } from './LinkedSetup';
import { GetIt } from '../setup/GetIt';
import { HelloStep } from './HelloStep';
import { HookSection } from './HookSection';
import { SignInAgain } from './SignInAgain';
import { VoiceNotesSection } from './VoiceNotesSection';
import { useKeyCheck } from './hooks';
import {
  channelKeys,
  errorText,
  putChannel,
  useChannel,
  useChannelAction,
  useChannels,
} from './queries';
import { AlwaysOnHint } from '../background/AlwaysOnHint';
import { googleApi } from '../integrations/googleApi';
import { appPath, connectPath, TALK_PATH } from '../integrations/paths';
import { integrationKeys, useIntegrations } from '../integrations/queries';

/** The apps a channel can be a half of (ADR 0052), for the way back. */
const CATALOG_NAMES: Partial<Record<string, string>> = { slack: 'Slack', gmail: 'Gmail' };

/** `/channels/:id`: one channel — who can talk to it, how it's doing, and its settings. */
export function ChannelDetailView({ channelId }: { channelId: string }) {
  const { channel, isPending } = useChannel(channelId);
  const navigate = useNavigate();
  if (isPending)
    return (
      <Page gap={8}>
        <Skeleton shape="block" height="6rem" />
      </Page>
    );
  if (!channel)
    return (
      <Page gap={8}>
        <EmptyState
          title="That isn’t connected any more"
          description="It may have been disconnected on another device."
          actions={<Button onClick={() => void navigate(TALK_PATH)}>See all apps</Button>}
        />
      </Page>
    );
  return <Detail channel={channel} />;
}

function Detail({ channel }: { channel: Channel }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const assistant = useAppState().data?.persona.name ?? 'Conch';
  const { data: conversations } = useConversations();
  const { data: catalog } = useChannels();
  const [confirm, setConfirm] = useState(false);
  const [testing, setTesting] = useState(false);
  const update = useChannelAction(
    (patch: Parameters<typeof channelsApi.update>[1]) => channelsApi.update(channel.id, patch),
    'Couldn’t change that.',
  );
  const repair = useChannelAction(() => channelsApi.repair(channel.id), 'Repair didn’t work.');
  const answer = useChannelAction((personId: string, how: 'allow' | 'block' | 'dismiss') =>
    channelsApi.answer(channel.id, personId, how),
  );
  const removePerson = useChannelAction((personId: string) =>
    channelsApi.removePerson(channel.id, personId),
  );
  const setGroup = useChannelAction(
    (groupId: string, on: boolean) => channelsApi.setGroup(channel.id, groupId, on),
    'Couldn’t change that.',
  );
  const forgetGroup = useChannelAction((groupId: string) =>
    channelsApi.forgetGroup(channel.id, groupId),
  );
  const answersGroups =
    channel.groups.length > 0 ||
    (catalog?.catalog.find((entry) => entry.id === channel.kind)?.groups ?? false);

  const app = APPS[channel.kind];
  const state = channelState(channel);
  const meta = channelStateMeta[state];
  const handle = handleOf(channel);
  const chats = (conversations ?? []).filter(
    (c) => c.origin?.kind === 'channel' && c.origin.channelId === channel.id,
  );
  const owner = channel.people[0];

  const test = async () => {
    setTesting(true);
    try {
      await channelsApi.test(channel.id);
      toast.success(`Sent. Look in ${app.name}.`);
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t send the test message.'));
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    try {
      await channelsApi.remove(channel.id);
      client.setQueryData(channelKeys.all, (data: { channels: Channel[] } | undefined) =>
        data ? { ...data, channels: data.channels.filter((c) => c.id !== channel.id) } : data,
      );
      toast(`${app.name} is disconnected.`);
      void navigate(TALK_PATH);
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t disconnect it.'));
    }
  };

  return (
    <Page gap={8}>
      <Button
        asChild
        variant="ghost"
        tone="neutral"
        size="sm"
        leadingIcon={<ArrowLeft />}
        className={styles.back}
      >
        {/* Back to the app it's a half of (Slack, Gmail), or to Apps. */}
        <Link to={channel.app ? appPath(channel.app) : TALK_PATH}>
          {channel.app ? (CATALOG_NAMES[channel.app] ?? 'Apps') : 'Apps'}
        </Link>
      </Button>

      <header className={styles.detailHeader}>
        {channel.bot.avatar ? (
          <img src={channel.bot.avatar} alt="" className={styles.avatar} />
        ) : (
          <IntegrationLogo
            brand={channel.kind}
            name={app.name}
            color={app.color}
            size="lg"
            decorative
          />
        )}
        <div className={styles.detailTitle}>
          <Heading level={1} size="2xl">
            {channel.bot.name}
          </Heading>
          <Stack direction="row" gap={2} align="center" wrap>
            <Text size="sm" tone="muted">
              {handle
                ? `@${handle} on ${app.name}`
                : channel.bot.phone
                  ? `${readablePhone(channel.bot.phone)} on ${app.name}`
                  : channel.bot.address
                    ? `${channel.bot.address} on ${app.name}`
                    : `${app.name}${channel.bot.workspace ? `, ${channel.bot.workspace}` : ''}`}
            </Text>
            <Badge tone={meta.tone} dot={state === 'online' ? true : undefined}>
              {meta.label}
            </Badge>
          </Stack>
        </div>
        <div className={styles.detailActions}>
          {owner && channel.enabled && (
            <Button
              variant="surface"
              leadingIcon={<Send />}
              loading={testing}
              onClick={() => void test()}
            >
              Send a test
            </Button>
          )}
          <Switch
            checked={channel.enabled}
            onCheckedChange={(enabled) =>
              void guard(() => update.mutateAsync([{ enabled }])).catch(() => undefined)
            }
            aria-label={channel.enabled ? `Turn off ${app.name}` : `Turn on ${app.name}`}
          />
        </div>
      </header>

      <Health channel={channel} onRepair={() => repair.mutate([])} repairing={repair.isPending} />

      <OtherHalf channel={channel} />

      {channel.enabled && <AlwaysOnHint what={`${app.name} reaches you`} />}

      {channel.kind === 'discord' &&
        channel.enabled &&
        (channel.bot.servers ?? 0) === 0 &&
        channel.bot.inviteUrl && (
          <Callout
            tone="info"
            title="Add it to your server"
            action={
              <Button asChild size="sm" variant="solid">
                <a href={channel.bot.inviteUrl} target="_blank" rel="noreferrer noopener">
                  Add to Discord
                </a>
              </Button>
            }
          >
            Discord only lets you message a bot you share a server with. It gets no permissions
            there.
          </Callout>
        )}

      {channel.enabled && <HookSection channel={channel} />}

      {!owner && channel.enabled && (
        <section aria-labelledby="ch-hello" className={styles.section}>
          <Heading level={2} id="ch-hello" size="sm" tone="muted">
            Finish setting up
          </Heading>
          <HelloStep channel={channel} />
        </section>
      )}

      {owner && channel.requests.length > 0 && (
        <section aria-labelledby="ch-requests" className={styles.section}>
          <Heading level={2} id="ch-requests" size="sm" tone="muted">
            Waiting to be let in
          </Heading>
          {channel.requests.map((request) => (
            <ChannelRequest
              key={request.id}
              name={request.name}
              username={request.username}
              preview={request.preview}
              count={request.count}
              when={relativeTime(request.at)}
              allowing={answer.isPending && answer.variables?.[0] === request.id}
              onAllow={() =>
                void guard(() => answer.mutateAsync([request.id, 'allow'])).catch(() => undefined)
              }
              onBlock={() => answer.mutate([request.id, 'block'])}
              onDismiss={() => answer.mutate([request.id, 'dismiss'])}
            />
          ))}
        </section>
      )}

      {owner && (
        <section aria-labelledby="ch-people" className={styles.section}>
          <Heading level={2} id="ch-people" size="sm" tone="muted">
            Who can talk to {assistant} here
          </Heading>
          <ul className={styles.people}>
            {channel.people.map((person, index) => (
              <PersonRow
                key={person.id}
                name={person.name}
                username={person.username}
                badge={index === 0 ? 'You' : undefined}
                meta={
                  person.lastSeenAt
                    ? `Last message ${relativeTime(person.lastSeenAt)}`
                    : `Let in ${relativeTime(person.since)}`
                }
                onRemove={index === 0 ? undefined : () => removePerson.mutate([person.id])}
                removeLabel={`Stop ${person.name} talking to ${assistant}`}
              />
            ))}
          </ul>
          <Text size="sm" tone="subtle">
            {isOwnAccount(channel.kind)
              ? channel.settings.others === 'ask'
                ? `You talk to ${assistant} ${whereYouTalk(channel)}. Anyone else who writes to ${whoOf(channel)} gets one polite reply and shows up here for you to let in or block. Groups never hear from it.`
                : `You talk to ${assistant} ${whereYouTalk(channel)}. Other people who write to ${whoOf(channel)} are writing to you: Conch never reads their chats, or your groups.`
              : `Anyone else who writes to ${whoOf(channel)} gets one polite reply and shows up here for you to let in or block.`}
            {channel.blocked > 0 &&
              ` You’ve blocked ${channel.blocked === 1 ? 'one person' : `${channel.blocked} people`}.`}
          </Text>
        </section>
      )}

      {owner && answersGroups && (
        <section aria-labelledby="ch-groups" className={styles.section}>
          <Heading level={2} id="ch-groups" size="sm" tone="muted">
            Groups
          </Heading>
          {channel.groups.length === 0 ? (
            <Text size="sm" tone="muted">
              Add {handle ? `@${handle}` : 'the bot'} to a group in {app.name}, and the group shows
              up here. {assistant} won’t answer there until you turn it on.
            </Text>
          ) : (
            <>
              {channel.groups.map((group) => (
                <div key={group.id} className={styles.setting}>
                  <Stack gap={0}>
                    <Text weight="medium" id={`ch-group-${group.id}`}>
                      {group.name}
                    </Text>
                    <Text size="sm" tone="muted">
                      {group.on
                        ? `Answers when mentioned${group.since ? ` · on since ${relativeTime(group.since)}` : ''}`
                        : `Off · last heard from ${relativeTime(group.seenAt)}`}
                    </Text>
                  </Stack>
                  <Stack direction="row" gap={2} align="center">
                    {!group.on && (
                      <Button
                        variant="ghost"
                        tone="neutral"
                        size="sm"
                        onClick={() => forgetGroup.mutate([group.id])}
                        aria-label={`Forget ${group.name}`}
                      >
                        Forget
                      </Button>
                    )}
                    <Switch
                      aria-labelledby={`ch-group-${group.id}`}
                      checked={group.on}
                      onCheckedChange={(on) =>
                        on
                          ? void guard(() => setGroup.mutateAsync([group.id, true])).catch(
                              () => undefined,
                            )
                          : setGroup.mutate([group.id, false])
                      }
                    />
                  </Stack>
                </div>
              ))}
              <Text size="sm" tone="subtle">
                In a group that’s on, {assistant} answers only when someone mentions it or replies
                to it. You get everything you get here. Anyone else gets an answer in words only, on
                your provider: only you can ask it to do things, and it asks you privately first.
              </Text>
            </>
          )}
        </section>
      )}

      {chats.length > 0 && (
        <section aria-labelledby="ch-chats" className={styles.section}>
          <Heading level={2} id="ch-chats" size="sm" tone="muted">
            Conversations from {app.name}
          </Heading>
          <ul className={styles.chats}>
            {chats.slice(0, 8).map((chat) => (
              <li key={chat.id}>
                <Button
                  asChild
                  variant="ghost"
                  tone="neutral"
                  block
                  leadingIcon={<MessageCircle />}
                  style={{ justifyContent: 'flex-start' }}
                >
                  <Link to={`/c/${chat.id}`}>
                    {chat.title}
                    <span className="nc-visually-hidden">, </span>
                    <Text as="span" size="xs" tone="subtle">
                      {' '}
                      {relativeTime(chat.updatedAt)}
                    </Text>
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <VoiceNotesSection
        channel={channel}
        assistant={assistant}
        onReplies={(voiceReplies) => update.mutate([{ settings: { voiceReplies } }])}
      />

      <section aria-labelledby="ch-settings" className={styles.section}>
        <Heading level={2} id="ch-settings" size="sm" tone="muted">
          Settings
        </Heading>
        <div className={styles.setting}>
          <Stack gap={0}>
            <Text weight="medium" id="ch-routines">
              Routine results
            </Text>
            <Text size="sm" tone="muted">
              When a routine finishes, or needs your OK, {assistant} tells you here.
            </Text>
          </Stack>
          <Switch
            aria-labelledby="ch-routines"
            checked={channel.settings.notifyRoutines}
            onCheckedChange={(notifyRoutines) => update.mutate([{ settings: { notifyRoutines } }])}
          />
        </div>
        {isOwnAccount(channel.kind) && (
          <div className={styles.setting}>
            <Stack gap={0}>
              <Text weight="medium" id="ch-others">
                {channel.kind === 'email' ? 'An address' : 'A number'} just for {assistant}
              </Text>
              <Text size="sm" tone="muted">
                Others who write to it can ask to be let in. Leave this off for your own{' '}
                {channel.kind === 'email' ? 'address' : 'number'}, so your friends’ chats stay
                yours.
              </Text>
            </Stack>
            <Switch
              aria-labelledby="ch-others"
              checked={channel.settings.others === 'ask'}
              onCheckedChange={(on) =>
                update.mutate([{ settings: { others: on ? 'ask' : 'ignore' } }])
              }
            />
          </div>
        )}
        <Button
          variant="ghost"
          tone="danger"
          leadingIcon={<Unplug />}
          className={styles.fit}
          onClick={() => setConfirm(true)}
        >
          Disconnect {app.name}
        </Button>
      </section>

      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content tone="danger" icon={<Unplug />}>
          <AlertDialog.Header>
            <AlertDialog.Title>Disconnect {app.name}?</AlertDialog.Title>
            <AlertDialog.Description>
              {channel.kind === 'whatsapp'
                ? `${assistant} stops answering in ${app.name}, Conch leaves your Linked devices and forgets its keys. Your conversations stay here.`
                : channel.kind === 'signal'
                  ? `${assistant} stops answering in ${app.name}, and Conch forgets its keys. Your conversations stay here. Remove Conch under Linked devices in Signal too.`
                  : channel.kind === 'email'
                    ? `${assistant} stops answering ${whoOf(channel)}, and Conch forgets its app password. Your conversations stay here, and your mail stays as it is.`
                    : channel.kind === 'sms'
                      ? `${assistant} stops answering texts to ${whoOf(channel)}, and Conch forgets its Twilio keys. Your conversations stay here, and the number stays yours in Twilio until you release it there.`
                      : channel.kind === 'imessage'
                        ? `${assistant} stops answering ${whoOf(channel)}. Your conversations stay here, and Messages stays as it is.`
                        : `${assistant} stops answering ${whoOf(channel)}, and Conch forgets its key. Your conversations stay here. The bot itself stays in ${app.name} until you delete it there.`}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action tone="danger" onClick={() => void remove()}>
              Disconnect
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {dialog}
    </Page>
  );
}

/** How the connection is, when that's worth saying, with its one next step. */
function Health({
  channel,
  onRepair,
  repairing,
}: {
  channel: Channel;
  onRepair: () => void;
  repairing: boolean;
}) {
  const state = channelState(channel);
  if (state === 'needs-token' && isLinkedKind(channel.kind))
    return (
      <Callout tone="warning" title={`Link ${APPS[channel.kind].name} again`}>
        <Stack gap={3}>
          <Text size="sm">{channel.health.message}</Text>
          <LinkStep kind={channel.kind} channelId={channel.id} auto={false} />
        </Stack>
      </Callout>
    );
  if (state === 'access') return <AccessFix channel={channel} />;
  if (state === 'needs-token' && channel.kind === 'imessage')
    return (
      <Callout
        tone="warning"
        title="Connect it again"
        action={
          <Button asChild size="sm" variant="solid">
            <Link to="/channels/new/imessage">Connect iMessage</Link>
          </Button>
        }
      >
        {channel.health.message}
      </Callout>
    );
  if (
    state === 'needs-token' &&
    (channel.kind === 'microsoftteams' || channel.kind === 'matrix' || channel.kind === 'wechat')
  )
    return <SignInAgain channel={channel} />;
  if (state === 'needs-token') return <ReplaceKey channel={channel} />;
  if (channel.health.need)
    return (
      <Callout tone="warning" title="Something to install first">
        <GetIt needId={channel.health.need} lead={channel.health.message} />
      </Callout>
    );
  if (state === 'conflict' || state === 'error' || state === 'reconnecting')
    return (
      <Callout
        tone={state === 'reconnecting' ? 'info' : 'warning'}
        title={
          state === 'reconnecting'
            ? 'Reconnecting'
            : state === 'conflict'
              ? 'Used by another program'
              : 'Not working'
        }
        action={
          <Button
            size="sm"
            variant="solid"
            leadingIcon={<RotateCw />}
            loading={repairing}
            onClick={onRepair}
          >
            {state === 'reconnecting' ? 'Try now' : 'Repair'}
          </Button>
        }
      >
        {channel.health.message}
        {state === 'reconnecting' && channel.health.retryAt
          ? ` Conch tries again by itself ${relativeTime(channel.health.retryAt)}.`
          : ''}
      </Callout>
    );
  return null;
}

/** The app stopped taking the key: paste the new one here (same bot), and it reconnects. */
function ReplaceKey({ channel }: { channel: Channel }) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [token, setToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const slack = channel.kind === 'slack';
  // An email's app password, or a Twilio Auth Token: only that changes, the rest stays.
  const email = channel.kind === 'email' || channel.kind === 'sms';
  const body =
    email || !token.trim()
      ? undefined
      : slack
        ? ({ kind: 'slack', botToken: token } as const)
        : channel.kind === 'telegram' || channel.kind === 'discord'
          ? ({ kind: channel.kind, token } as const)
          : undefined;
  const checked = useKeyCheck(body, token);
  // An email's app password is checked when you press Reconnect (it needs the rest of the account).
  const { status, check } = email
    ? { status: token.trim() ? ('ok' as const) : ('idle' as const), check: undefined }
    : checked;
  const where: Record<Channel['kind'], string> = {
    telegram: 'Open BotFather, send /token, pick your bot, and copy the new key it sends.',
    discord: 'In the Developer Portal, open your app → Bot → Reset Token, then Copy.',
    slack:
      'In your Slack app’s settings: Install App for the bot token, Basic Information → App-Level Tokens for the other.',
    email:
      'Make a new app password in your mail service’s security settings (the old one was probably removed), and paste it here.',
    whatsapp: '',
    signal: '',
    imessage: '',
    microsoftteams: '',
    matrix: '',
    wechat: '',
    sms: 'On the Twilio Console’s first page, under Account Info, copy the Auth Token (it was probably changed).',
  };

  const save = async () => {
    const secrets: ReplaceChannelTokenBody = slack
      ? { kind: 'slack', botToken: token, appToken }
      : channel.kind === 'sms'
        ? { kind: 'sms', authToken: token }
        : email
          ? { kind: 'email', password: token }
          : channel.kind === 'discord'
            ? { kind: 'discord', token }
            : { kind: 'telegram', token };
    setBusy(true);
    setError(undefined);
    try {
      await guard(async () => {
        putChannel(client, await channelsApi.replaceToken(channel.id, secrets));
        toast.success('Connected again.');
      });
    } catch (e) {
      setError(errorText(e, 'That key didn’t work.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Callout
      tone="warning"
      title={
        channel.kind === 'email'
          ? 'It needs a new app password'
          : channel.kind === 'sms'
            ? 'It needs the new Auth Token'
            : 'It needs a new key'
      }
    >
      <Stack gap={3}>
        <Text size="sm">
          {channel.health.message} {where[channel.kind]}
        </Text>
        <KeyField
          label={
            slack
              ? 'Bot token'
              : channel.kind === 'sms'
                ? 'Auth Token'
                : email
                  ? 'New app password'
                  : 'New key'
          }
          value={token}
          onValueChange={setToken}
          status={error ? 'error' : status}
          found={<>That works.</>}
          error={error ?? (check && !check.ok ? check.message : undefined)}
        />
        {slack && (
          <KeyField
            label="App-level token"
            value={appToken}
            onValueChange={setAppToken}
            status="idle"
            placeholder="xapp-…"
          />
        )}
        <Button
          variant="solid"
          className={styles.fit}
          loading={busy}
          disabled={status !== 'ok' || (slack && !appToken.trim())}
          onClick={() => void save()}
        >
          Reconnect
        </Button>
      </Stack>
      {dialog}
    </Callout>
  );
}

/**
 * A switch only you can turn on, on this Mac (iMessage): which one, and the
 * button that opens it. Conch notices by itself once it's on.
 */
function AccessFix({ channel }: { channel: Channel }) {
  // Asked again every few seconds: which app needs the switch, and whether it's on yet.
  const setup = useImessageSetup();
  if (channel.health.access === 'automation')
    return (
      <Callout
        tone="warning"
        title="Let Conch use Messages"
        action={
          <Button size="sm" variant="solid" onClick={() => void openOnMac('automation')}>
            Open System Settings
          </Button>
        }
      >
        {channel.health.message} Then send a test message to check.
      </Callout>
    );
  return (
    <Callout tone="warning" title="Turn on Full Disk Access">
      <FullDiskAccessSteps app={setup.data?.app ?? 'Terminal'} />
    </Callout>
  );
}

/**
 * A channel that's one half of an app (ADR 0052) offers the other half, once:
 * Gmail can use the email channel's app password in one tap (asked, never
 * done by itself, ADR 0048); Slack's reading and sending is a separate key
 * from the same Slack app, so it opens Slack's own setup.
 */
function OtherHalf({ channel }: { channel: Channel }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const assistant = useAppState().data?.persona.name ?? 'Conch';
  const { data } = useIntegrations();
  const [busy, setBusy] = useState(false);
  if (!channel.app || !data || data.integrations.some((i) => i.catalogId === channel.app))
    return dialog;
  if (channel.app === 'slack')
    return (
      <Callout
        tone="info"
        title={`Let ${assistant} read and send in Slack too?`}
        action={
          <Button size="sm" variant="surface" onClick={() => void navigate(connectPath('slack'))}>
            Set it up
          </Button>
        }
      >
        The same Slack app can let {assistant} catch you up on channels, search, and post for you
        when you say yes. It takes one more key from it, the one that acts as you.
      </Callout>
    );
  if (channel.app !== 'gmail') return dialog;
  const shareWithGmail = async () => {
    setBusy(true);
    try {
      await guard(async () => {
        await googleApi.reuse();
        await client.invalidateQueries({ queryKey: integrationKeys.all });
        toast.success(`${assistant} can search your Gmail now.`);
      });
    } catch (error) {
      toast.error(errorText(error, 'Gmail couldn’t be reached. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {dialog}
      <Callout
        tone="info"
        title={`Let ${assistant} search your Gmail too?`}
        action={
          <Button size="sm" variant="surface" loading={busy} onClick={() => void shareWithGmail()}>
            Use it for Gmail
          </Button>
        }
      >
        Gmail the app can use the same app password: {assistant} finds and reads your email, and
        saves drafts when you say yes. It never sends from there.
      </Callout>
    </>
  );
}
