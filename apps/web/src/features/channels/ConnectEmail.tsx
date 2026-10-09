import type { Channel, ChannelSecrets, MailProvider } from '@conch/protocol';
import {
  Button,
  Callout,
  Field,
  GuideSteps,
  Handset,
  Input,
  KeyField,
  NumberField,
  PortalSketch,
  SegmentedControl,
  Stack,
  Text,
  META_SEP,
} from '@conch/nacre';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import styles from './Channels.module.css';
import { OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { conchAddress, guessMail, MAIL_SERVICES, type MailService } from './guides';
import { HelloStep } from './HelloStep';
import { useKeyCheck } from './hooks';

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `/channels/new/email`: your address, an app password, and you're in. */
export function EmailSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const [address, setAddress] = useState('');
  // The address says which service it most likely is: that tab is chosen until you pick another.
  const [picked, setPicked] = useState<MailProvider>();
  const provider: MailProvider = picked ?? guessMail(address) ?? 'gmail';
  const [password, setPassword] = useState('');
  const [server, setServer] = useState({
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 465,
  });
  const service: MailService = MAIL_SERVICES.find((s) => s.id === provider) ?? MAIL_SERVICES[0];
  const valid = ADDRESS.test(address.trim());
  const serverReady = provider !== 'other' || (server.imapHost && server.smtpHost);

  const secrets: ChannelSecrets | undefined =
    valid && password.trim() && serverReady && !('signInOnly' in service)
      ? {
          kind: 'email',
          provider,
          address: address.trim(),
          password,
          ...(provider === 'other' && { server }),
        }
      : undefined;
  const { status, check } = useKeyCheck(secrets, password);
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  useEffect(() => {
    if (status === 'ok' && secrets && !channel) void connect(secrets);
  });

  const [next, setNext] = useState(false);
  const ready = valid && !('signInOnly' in service) && Boolean(serverReady);
  const at = channel ? 2 : next && ready ? 1 : 0;
  const writeTo = channel?.bot.address ?? (valid ? conchAddress(address, service.plus) : undefined);

  return (
    <SetupPage
      kind="email"
      intro={`About three minutes. ${assistant} reads only the mail you send to its own address, and answers in the same thread, from your account.`}
      preview={
        <EmailPreview
          at={at}
          service={service}
          channel={channel}
          assistant={assistant}
          writeTo={writeTo}
        />
      }
    >
      <GuideSteps label="Connect email">
        <GuideSteps.Step
          number={1}
          title="Your email address"
          state={stepState(0, at)}
          summary={valid ? `${address.trim()}${META_SEP}${service.name}` : undefined}
          onEdit={channel ? undefined : () => setNext(false)}
        >
          <Field>
            <Field.Label>Email address</Field.Label>
            <Input
              type="email"
              value={address}
              onChange={(e) => {
                reset();
                setAddress(e.currentTarget.value);
              }}
              placeholder="you@gmail.com"
              autoComplete="email"
            />
          </Field>
          <SegmentedControl
            aria-label="Your mail service"
            value={provider}
            onValueChange={(value) => {
              if (value) setPicked(value as MailProvider);
            }}
          >
            {MAIL_SERVICES.map((s) => (
              <SegmentedControl.Item key={s.id} value={s.id}>
                {s.name}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
          {'signInOnly' in service && (
            <Callout tone="warning" title="Outlook doesn’t take app passwords any more">
              {service.note}
            </Callout>
          )}
          {provider === 'other' && (
            <div className={styles.answers}>
              <Field>
                <Field.Label size="sm">Incoming (IMAP) server</Field.Label>
                <Input
                  size="sm"
                  value={server.imapHost}
                  onChange={(e) => setServer({ ...server, imapHost: e.currentTarget.value.trim() })}
                  placeholder="imap.example.com"
                />
              </Field>
              <Field>
                <Field.Label size="sm">Port</Field.Label>
                <NumberField
                  size="sm"
                  value={server.imapPort}
                  min={1}
                  max={65535}
                  onValueChange={(value) => setServer({ ...server, imapPort: value ?? 993 })}
                />
              </Field>
              <Field>
                <Field.Label size="sm">Outgoing (SMTP) server</Field.Label>
                <Input
                  size="sm"
                  value={server.smtpHost}
                  onChange={(e) => setServer({ ...server, smtpHost: e.currentTarget.value.trim() })}
                  placeholder="smtp.example.com"
                />
              </Field>
              <Field>
                <Field.Label size="sm">Port</Field.Label>
                <NumberField
                  size="sm"
                  value={server.smtpPort}
                  min={1}
                  max={65535}
                  onValueChange={(value) => setServer({ ...server, smtpPort: value ?? 465 })}
                />
              </Field>
              <Text size="sm" tone="subtle">
                Both always use a secure connection (TLS).
              </Text>
            </div>
          )}
          <Button
            variant="solid"
            className={styles.fit}
            disabled={!ready}
            onClick={() => setNext(true)}
          >
            Next
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Make an app password"
          state={stepState(1, at)}
          summary="Checked with your mail service"
        >
          <Stack gap={3}>
            <Text tone="muted">
              An app password lets Conch into your mail without your real password, and you can take
              it back any time. {'steps' in service ? service.steps : ''}
            </Text>
            {'passwords' in service && (
              <OpenButton href={service.passwords}>Make one in {service.name}</OpenButton>
            )}
            {'note' in service && !('signInOnly' in service) && (
              <Text size="sm" tone="subtle">
                {service.note}
              </Text>
            )}
            <KeyField
              label="App password"
              value={password}
              onValueChange={(v) => {
                reset();
                setPassword(v);
              }}
              status={error ? 'error' : status}
              placeholder="abcd efgh ijkl mnop"
              checkingLabel={`Signing in to ${service.name}…`}
              description="Conch keeps it locked on this computer and never shows it again."
              found={<>That works. {busy ? 'Connecting…' : ''}</>}
              error={error ?? (check && !check.ok ? check.message : undefined)}
              focusOnShow
            />
          </Stack>
        </GuideSteps.Step>
        <GuideSteps.Step number={3} title="Write to your assistant" state={stepState(2, at)}>
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

function EmailPreview({
  at,
  service,
  channel,
  assistant,
  writeTo,
}: {
  at: number;
  service: MailService;
  channel?: Channel;
  assistant: string;
  writeTo?: string;
}) {
  const color = APPS.email.color;
  if (at === 1 && 'passwords' in service)
    return (
      <PortalSketch
        label={`${service.name}’s app passwords page`}
        address={new URL(service.passwords).host}
        title={service.id === 'icloud' ? 'App-Specific Passwords' : 'App passwords'}
        color={color}
      >
        <PortalSketch.Field label="Name">Conch</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>
            {service.id === 'fastmail'
              ? 'Generate password'
              : service.id === 'icloud'
                ? 'Generate'
                : 'Create'}
          </PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Field label="Your app password">abcd efgh ijkl mnop</PortalSketch.Field>
        <PortalSketch.Bar width={60} />
      </PortalSketch>
    );
  const owner = channel?.people[0];
  return (
    <Handset
      label="Mail on your phone"
      brand="email"
      color={color}
      title={writeTo ?? 'you+conch@gmail.com'}
      subtitle={service.plus ? 'Email' : `Email${META_SEP}subject starts with “Conch”`}
      alive={Boolean(channel)}
      messages={[
        {
          id: 'q',
          from: 'you',
          text: service.plus
            ? 'Can you find a table for four on Friday?'
            : 'Conch: a table for four on Friday?',
        },
        {
          id: 'a',
          from: 'them',
          text: owner
            ? `Hi ${owner.name.split(' ')[0]}! I’m ${assistant}. Two places have room at 8. Want me to book one?`
            : `${assistant} answers here, in the same thread.`,
        },
      ]}
      footer={<Handset.Composer placeholder="Reply" />}
    />
  );
}
