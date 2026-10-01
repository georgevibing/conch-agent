import type { Channel, ChannelSecrets } from '@conch/protocol';
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
import { APPS, channelState, handleOf } from './describe';
import { HelloStep } from './HelloStep';
import { useKeyCheck } from './hooks';
import { channelKeys, errorText, putChannel, useChannel, useChannelAction } from './queries';
import { AlwaysOnHint } from '../background/AlwaysOnHint';

/** `/channels/:id`: one channel — who can talk to it, how it's doing, and its settings. */
export function ChannelDetailView({ channelId }: { channelId: string }) {
  const { channel, isPending } = useChannel(channelId);
  const navigate = useNavigate();
  if (isPending)
    return (
      <div className={styles.page}>
        <Skeleton shape="block" height="6rem" />
      </div>
    );
  if (!channel)
    return (
      <div className={styles.page}>
        <EmptyState
          title="That channel isn’t connected"
          description="It may have been disconnected on another device."
          actions={<Button onClick={() => void navigate('/channels')}>See your channels</Button>}
        />
      </div>
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
      void navigate('/channels');
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t disconnect it.'));
    }
  };

  return (
    <div className={styles.page}>
      <Button
        asChild
        variant="ghost"
        tone="neutral"
        size="sm"
        leadingIcon={<ArrowLeft />}
        className={styles.back}
      >
        <Link to="/channels">Channels</Link>
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
            Anyone else who writes to {handle ? `@${handle}` : channel.bot.name} gets one polite
            reply and shows up here for you to let in or block.
            {channel.blocked > 0 &&
              ` You’ve blocked ${channel.blocked === 1 ? 'one person' : `${channel.blocked} people`}.`}
          </Text>
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
              {assistant} stops answering {handle ? `@${handle}` : channel.bot.name}, and Conch
              forgets its key. Your conversations stay here. The bot itself stays in {app.name}{' '}
              until you delete it there.
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
    </div>
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
  if (state === 'needs-token') return <ReplaceKey channel={channel} />;
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
  const body = slack
    ? token.trim()
      ? ({ kind: 'slack', botToken: token } as const)
      : undefined
    : token.trim()
      ? ({ kind: channel.kind, token } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, token);
  const where = {
    telegram: 'Open BotFather, send /token, pick your bot, and copy the new key it sends.',
    discord: 'In the Developer Portal, open your app → Bot → Reset Token, then Copy.',
    slack:
      'In your Slack app’s settings: Install App for the bot token, Basic Information → App-Level Tokens for the other.',
  }[channel.kind];

  const save = async () => {
    const secrets: ChannelSecrets = slack
      ? { kind: 'slack', botToken: token, appToken }
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
    <Callout tone="warning" title="It needs a new key">
      <Stack gap={3}>
        <Text size="sm">
          {channel.health.message} {where}
        </Text>
        <KeyField
          label={slack ? 'Bot token' : 'New key'}
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
