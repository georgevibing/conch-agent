import type { Channel, ChannelLink } from '@conch/protocol';
import {
  Button,
  Callout,
  DeviceLinkCard,
  GuideSteps,
  Handset,
  LinkedDevicesSketch,
  Stack,
  Text,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { QrCode } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { GetIt } from '../setup/GetIt';
import { channelsApi } from './api';
import { SetupPage, stepState } from './ConnectChannel';
import { APPS, readablePhone, SELF_CHAT } from './describe';
import { HelloStep } from './HelloStep';
import { errorText, linkKey, useChannel, useChannelLink } from './queries';

type Linked = 'whatsapp' | 'signal';

/** What each app calls things, and where they are on the phone. */
const PHONE: Record<
  Linked,
  { steps: ReactNode; action: string; note?: string; caution: ReactNode; intro: string }
> = {
  whatsapp: {
    intro:
      'About a minute. Conch joins your own WhatsApp as a linked device, like WhatsApp Web. You talk to your assistant in Message yourself; nobody else’s chats reach it.',
    steps: (
      <ol>
        <li>
          Open <b>WhatsApp</b> on your phone.
        </li>
        <li>
          Tap <b>Settings</b> (on Android, <b>⋮</b>), then <b>Linked devices</b>.
        </li>
        <li>
          Tap <b>Link a device</b>, and point the phone at this code.
        </li>
      </ol>
    ),
    action: 'Link a device',
    note: 'Your personal messages are end-to-end encrypted on all your devices.',
    caution: (
      <>
        WhatsApp’s terms allow only its own apps. Conch links the way WhatsApp Web does, but through
        an unofficial client, so WhatsApp could restrict a number it thinks is automated. It’s rare
        for a number only you use; if you couldn’t do without this one, link a spare number instead.
      </>
    ),
  },
  signal: {
    intro:
      'About two minutes. Conch joins your own Signal as a linked device, like Signal Desktop. You talk to your assistant in Note to Self; nobody else’s chats reach it.',
    steps: (
      <ol>
        <li>
          Open <b>Signal</b> on your phone.
        </li>
        <li>
          Tap your picture, then <b>Linked devices</b>.
        </li>
        <li>
          Tap <b>Link a new device</b>, and point the phone at this code.
        </li>
      </ol>
    ),
    action: 'Link a new device',
    caution: (
      <>
        Conch talks to Signal through signal-cli, a long-standing open-source client that Signal
        doesn’t make. Your messages stay end-to-end encrypted; this computer becomes one of your
        linked devices.
      </>
    ),
  },
};

const ENDED = new Set<ChannelLink['state']>(['linked', 'expired', 'failed', 'needs-install']);

/**
 * Showing the code that links WhatsApp or Signal, and everything around it:
 * what to tap on the phone, a new code when one ran out, and what to install
 * first when Signal needs signal-cli. With `channelId` it links that channel
 * again (after it was unlinked on the phone).
 */
export function LinkStep({
  kind,
  channelId,
  onLinked,
  auto = true,
  onState,
}: {
  kind: Linked;
  channelId?: string;
  onLinked?: (channelId: string) => void;
  /** Show the code as soon as this appears (the setup page), or wait for a press (relinking). */
  auto?: boolean;
  onState?: (link: ChannelLink | undefined) => void;
}) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [linkId, setLinkId] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { data: link } = useChannelLink(linkId);
  const started = useRef(false);
  const app = APPS[kind].name;

  const start = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await guard(async () => {
        const made = await channelsApi.link(kind, channelId);
        client.setQueryData(linkKey(made.id), made);
        setLinkId(made.id);
      });
    } catch (e) {
      setError(errorText(e, 'Couldn’t show a code.'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    void start();
    // Once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A code left showing when the page closes stops, so it can't be scanned later.
  const current = useRef<ChannelLink | undefined>(undefined);
  useEffect(() => {
    current.current = link;
  }, [link]);
  useEffect(
    () => () => {
      const open = current.current;
      if (open && !ENDED.has(open.state)) void channelsApi.stopLink(open.id).catch(() => undefined);
    },
    [],
  );

  const notified = useRef<string>(undefined);
  useEffect(() => {
    onState?.(link);
    if (link?.state === 'linked' && link.channelId && notified.current !== link.id) {
      notified.current = link.id;
      onLinked?.(link.channelId);
    }
  }, [link, onLinked, onState]);

  if (!link)
    return (
      <Stack gap={3}>
        {error ? (
          <Callout tone="warning" title="No code yet">
            {error}
          </Callout>
        ) : (
          !auto && (
            <Text tone="muted">
              Conch shows a code; you scan it from {app} on your phone, the way you linked it the
              first time.
            </Text>
          )
        )}
        <Button
          variant="solid"
          leadingIcon={<QrCode />}
          loading={busy || (auto && !error)}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => void start()}
        >
          Show the code
        </Button>
        {dialog}
      </Stack>
    );

  if (link.state === 'needs-install' && link.need)
    return (
      <Stack gap={3}>
        <GetIt needId={link.need} lead={link.message} />
        <Text size="sm" tone="subtle">
          Once it’s installed, show the code again.
        </Text>
        <Button
          variant="ghost"
          leadingIcon={<QrCode />}
          loading={busy}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => void start()}
        >
          Show the code
        </Button>
        {dialog}
      </Stack>
    );

  const state = link.state === 'needs-install' ? 'failed' : link.state;
  return (
    <>
      <DeviceLinkCard
        state={state}
        qr={link.qr}
        qrLabel={`Scan with ${app} on your phone`}
        title={
          state === 'starting'
            ? `Getting a code from ${app}`
            : state === 'showing'
              ? `Scan this with ${app}`
              : state === 'finishing'
                ? 'Scanned'
                : state === 'linked'
                  ? 'Linked'
                  : state === 'expired'
                    ? 'The code ran out'
                    : 'That didn’t link'
        }
        message={
          state === 'expired'
            ? 'Nobody scanned it in time. Codes last a few minutes, so an old one can’t be used.'
            : link.message
        }
        onRetry={() => void start()}
        retrying={busy}
        retryLabel={state === 'expired' ? 'Show a new code' : 'Try again'}
      >
        {state === 'showing' || state === 'starting' ? (
          PHONE[kind].steps
        ) : state === 'finishing' ? (
          <p>Keep {app} open on your phone for a moment.</p>
        ) : state === 'linked' && link.phone ? (
          <p>Linked to {readablePhone(link.phone)}.</p>
        ) : null}
      </DeviceLinkCard>
      {dialog}
    </>
  );
}

/** `/channels/new/whatsapp` and `/channels/new/signal`: link, then the hello that's already there. */
export function LinkedSetup({ kind }: { kind: Linked }) {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [channelId, setChannelId] = useState<string>();
  const [link, setLink] = useState<ChannelLink>();
  const { channel } = useChannel(channelId);
  const app = APPS[kind];
  const at = channel ? 1 : 0;

  return (
    <SetupPage
      kind={kind}
      intro={PHONE[kind].intro}
      preview={
        <LinkedPreview
          kind={kind}
          channel={channel}
          assistant={assistant}
          showing={link?.state === 'showing'}
        />
      }
    >
      <GuideSteps label={`Connect ${app.name}`}>
        <GuideSteps.Step
          number={1}
          title={`Link ${app.name}`}
          state={stepState(0, at)}
          summary={channel?.bot.phone ? `Linked ${readablePhone(channel.bot.phone)}` : 'Linked'}
        >
          <LinkStep kind={kind} onLinked={setChannelId} onState={setLink} />
          <Callout tone="info" title="Good to know">
            {PHONE[kind].caution}
          </Callout>
        </GuideSteps.Step>
        <GuideSteps.Step number={2} title="Say hello" state={stepState(1, at)}>
          {channel && (
            <HelloStep
              channel={channel}
              onFinish={() => void navigate(`/channels/${channel.id}`)}
            />
          )}
        </GuideSteps.Step>
      </GuideSteps>
    </SetupPage>
  );
}

/** Beside the steps: the phone's Linked devices screen, then the chat with yourself. */
function LinkedPreview({
  kind,
  channel,
  assistant,
  showing,
}: {
  kind: Linked;
  channel?: Channel;
  assistant: string;
  showing: boolean;
}) {
  const app = APPS[kind];
  if (!channel)
    return (
      <LinkedDevicesSketch
        label={`Linked devices in ${app.name}, with ${PHONE[kind].action} to press`}
        color={app.color}
        action={PHONE[kind].action}
        note={PHONE[kind].note}
        alive={showing}
      />
    );
  const owner = channel.people[0];
  return (
    <Handset
      label={`${SELF_CHAT[kind]} in ${app.name}, where you talk to ${assistant}`}
      brand={kind}
      color={app.color}
      title={kind === 'whatsapp' ? `${channel.bot.name} (You)` : 'Note to Self'}
      subtitle={kind === 'whatsapp' ? 'Message yourself' : undefined}
      messages={[
        {
          // In the chat with yourself, what Conch writes comes from your own account.
          id: 'w',
          from: 'you',
          text: (
            <p>
              Hi {owner?.name.split(' ')[0] ?? 'there'}! 👋 I’m <b>{assistant}</b>, and I’m
              connected to Conch on your computer. Write to me here, in the chat with yourself.
            </p>
          ),
        },
      ]}
      footer={<Handset.Composer />}
    />
  );
}
