import type { Channel, ImessageSetup as Setup } from '@conch/protocol';
import {
  Button,
  Callout,
  EmptyState,
  Field,
  GuideSteps,
  Handset,
  Input,
  PortalSketch,
  RadioGroup,
  Skeleton,
  Stack,
  Text,
  toast,
} from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { FolderSearch, Settings } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { channelsApi } from './api';
import styles from './Channels.module.css';
import { SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { HelloStep } from './HelloStep';
import { errorText } from './queries';

/** What Messages has, asked again every few seconds (and on coming back) until macOS lets Conch in. */
export function useImessageSetup() {
  return useQuery({
    queryKey: ['channels', 'imessage'],
    queryFn: ({ signal }) => channelsApi.imessage(signal),
    refetchInterval: (query) => (query.state.data?.access === 'ready' ? false : 3_000),
    refetchOnWindowFocus: true,
  });
}

/** Opens System Settings (or Messages) on this Mac, at the place that fixes it. */
export async function openOnMac(place: Parameters<typeof channelsApi.openImessage>[0]) {
  try {
    await channelsApi.openImessage(place);
  } catch (error) {
    toast.error(errorText(error, 'Couldn’t open System Settings. Open it from the Apple menu.'));
  }
}

/**
 * The switch macOS needs, in words: where it is, which app to turn it on
 * for, and the buttons that open it.
 */
export function FullDiskAccessSteps({ app }: { app: string }) {
  const node = app === 'node';
  return (
    <Stack gap={3}>
      <Text tone="muted">
        macOS keeps your messages private, so it asks you first. In System Settings, open{' '}
        <b>Privacy &amp; Security</b> → <b>Full Disk Access</b> and turn on <b>{app}</b>.
        {node && (
          <>
            {' '}
            If it isn’t in the list, press <b>+</b> and choose it (Show it in Finder, then drag it
            into the list).
          </>
        )}
      </Text>
      <div className={styles.openRow}>
        <Button
          variant="solid"
          leadingIcon={<Settings />}
          className={styles.fit}
          onClick={() => void openOnMac('full-disk-access')}
        >
          Open System Settings
        </Button>
        {node && (
          <Button
            variant="ghost"
            leadingIcon={<FolderSearch />}
            onClick={() => void openOnMac('show-app')}
          >
            Show it in Finder
          </Button>
        )}
      </div>
      <Text size="sm" tone="subtle" aria-live="polite">
        This step ticks itself off when it’s on. If macOS asks to quit and reopen {app}, do it, then
        start Conch again: it carries on from here.
      </Text>
    </Stack>
  );
}

/** `/channels/new/imessage`: let Conch read Messages, choose how you'll text, say hello. */
export function ImessageSetup() {
  const navigate = useNavigate();
  const assistant = useAppState().data?.persona.name ?? 'Conch';
  const setup = useImessageSetup();
  const { channel, connect, busy, error, dialog } = useConnect();
  const [mode, setMode] = useState<'self' | 'account'>('self');
  const [picked, setPicked] = useState<string>();
  const [typed, setTyped] = useState('');

  if (setup.isPending)
    return (
      <div className={styles.page}>
        <Skeleton shape="block" height="10rem" />
      </div>
    );
  const info: Setup = setup.data ?? { access: 'not-mac', handles: [] };
  if (info.access === 'not-mac')
    return (
      <div className={styles.page}>
        <EmptyState
          title="iMessage only works on a Mac"
          description="Conch reads and sends iMessages through the Messages app, which only a Mac has. Run Conch on a Mac to use it, or connect Telegram, Discord, Slack or email instead."
          actions={
            <Button onClick={() => void navigate('/apps?show=talk')}>See the other apps</Button>
          }
        />
      </div>
    );

  const ready = info.access === 'ready';
  const handle = picked ?? info.handles[0] ?? typed.trim();
  const at = channel ? 2 : ready ? 1 : 0;

  return (
    <SetupPage
      kind="imessage"
      intro={`About a minute. ${assistant} uses Messages on this Mac, so there’s nothing to make: you text yourself from your iPhone, and the answer comes back in the same chat.`}
      preview={
        <ImessagePreview
          at={at}
          app={info.app ?? 'Terminal'}
          channel={channel}
          assistant={assistant}
        />
      }
    >
      <GuideSteps label="Connect iMessage">
        <GuideSteps.Step
          number={1}
          title="Let Conch read Messages"
          state={stepState(0, at)}
          summary="Conch can read Messages"
        >
          {info.access === 'no-messages' ? (
            <Stack gap={3}>
              <Text tone="muted">
                Messages isn’t set up on this Mac yet. Open it and sign in with your Apple ID, then
                come back.
              </Text>
              <Button
                variant="solid"
                className={styles.fit}
                onClick={() => void openOnMac('messages')}
              >
                Open Messages
              </Button>
            </Stack>
          ) : (
            <FullDiskAccessSteps app={info.app ?? 'Terminal'} />
          )}
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Choose how you’ll text"
          state={stepState(1, at)}
          summary={channel?.bot.address ? `Texting ${channel.bot.address}` : 'Chosen'}
        >
          <RadioGroup
            variant="card"
            aria-label="How you’ll text your assistant"
            value={mode}
            onValueChange={(value) => setMode(value === 'account' ? 'account' : 'self')}
          >
            <RadioGroup.Item
              value="self"
              label="I text myself"
              description="This Mac uses your Apple ID. Only the chat with yourself is read: nobody else can write there, and your other chats are never looked at."
            />
            <RadioGroup.Item
              value="account"
              label="This Mac has its own Apple ID"
              description="People text this Mac’s address. Nobody gets an answer until you let them in."
            />
          </RadioGroup>
          {info.handles.length > 1 ? (
            <RadioGroup
              aria-label={mode === 'self' ? 'Your address' : 'This Mac’s address'}
              value={handle}
              onValueChange={setPicked}
            >
              {info.handles.map((h) => (
                <RadioGroup.Item key={h} value={h} label={h} />
              ))}
            </RadioGroup>
          ) : info.handles.length === 1 ? (
            <Text size="sm" tone="muted">
              {mode === 'self' ? 'You’ll text' : 'People text'} <b>{info.handles[0]}</b>.
            </Text>
          ) : (
            <Field>
              <Field.Label>{mode === 'self' ? 'Your address' : 'This Mac’s address'}</Field.Label>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.currentTarget.value)}
                placeholder="you@icloud.com or +44 7700 900123"
                autoComplete="email"
              />
              <Field.Description>
                Messages hasn’t sent anything from this Mac yet, so Conch can’t see its address.
                It’s in Messages → Settings → iMessage.
              </Field.Description>
            </Field>
          )}
          {error && (
            <Callout tone="danger" title="That didn’t work">
              {error}
            </Callout>
          )}
          <Button
            variant="solid"
            className={styles.fit}
            loading={busy}
            disabled={!handle}
            onClick={() => void connect({ kind: 'imessage', mode, handle })}
          >
            Connect
          </Button>
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

function ImessagePreview({
  at,
  app,
  channel,
  assistant,
}: {
  at: number;
  app: string;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.imessage.color;
  if (at === 0)
    return (
      <PortalSketch
        label="System Settings, on Full Disk Access"
        address="System Settings"
        nav={['General', 'Privacy & Security', 'Notifications', 'Sound']}
        active="Privacy & Security"
        title="Full Disk Access"
        color={color}
      >
        <PortalSketch.Bar width={75} />
        <PortalSketch.Toggle label={app} press />
        <PortalSketch.Bar width={50} />
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Messages on your iPhone"
      brand="imessage"
      color={color}
      title={owner?.name ?? channel?.bot.address ?? 'You'}
      subtitle="iMessage"
      alive={!owner}
      messages={
        owner
          ? [
              {
                id: 'w',
                from: 'them',
                text: `Hi ${owner.name.split(' ')[0]}! 👋 I’m ${assistant}, and I’m connected to Conch on your computer.`,
              },
              { id: 'h', from: 'you', text: 'what’s on today?' },
            ]
          : [{ id: 'h', from: 'you', text: 'hi' }]
      }
      footer={<Handset.Composer placeholder="iMessage" />}
    />
  );
}
