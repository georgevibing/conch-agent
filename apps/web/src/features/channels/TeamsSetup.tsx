import { type Channel, TEAMS_APP_ID } from '@conch/protocol';
import { Button, GuideSteps, Handset, KeyField, PortalSketch, Text } from '@conch/nacre';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { channelsApi } from './api';
import styles from './Channels.module.css';
import { OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { DoorStep } from './DoorStep';
import { TEAMS_BOTS_URL } from './guides';
import { HelloStep } from './HelloStep';
import { CopyRow } from './HookSection';
import { useKeyCheck, usePasteAnywhere } from './hooks';
import { useDoor } from './queries';

/**
 * Microsoft Teams: a bot of your own, made in the Teams Developer Portal;
 * Teams delivers its messages to the public door (ADR 0045), and you add
 * the bot to Teams with an app package Conch makes for it.
 */
export function TeamsSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [made, setMade] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [added, setAdded] = useState(false);
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [tenantId, setTenantId] = useState('');
  const body =
    appId.trim() && secret.trim()
      ? ({
          kind: 'microsoftteams',
          appId,
          appPassword: secret,
          ...(tenantId.trim() && { tenantId }),
        } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, `${appId}${secret}${tenantId}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  const { data: door } = useDoor();
  const needsTenant =
    Boolean(check && !check.ok && check.field === 'tenantId') || Boolean(tenantId);

  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });
  usePasteAnywhere(
    TEAMS_APP_ID,
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
      : !pasted && !heard
        ? 3
        : !added && !heard
          ? 4
          : 5;

  return (
    <SetupPage
      kind="microsoftteams"
      intro="About eight minutes. You make a Teams bot of your own, Conch gives it an address Teams can deliver to, and you add it to Teams. Only you can talk to it."
      preview={<TeamsPreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect Microsoft Teams">
        <GuideSteps.Step
          number={1}
          title="Make the bot"
          state={stepState(0, at)}
          summary="Made in the Developer Portal"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            Open the Teams Developer Portal and sign in with your work or school account. Press{' '}
            <b>New Bot</b>, name it <b>{assistant}</b> and press <b>Add</b>.
          </Text>
          <OpenButton href={TEAMS_BOTS_URL}>Open the Developer Portal</OpenButton>
          <Text size="sm" tone="subtle">
            Your organisation makes its bots in Azure instead? An Azure Bot works the same: its
            Microsoft App ID and a client secret are all Conch needs.
          </Text>
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            I made it
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Copy its ID and a secret"
          state={stepState(1, at)}
          summary="Connected"
        >
          <Text tone="muted">
            On the bot’s page, copy the <b>Bot ID</b> at the top. Then open <b>Client secrets</b>,
            press <b>Add a client secret for your bot</b>, and copy the secret it shows (once).
          </Text>
          <KeyField
            label="Bot ID"
            value={appId}
            onValueChange={(v) => {
              reset();
              setAppId(TEAMS_APP_ID.exec(v)?.[1] ?? v);
            }}
            status={appId ? (TEAMS_APP_ID.test(appId) ? 'ok' : 'error') : 'idle'}
            placeholder="1a2b3c4d-…"
            found={<>That’s a Bot ID.</>}
            error="A Bot ID looks like 1a2b3c4d-5e6f-… (also called the Microsoft App ID)."
            focusOnShow
          />
          <KeyField
            label="Client secret"
            value={secret}
            onValueChange={(v) => {
              reset();
              setSecret(v);
            }}
            status={error ? 'error' : secret ? status : 'idle'}
            checkingLabel="Checking with Microsoft…"
            description="Copy its value, not its ID."
            found={<>Microsoft accepts it. {busy ? 'Connecting…' : ''}</>}
            error={
              error ??
              (check && !check.ok && check.field !== 'tenantId' ? check.message : undefined)
            }
          />
          {needsTenant && (
            <KeyField
              label="Directory (tenant) ID"
              value={tenantId}
              onValueChange={(v) => {
                reset();
                setTenantId(v);
              }}
              status={tenantId ? status : 'error'}
              description="This bot only works in your organisation. Its Directory (tenant) ID is on the bot’s Overview page in Azure."
              found={<>That works.</>}
              error={check && !check.ok && check.field === 'tenantId' ? check.message : undefined}
            />
          )}
        </GuideSteps.Step>
        <GuideSteps.Step
          number={3}
          title="Give it an address Teams can reach"
          state={stepState(2, at)}
          summary={door?.url ? `At ${door.url}` : 'On'}
        >
          <Text tone="muted">
            Teams delivers messages to a web address, so this is the one thing Teams needs that
            Telegram doesn’t.
          </Text>
          <DoorStep />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={4}
          title="Tell Teams where to deliver"
          state={stepState(3, at)}
          summary="Pasted in the Developer Portal"
        >
          <Text tone="muted">
            Back on the bot’s page, open <b>Configure</b>, paste this into <b>Endpoint address</b>{' '}
            and press <b>Save</b>.
          </Text>
          {channel?.hook?.url && <CopyRow label="Endpoint address" value={channel.hook.url} />}
          <Button variant="ghost" className={styles.fit} onClick={() => setPasted(true)}>
            I pasted it
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={5}
          title="Add it to Teams"
          state={stepState(4, at)}
          summary="Added"
        >
          <Text tone="muted">
            Download the app Conch made for your bot. In Teams, open <b>Apps</b> →{' '}
            <b>Manage your apps</b> → <b>Upload an app</b> → <b>Upload a custom app</b>, choose the
            file and press <b>Add</b>.
          </Text>
          {channel && (
            <Button asChild variant="solid" leadingIcon={<Download />} className={styles.fit}>
              <a href={channelsApi.teamsAppUrl(channel.id)} download>
                Download the Teams app
              </a>
            </Button>
          )}
          <Text size="sm" tone="subtle">
            No Upload an app? Your organisation turned custom apps off: ask whoever runs Teams for
            you to allow it, or to upload this file for you.
          </Text>
          <Button variant="ghost" className={styles.fit} onClick={() => setAdded(true)}>
            It’s in Teams
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step number={6} title="Say hello" state={stepState(5, at)}>
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

function TeamsPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.microsoftteams.color;
  const nav = ['Basic information', 'Configure', 'Client secrets'];
  if (at <= 1)
    return (
      <PortalSketch
        label="The Teams Developer Portal, on Bot management"
        address="dev.teams.microsoft.com/bots"
        nav={at === 0 ? ['Apps', 'Tools', 'Bot management'] : nav}
        active={at === 0 ? 'Bot management' : 'Client secrets'}
        title={at === 0 ? 'Bot management' : assistant}
        color={color}
      >
        {at === 0 ? (
          <>
            <PortalSketch.Row>
              <PortalSketch.Button>+ New Bot</PortalSketch.Button>
            </PortalSketch.Row>
            <PortalSketch.Field label="Bot name">{assistant}</PortalSketch.Field>
            <PortalSketch.Row>
              <PortalSketch.Button quiet>Cancel</PortalSketch.Button>
              <PortalSketch.Button>Add</PortalSketch.Button>
            </PortalSketch.Row>
          </>
        ) : (
          <>
            <PortalSketch.Field label="Bot ID">1a2b3c4d-5e6f-…</PortalSketch.Field>
            <PortalSketch.Row>
              <PortalSketch.Button>Add a client secret for your bot</PortalSketch.Button>
            </PortalSketch.Row>
            <PortalSketch.Bar width={70} />
          </>
        )}
      </PortalSketch>
    );
  if (at === 2 || at === 3)
    return (
      <PortalSketch
        label="Your bot’s Configure page"
        address="dev.teams.microsoft.com/bots"
        nav={nav}
        active="Configure"
        title="Configure"
        color={color}
      >
        <PortalSketch.Field label="Endpoint address">
          {channel?.hook?.url ?? 'https://…/conch/hooks/…'}
        </PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>Save</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Bar width={60} />
      </PortalSketch>
    );
  if (at === 4)
    return (
      <PortalSketch
        label="Teams, uploading an app"
        address="teams.microsoft.com"
        nav={['Activity', 'Chat', 'Apps']}
        active="Apps"
        title="Manage your apps"
        color={color}
      >
        <PortalSketch.Row>
          <PortalSketch.Button>Upload an app</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Bar width={65} />
        <PortalSketch.Bar width={40} />
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Your bot in Teams"
      brand="microsoftteams"
      color={color}
      title={channel?.bot.name ?? assistant}
      subtitle="Bot"
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
      footer={<Handset.Composer placeholder="Type a message" />}
    />
  );
}
