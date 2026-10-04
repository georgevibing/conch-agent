import type { Channel } from '@conch/protocol';
import { Button, GuideSteps, Handset, KeyField, PortalSketch, Text } from '@conch/nacre';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import styles from './Channels.module.css';
import { Answer, OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { DoorStep } from './DoorStep';
import { GOOGLE_CHAT_API_URL, GOOGLE_CHAT_CONFIG_URL, GOOGLE_SERVICE_ACCOUNTS_URL } from './guides';
import { HelloStep } from './HelloStep';
import { CopyRow } from './HookSection';
import { useKeyCheck, usePasteAnywhere } from './hooks';
import { useDoor } from './queries';

/** A service account's key file, pasted anywhere on the page. */
const KEY_FILE = /(\{[\s\S]*"type"\s*:\s*"service_account"[\s\S]*\})/;

/**
 * Google Chat (ADR 0084): a Chat app in your Google Workspace account. You
 * make it in Google Cloud with a service account's key; Chat delivers to the
 * public door, at the address you paste in the app's configuration.
 */
export function GoogleChatSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [started, setStarted] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [keyFile, setKeyFile] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const body = keyFile.trim()
    ? ({ kind: 'googlechat', serviceAccount: keyFile } as const)
    : undefined;
  const { status, check } = useKeyCheck(body, keyFile);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  const { data: door } = useDoor();

  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });
  usePasteAnywhere(
    KEY_FILE,
    (found) => {
      setStarted(true);
      setKeyFile(found);
    },
    !channel,
  );

  const heard = Boolean(channel?.hook?.heardAt);
  const at = !channel
    ? started || keyFile
      ? 1
      : 0
    : door?.state !== 'ready'
      ? 2
      : !configured && !heard
        ? 3
        : 4;

  const read = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setKeyFile((await file.text()).trim());
  };

  return (
    <SetupPage
      kind="googlechat"
      intro="About twelve minutes, with a Google Workspace account (a school or work one; a personal Gmail can’t make Chat apps). You make a Chat app in Google Cloud and give Conch its key. Only you can talk to it."
      preview={<GoogleChatPreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect Google Chat">
        <GuideSteps.Step
          number={1}
          title="Turn on the Google Chat API"
          state={stepState(0, at)}
          summary="On"
          onEdit={channel ? undefined : () => setStarted(false)}
        >
          <Text tone="muted">
            In Google Cloud, make a project (or choose one), and press <b>Enable</b> on the Google
            Chat API.
          </Text>
          <OpenButton href={GOOGLE_CHAT_API_URL}>Open the Google Chat API</OpenButton>
          <Button variant="ghost" className={styles.fit} onClick={() => setStarted(true)}>
            It’s on
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Give Conch a service account’s key"
          state={stepState(1, at)}
          summary="Connected"
        >
          <Text tone="muted">
            In <b>IAM & Admin → Service accounts</b>, press <b>Create service account</b>, name it{' '}
            <b>{assistant}</b> and press <b>Done</b> (it needs no roles). Open it, then{' '}
            <b>Keys → Add key → Create new key → JSON</b>. Choose the file it downloads here, or
            paste what’s in it.
          </Text>
          <OpenButton href={GOOGLE_SERVICE_ACCOUNTS_URL}>Open Service accounts</OpenButton>
          <input
            ref={picker}
            type="file"
            accept=".json,application/json"
            className="nc-visually-hidden"
            aria-label="The key file"
            tabIndex={-1}
            onChange={(event) => void read(event.target.files?.[0])}
          />
          <Button
            variant="surface"
            leadingIcon={<FileUp />}
            className={styles.fit}
            onClick={() => picker.current?.click()}
          >
            Choose the key file
          </Button>
          <KeyField
            label="Or paste the key"
            value={keyFile}
            onValueChange={(v) => {
              reset();
              setKeyFile(v);
            }}
            status={error ? 'error' : keyFile ? status : 'idle'}
            checkingLabel="Checking with Google…"
            found={<>Google accepts it. {busy ? 'Connecting…' : ''}</>}
            error={error ?? (check && !check.ok ? check.message : undefined)}
          />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={3}
          title="Give it an address Google Chat can reach"
          state={stepState(2, at)}
          summary={door?.url ? `At ${door.url}` : 'On'}
        >
          <Text tone="muted">
            Google Chat delivers messages to a web address. Turn one on here.
          </Text>
          <DoorStep />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={4}
          title="Make the Chat app"
          state={stepState(3, at)}
          summary="Saved"
        >
          <Text tone="muted">
            On the Google Chat API’s <b>Configuration</b> page, fill in these, tick{' '}
            <b>Receive 1:1 messages</b> and <b>Join spaces and group conversations</b>, choose{' '}
            <b>HTTP endpoint URL</b> as the connection with <b>HTTP endpoint URL</b> as the
            authentication audience, make it visible to yourself, and press <b>Save</b>. Leave{' '}
            <b>Build this Chat app as a Workspace add-on</b> off.
          </Text>
          <OpenButton href={GOOGLE_CHAT_CONFIG_URL}>Open the Configuration page</OpenButton>
          <Answer label="App name" value={assistant} />
          <Answer label="Description" value="Your assistant on Conch" />
          {channel?.hook?.url && <CopyRow label="HTTP endpoint URL" value={channel.hook.url} />}
          <Button variant="ghost" className={styles.fit} onClick={() => setConfigured(true)}>
            I saved it
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

function GoogleChatPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.googlechat.color;
  if (at <= 3)
    return (
      <PortalSketch
        label="Google Cloud, configuring the Google Chat API"
        address="console.cloud.google.com/apis/api/chat.googleapis.com"
        nav={['Overview', 'Credentials', 'Configuration']}
        active={at === 1 ? 'Credentials' : 'Configuration'}
        title={at === 1 ? 'Service account key' : 'Configuration'}
        color={color}
      >
        {at === 1 ? (
          <>
            <PortalSketch.Field label="Key type">JSON</PortalSketch.Field>
            <PortalSketch.Row>
              <PortalSketch.Button>Create</PortalSketch.Button>
            </PortalSketch.Row>
          </>
        ) : (
          <>
            <PortalSketch.Field label="App name">{assistant}</PortalSketch.Field>
            <PortalSketch.Field label="HTTP endpoint URL">
              {channel?.hook?.url ?? 'https://…/conch/hooks/…'}
            </PortalSketch.Field>
            <PortalSketch.Row>
              <PortalSketch.Button>Save</PortalSketch.Button>
            </PortalSketch.Row>
          </>
        )}
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Your Chat app in Google Chat"
      brand="googlechat"
      color={color}
      title={assistant}
      subtitle="App"
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
      footer={<Handset.Composer placeholder="History is on" />}
    />
  );
}
