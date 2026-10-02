import type { Channel } from '@conch/protocol';
import {
  Button,
  Collapsible,
  Field,
  GuideSteps,
  Handset,
  Input,
  KeyField,
  PasswordInput,
  PortalSketch,
  Stack,
  Text,
} from '@conch/nacre';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import styles from './Channels.module.css';
import { Answer, OpenButton, SetupPage, stepState, useConnect } from './ConnectChannel';
import { APPS } from './describe';
import { matrixNames, randomDigits } from './guides';
import { HelloStep } from './HelloStep';

const ELEMENT_REGISTER = 'https://app.element.io/#/register';

/**
 * Matrix: the assistant gets an account of its own (made in Element in a
 * minute), Conch signs in to it once, and you message it. Encrypted chats
 * work; the password is used to sign in and never kept.
 */
export function MatrixSetup() {
  const navigate = useNavigate();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const owner = state.data?.profile.name || undefined;
  const [digits] = useState(randomDigits);
  const names = matrixNames(assistant, owner, digits);
  const [made, setMade] = useState(false);
  const [homeserver, setHomeserver] = useState('matrix.org');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const { channel, connect, busy, error, reset, dialog } = useConnect();

  const at = channel ? 2 : made ? 1 : 0;
  const ready = Boolean(homeserver.trim() && ((user.trim() && password) || token.trim()));
  const signIn = () =>
    void connect({
      kind: 'matrix',
      homeserver: homeserver.trim(),
      ...(token.trim() ? { accessToken: token.trim() } : { user: user.trim(), password }),
    });

  return (
    <SetupPage
      kind="matrix"
      intro="About three minutes. Your assistant gets a Matrix account of its own, and you message it from yours. Encrypted chats work, and only you can talk to it."
      preview={<MatrixPreview at={at} channel={channel} assistant={assistant} names={names} />}
    >
      <GuideSteps label="Connect Matrix">
        <GuideSteps.Step
          number={1}
          title="Make an account for your assistant"
          state={stepState(0, at)}
          summary="Account made"
          onEdit={channel ? undefined : () => setMade(false)}
        >
          <Text tone="muted">
            Your assistant needs its own account, so that you can message it from yours. Make one in
            Element (it’s free), on the same homeserver as yours if you can. These work:
          </Text>
          <div className={styles.answers}>
            <Answer label="Username" value={names.username} />
            <Answer label="Display name" value={names.name} />
          </div>
          <Text size="sm" tone="subtle">
            Give it a strong password of its own. Conch uses it once, to sign in, and never keeps
            it.
          </Text>
          <OpenButton href={ELEMENT_REGISTER}>Make it in Element</OpenButton>
          <Button variant="ghost" className={styles.fit} onClick={() => setMade(true)}>
            It has an account
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Sign Conch in to it"
          state={stepState(1, at)}
          summary={channel ? `Signed in as ${channel.bot.id}` : 'Signed in'}
        >
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) signIn();
            }}
          >
            <Field>
              <Field.Label>Homeserver</Field.Label>
              <Input
                value={homeserver}
                onChange={(event) => {
                  reset();
                  setHomeserver(event.target.value);
                }}
                placeholder="matrix.org"
                autoComplete="url"
                spellCheck={false}
              />
              <Field.Description>
                Where the account lives. For matrix.org, leave it.
              </Field.Description>
            </Field>
            {!token && (
              <>
                <Field>
                  <Field.Label>Username</Field.Label>
                  <Input
                    value={user}
                    onChange={(event) => {
                      reset();
                      setUser(event.target.value);
                    }}
                    placeholder={names.username}
                    autoComplete="username"
                    spellCheck={false}
                  />
                </Field>
                <Field invalid={Boolean(error)}>
                  <Field.Label>Password</Field.Label>
                  <PasswordInput
                    value={password}
                    onChange={(event) => {
                      reset();
                      setPassword(event.target.value);
                    }}
                    autoComplete="current-password"
                  />
                  {error && <Field.Error>{error}</Field.Error>}
                </Field>
              </>
            )}
            <Collapsible>
              <Collapsible.Trigger asChild>
                <Button variant="ghost" size="sm" className={styles.fit}>
                  Use an access token instead
                </Button>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <Stack gap={2} className={styles.fallback}>
                  <KeyField
                    label="Access token"
                    value={token}
                    onValueChange={(v) => {
                      reset();
                      setToken(v);
                    }}
                    status={error && token ? 'error' : 'idle'}
                    placeholder="syt_…"
                    description="Only one made for Conch (a fresh sign-in). Not Element’s own: sharing it would break Element’s encryption, and Conch says so."
                    {...(error && token && { error })}
                  />
                </Stack>
              </Collapsible.Content>
            </Collapsible>
            <Button
              type="submit"
              variant="solid"
              className={styles.fit}
              loading={busy}
              disabled={!ready}
            >
              Sign in
            </Button>
          </form>
          <Text size="sm" tone="subtle">
            <Lock aria-hidden className={styles.inlineIcon} /> Conch gets encryption keys of its
            own, like a new phone, so encrypted chats work. It only believes your sessions that your
            account has verified.
          </Text>
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

function MatrixPreview({
  at,
  channel,
  assistant,
  names,
}: {
  at: number;
  channel?: Channel;
  assistant: string;
  names: { name: string; username: string };
}) {
  const color = APPS.matrix.color;
  if (at === 0)
    return (
      <PortalSketch
        label="Element making a new account"
        address="app.element.io/#/register"
        title="Create account"
        color={color}
      >
        <PortalSketch.Field label="Homeserver">matrix.org</PortalSketch.Field>
        <PortalSketch.Field label="Username">{names.username}</PortalSketch.Field>
        <PortalSketch.Field label="Password">••••••••••••</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>Register</PortalSketch.Button>
        </PortalSketch.Row>
      </PortalSketch>
    );
  const owner = channel?.people[0];
  const who = channel?.bot.id ?? `@${names.username}:matrix.org`;
  return (
    <Handset
      label="Your assistant in Element"
      brand="matrix"
      color={color}
      title={channel?.bot.name ?? assistant}
      subtitle={who}
      avatar={channel?.bot.avatar}
      alive={Boolean(channel && !owner)}
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
      footer={<Handset.Composer placeholder="Send an encrypted message…" />}
    />
  );
}
