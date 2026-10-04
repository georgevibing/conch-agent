import { type Channel, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } from '@conch/protocol';
import { Button, GuideSteps, Handset, KeyField, PortalSketch, Text } from '@conch/nacre';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import styles from './Channels.module.css';
import { OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS, readablePhone } from './describe';
import { DoorStep } from './DoorStep';
import { TWILIO_CONSOLE_URL, TWILIO_NUMBERS_URL } from './guides';
import { HelloStep } from './HelloStep';
import { useKeyCheck, usePasteAnywhere } from './hooks';
import { useDoor } from './queries';

/**
 * SMS (ADR 0076): a phone number of the assistant's own, rented from Twilio.
 * You buy the number and paste two keys; Conch finds the number, opens the
 * address Twilio delivers to, and points the number at it by itself.
 */
export function SmsSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [bought, setBought] = useState(false);
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const body =
    accountSid.trim() && authToken.trim()
      ? ({ kind: 'sms', provider: 'twilio', accountSid, authToken } as const)
      : undefined;
  const { status, check } = useKeyCheck(body, `${accountSid}${authToken}`);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  const { data: door } = useDoor();

  useEffect(() => {
    if (status === 'ok' && body && !channel) void connect(body);
  });
  // The Account SID pasted anywhere on the page lands in its box (a token alone is too plain to spot).
  usePasteAnywhere(
    TWILIO_ACCOUNT_SID,
    (found) => {
      setBought(true);
      setAccountSid(found);
    },
    !channel,
  );

  const at = !channel ? (bought || accountSid ? 1 : 0) : door?.state !== 'ready' ? 2 : 3;
  const number = channel?.bot.phone ?? (check?.ok ? check.bot.phone : undefined);

  return (
    <SetupPage
      kind="sms"
      intro="About five minutes. Your assistant gets a phone number of its own from Twilio, and you text it from any phone. Only you can talk to it."
      preview={<SmsPreview at={at} channel={channel} assistant={assistant} />}
    >
      <GuideSteps label="Connect SMS">
        <GuideSteps.Step
          number={1}
          title="Get a number"
          state={stepState(0, at)}
          summary="Bought in Twilio"
          onEdit={channel ? undefined : () => setBought(false)}
        >
          <Text tone="muted">
            Sign up at Twilio (a trial comes with some credit). In the Console, open{' '}
            <b>Phone Numbers → Buy a number</b>, tick <b>SMS</b>, and buy one. A number costs about
            a dollar a month, and each text about a cent.
          </Text>
          <OpenButton href={TWILIO_NUMBERS_URL}>Open Twilio</OpenButton>
          <Text size="sm" tone="subtle">
            In the US, carriers only pass on texts from registered numbers: Twilio asks you to
            register yours (A2P 10DLC), or to verify a toll-free number.
          </Text>
          <Button variant="ghost" className={styles.fit} onClick={() => setBought(true)}>
            I have a number
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Paste your keys"
          state={stepState(1, at)}
          summary={number ? `Texts from ${readablePhone(number)}` : 'Connected'}
        >
          <Text tone="muted">
            On the Twilio Console’s first page, under <b>Account Info</b>, copy the{' '}
            <b>Account SID</b> and the <b>Auth Token</b> (press <b>Show</b> first).
          </Text>
          <OpenButton href={TWILIO_CONSOLE_URL}>Open the Twilio Console</OpenButton>
          <KeyField
            label="Account SID"
            value={accountSid}
            onValueChange={(v) => {
              reset();
              setAccountSid(TWILIO_ACCOUNT_SID.exec(v)?.[1] ?? v);
            }}
            status={accountSid ? (TWILIO_ACCOUNT_SID.test(accountSid) ? 'ok' : 'error') : 'idle'}
            placeholder="AC…"
            found={<>That’s an Account SID.</>}
            error="An Account SID starts with AC, then 32 letters and digits."
            focusOnShow
          />
          <KeyField
            label="Auth Token"
            value={authToken}
            onValueChange={(v) => {
              reset();
              setAuthToken(TWILIO_AUTH_TOKEN.exec(v)?.[1] ?? v);
            }}
            status={error ? 'error' : authToken ? status : 'idle'}
            checkingLabel="Checking with Twilio…"
            found={
              <>
                Twilio accepts it
                {number ? `, and your assistant will text from ${readablePhone(number)}` : ''}.{' '}
                {busy ? 'Connecting…' : ''}
              </>
            }
            error={error ?? (check && !check.ok ? check.message : undefined)}
          />
        </GuideSteps.Step>
        <GuideSteps.Step
          number={3}
          title="Give it an address Twilio can reach"
          state={stepState(2, at)}
          summary={door?.url ? `At ${door.url}` : 'On'}
        >
          <Text tone="muted">
            Twilio delivers texts to a web address. Turn one on here, and Conch tells Twilio to send
            your number’s texts there: nothing to paste in Twilio.
          </Text>
          <DoorStep />
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

function SmsPreview({
  at,
  channel,
  assistant,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
}) {
  const color = APPS.sms.color;
  const nav = ['Account Dashboard', 'Phone Numbers', 'Messaging'];
  if (at === 0)
    return (
      <PortalSketch
        label="The Twilio Console, buying a number"
        address="console.twilio.com"
        nav={nav}
        active="Phone Numbers"
        title="Buy a number"
        color={color}
      >
        <PortalSketch.Field label="Capabilities">SMS ✓</PortalSketch.Field>
        <PortalSketch.Bar width={70} />
        <PortalSketch.Row>
          <PortalSketch.Button>Buy</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  if (at === 1)
    return (
      <PortalSketch
        label="The Twilio Console’s first page, with Account Info"
        address="console.twilio.com"
        nav={nav}
        active="Account Dashboard"
        title="Account Info"
        color={color}
      >
        <PortalSketch.Field label="Account SID">AC…</PortalSketch.Field>
        <PortalSketch.Field label="Auth Token">••••••••••••</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button quiet>Show</PortalSketch.Button>
          <PortalSketch.Button>Copy</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  const owner = channel?.people[0];
  const number = channel?.bot.phone ? readablePhone(channel.bot.phone) : 'Your assistant';
  return (
    <Handset
      label="Messages on your phone, texting your assistant’s number"
      brand="sms"
      color={color}
      title={number}
      subtitle="Text message"
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
      footer={<Handset.Composer placeholder="Text message" />}
    />
  );
}
