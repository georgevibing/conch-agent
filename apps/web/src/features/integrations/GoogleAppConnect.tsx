import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from '../channels/api';
import { OpenButton, stepState } from '../channels/ConnectChannel';
import { whoOf } from '../channels/describe';
import { putChannel, useChannels } from '../channels/queries';
import {
  GMAIL_APP_PASSWORD,
  type CatalogEntry,
  type Channel,
  type GoogleAppId,
  type GoogleCapability,
  type Integration,
} from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  Field,
  GuideSteps,
  Heading,
  Input,
  IntegrationHandshake,
  KeyField,
  SegmentedControl,
  Stack,
  Text,
  type HandshakePhase,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CornerDownLeft, MessageCircle, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import { WhenStarters } from '../routines/WhenStarters';
import { TryIt } from './ConnectDialog';
import { GoogleConnect } from './GoogleConnect';
import { googleApi } from './googleApi';
import styles from './Integrations.module.css';
import { integrationKeys, useAssistantName } from './queries';

/** Where Google makes app passwords. It needs 2-Step Verification on first. */
export const APP_PASSWORDS_URL = 'https://myaccount.google.com/apppasswords';
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What each app asks Google for when it signs in the advanced way. */
const JOBS: Record<GoogleAppId, { id: GoogleCapability; label: string }[]> = {
  gmail: [
    { id: 'mail-read', label: 'Read and search' },
    { id: 'mail-draft', label: 'Read and save drafts' },
  ],
  'google-calendar': [{ id: 'calendar-read', label: 'Read your calendar' }],
  'google-drive': [{ id: 'drive-read', label: 'Find files' }],
};

/**
 * Connecting Gmail, Google Calendar or Google Drive (ADR 0048), from the tile
 * that was pressed. One Google account serves all three, and each asks only
 * for what it needs. Gmail starts with an app password — a link, a paste, and
 * Conch checks it by signing in. Your own Google Cloud app is the advanced
 * way, and the only way for Calendar and Drive.
 */
export function GoogleAppConnect({
  entry,
  onClose,
  inChat,
  onAskAgain,
}: {
  entry: CatalogEntry;
  onClose: () => void;
  inChat?: boolean;
  onAskAgain?: () => void;
}) {
  const app = entry.id as GoogleAppId;
  const assistant = useAssistantName();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [path, setPath] = useState<'password' | 'google'>(app === 'gmail' ? 'password' : 'google');
  const [job, setJob] = useState<GoogleCapability>(JOBS[app][0]?.id ?? 'mail-read');
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);

  const done = () => {
    setConnected(true);
    void client.invalidateQueries({ queryKey: integrationKeys.all });
    void client.invalidateQueries({ queryKey: ['google'] });
  };

  const phase: HandshakePhase = connected ? 'connected' : checking ? 'waiting' : 'idle';
  const tryIt = (prompt: string) => {
    onClose();
    void navigate('/', { state: { draft: prompt } });
  };

  return (
    <>
      <Dialog.Header className={styles.connectHeader}>
        <IntegrationHandshake
          name={entry.name}
          brand={entry.id}
          color={entry.color}
          phase={phase}
        />
        <Dialog.Title className={styles.connectTitle}>
          {connected ? `${entry.name} is connected` : `Connect ${entry.name}`}
        </Dialog.Title>
        <Text tone="muted" align="center" className={styles.connectLead}>
          {connected
            ? `${assistant} can use ${entry.name} in every chat now, with every model.${app === 'gmail' ? ' It asks before it saves a draft, and never sends.' : ''}`
            : entry.description}
        </Text>
      </Dialog.Header>
      {!(inChat && connected) && (
        <Dialog.Body>
          {connected ? (
            <Stack gap={5}>
              {app === 'gmail' && <TalkByEmail />}
              {/* Routines that start from it, offered once (ADR 0056). Not in a chat: you're mid-way through something. */}
              <WhenStarters app={app} />
              <TryIt entry={entry} onPick={tryIt} />
            </Stack>
          ) : path === 'password' ? (
            <Stack gap={5}>
              <GmailPassword onConnected={done} onChecking={setChecking} />
              <Button variant="ghost" className={styles.fit} onClick={() => setPath('google')}>
                Use your own Google Cloud app instead (advanced)
              </Button>
            </Stack>
          ) : (
            <Stack gap={4}>
              {app === 'gmail' ? (
                <Text size="sm" tone="muted">
                  For people who already have a Google Cloud project, or a work account that doesn’t
                  allow app passwords. Google Calendar and Google Drive can use the same account.
                </Text>
              ) : (
                <Callout tone="info" title="This needs a Google Cloud app of your own">
                  Google only lets {entry.name} in through its own sign-in, so it takes a free
                  Google Cloud project, once. The steps below walk you through it, and Gmail and{' '}
                  {app === 'google-calendar' ? 'Drive' : 'Calendar'} can use the same account
                  afterwards.
                </Callout>
              )}
              {JOBS[app].length > 1 && (
                <SegmentedControl
                  aria-label={`What ${entry.name} should do`}
                  value={job}
                  onValueChange={(v) => v && setJob(v as GoogleCapability)}
                >
                  {JOBS[app].map((j) => (
                    <SegmentedControl.Item key={j.id} value={j.id}>
                      {j.label}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl>
              )}
              <GoogleConnect
                intro={false}
                capabilities={[job]}
                onReady={() => {
                  // An account already connected for another app is used for this one too.
                  void googleApi
                    .useApp(app)
                    .catch(() => undefined)
                    .then(done);
                }}
              />
              {app === 'gmail' && (
                <Button variant="ghost" className={styles.fit} onClick={() => setPath('password')}>
                  Back to the app password (simpler)
                </Button>
              )}
            </Stack>
          )}
        </Dialog.Body>
      )}
      {connected && (
        <Dialog.Footer className={styles.connectFooter}>
          {inChat ? (
            <>
              <Button variant={onAskAgain ? 'ghost' : 'solid'} onClick={onClose}>
                Done
              </Button>
              {onAskAgain && (
                <Button
                  leadingIcon={<CornerDownLeft />}
                  onClick={() => {
                    onClose();
                    onAskAgain();
                  }}
                >
                  Ask again
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  onClose();
                  void navigate(`/apps/${app}`);
                }}
              >
                Choose what it can do
              </Button>
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </Dialog.Footer>
      )}
    </>
  );
}

/**
 * Once Gmail is connected with an app password, talking to the assistant by
 * email can use the same one (ADR 0052): offered in one tap, never done by
 * itself, and only the address is ever shown.
 */
function TalkByEmail() {
  const assistant = useAssistantName();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const { data: channels } = useChannels();
  const offer = useQuery({
    queryKey: ['channels', 'gmail-offer'],
    queryFn: channelsApi.gmailOffer,
  });
  const [made, setMade] = useState<Channel>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const address = offer.data?.address;
  if (!made && (!address || channels?.channels.some((c) => c.kind === 'email'))) return dialog;
  const turnOn = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await guard(async () => {
        const channel = await channelsApi.fromGmail();
        putChannel(client, channel);
        setMade(channel);
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {dialog}
      {made ? (
        <Callout
          tone="success"
          icon={<MessageCircle />}
          title="You can talk to it by email now"
          live="polite"
        >
          Write to {whoOf(made)} from any mail app, and {assistant} answers there.
        </Callout>
      ) : (
        <Callout
          tone="info"
          icon={<MessageCircle />}
          title={`Talk to ${assistant} by email too?`}
          action={
            <Button size="sm" loading={busy} onClick={() => void turnOn()}>
              Turn it on
            </Button>
          }
        >
          It uses the app password Gmail already has: write to {address?.replace('@', '+conch@')}{' '}
          from any mail app, and the answer comes back. Only you can reach it.
          {error && <Text tone="danger">{error}</Text>}
        </Callout>
      )}
    </>
  );
}

/**
 * Gmail with an app password, in two steps: make one at Google, paste it.
 * It's checked by signing in as soon as it lands; nothing is kept until it
 * works. When the email channel already signs in to Gmail, Conch offers that
 * sign-in in one tap, and only uses it if the person says yes.
 */
export function GmailPassword({
  onConnected,
  onChecking,
  accountId,
  address: knownAddress,
}: {
  onConnected: () => void;
  onChecking?: (checking: boolean) => void;
  /** Paste a new password for this account (a refused one), rather than add one. */
  accountId?: string;
  address?: string;
}) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [address, setAddress] = useState(knownAddress ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const tried = useRef('');
  const reusable = useQuery({
    queryKey: ['google', 'reusable'],
    queryFn: googleApi.reusable,
    enabled: !accountId,
    staleTime: 30_000,
  });
  const shared = !accountId ? reusable.data?.address : undefined;
  const validAddress = ADDRESS.test(address.trim());
  const letters = password.replace(/\s+/g, '');
  const ready = validAddress && GMAIL_APP_PASSWORD.test(letters);
  const [next, setNext] = useState(false);
  const at = knownAddress || (next && validAddress) ? 1 : 0;

  const run = async (task: () => Promise<unknown>) => {
    setStatus('checking');
    onChecking?.(true);
    setError(undefined);
    try {
      const accepted = await guard(task);
      if (!accepted) {
        setStatus('idle');
        return;
      }
      setStatus('ok');
      onConnected();
    } catch (e) {
      setStatus('error');
      setError(e instanceof ApiError ? e.message : 'Gmail couldn’t be reached. Try again.');
    } finally {
      onChecking?.(false);
    }
  };

  // Checked as it lands: no button to find. The same pair is only tried once.
  useEffect(() => {
    const key = `${address.trim().toLowerCase()}:${letters}`;
    if (!ready || tried.current === key) return;
    tried.current = key;
    void run(() =>
      googleApi.connectPassword({
        address: address.trim(),
        password: letters,
        ...(accountId && { accountId }),
      }),
    );
  });

  return (
    <Stack gap={4}>
      {dialog}
      {shared && (
        <Callout
          tone="info"
          title="Use the sign-in Email already has?"
          action={
            <Button
              size="sm"
              loading={status === 'checking'}
              onClick={() => void run(googleApi.reuse)}
            >
              Use it for Gmail
            </Button>
          }
        >
          Your email channel signs in to Gmail as {shared}. Gmail the app can use the same app
          password — only if you say so.
        </Callout>
      )}
      <GuideSteps label="Connect Gmail with an app password">
        <GuideSteps.Step
          number={1}
          title="Your Gmail address"
          state={stepState(0, at)}
          summary={validAddress ? address.trim() : undefined}
          onEdit={knownAddress ? undefined : () => setNext(false)}
        >
          <Field>
            <Field.Label>Gmail address</Field.Label>
            <Input
              type="email"
              value={address}
              onChange={(e) => {
                setError(undefined);
                setStatus('idle');
                setAddress(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && validAddress) setNext(true);
              }}
              placeholder="you@gmail.com"
              autoComplete="email"
            />
          </Field>
          <Button
            variant="solid"
            className={styles.fit}
            disabled={!validAddress}
            onClick={() => setNext(true)}
          >
            Next
          </Button>
        </GuideSteps.Step>
        <GuideSteps.Step
          number={2}
          title="Make an app password and paste it"
          state={stepState(1, at)}
        >
          <Stack gap={3}>
            <Text tone="muted">
              An app password lets Conch into Gmail without your real password, and you can take it
              back any time. Google only offers them once 2-Step Verification is on — its page says
              how. Name it “Conch” and press Create.
            </Text>
            <OpenButton href={APP_PASSWORDS_URL}>Open Google’s app passwords page</OpenButton>
            <KeyField
              label="App password"
              value={password}
              onValueChange={(v) => {
                setError(undefined);
                setStatus('idle');
                setPassword(v);
              }}
              status={status}
              placeholder="abcd efgh ijkl mnop"
              checkingLabel="Signing in to Gmail…"
              description="Conch keeps it locked on this computer and never shows it again. It can read, search and save drafts — never send."
              found="That works."
              error={error}
              focusOnShow={Boolean(knownAddress)}
            />
          </Stack>
        </GuideSteps.Step>
      </GuideSteps>
    </Stack>
  );
}

/** Which capabilities an app needs from an account, as the server says (ADR 0048). */
const NEEDS: Record<GoogleAppId, GoogleCapability[]> = {
  gmail: ['mail-read', 'mail-draft'],
  'google-calendar': ['calendar-read'],
  'google-drive': ['drive-read'],
};

/**
 * The Connection section of a Google app's page: how it's signed in, the
 * accounts it uses, and — when one stopped working — the one fix right
 * there: paste a new app password, or sign in to Google again.
 */
export function GoogleAppConnection({
  integration,
  onCheck,
  checking,
}: {
  integration: Integration;
  onCheck: () => void;
  checking: boolean;
}) {
  const app = integration.id as GoogleAppId;
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['google'], queryFn: googleApi.status });
  // The app's health changed (a check, a refused password): the accounts did too.
  const { refetch } = status;
  const healthKey = `${integration.health.state}:${integration.health.checkedAt ?? ''}`;
  useEffect(() => {
    void refetch();
  }, [healthKey, refetch]);
  const accounts = (status.data?.accounts ?? []).filter((a) =>
    NEEDS[app]?.some((c) => a.capabilities.includes(c)),
  );
  const fixed = () => {
    void client.invalidateQueries({ queryKey: integrationKeys.all });
    void status.refetch();
  };
  return (
    <section className={styles.section} aria-labelledby="int-connection">
      <Heading level={2} id="int-connection" size="md">
        Connection
      </Heading>
      <dl className={styles.facts}>
        <div>
          <dt>How</dt>
          <dd>{integration.transport.type === 'host' ? integration.transport.how : ''}</dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>
            {integration.health.checkedAt ? relativeTime(integration.health.checkedAt) : 'Not yet'}
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<RotateCw />}
              onClick={onCheck}
              loading={checking}
            >
              Check now
            </Button>
          </dd>
        </div>
      </dl>
      <ul className={styles.accounts} aria-label="Accounts">
        {accounts.map((account) => (
          <li key={account.id}>
            <Stack gap={3}>
              <Stack direction="row" gap={2} align="center" wrap>
                <Text weight="medium">{account.email}</Text>
                <Text size="sm" tone="muted">
                  {account.via === 'app-password' ? 'App password' : 'Google sign-in'} ·{' '}
                  {account.state === 'ready'
                    ? 'Working'
                    : account.state === 'needs-auth'
                      ? 'Needs you'
                      : 'Out of reach'}
                </Text>
              </Stack>
              {account.state === 'needs-auth' &&
                (account.via === 'app-password' ? (
                  <GmailPassword
                    accountId={account.id}
                    address={account.email}
                    onConnected={fixed}
                  />
                ) : (
                  <GoogleConnect
                    intro={false}
                    capabilities={account.capabilities.filter((c) => NEEDS[app]?.includes(c))}
                    accountId={account.id}
                    onReady={fixed}
                  />
                ))}
            </Stack>
          </li>
        ))}
      </ul>
    </section>
  );
}
