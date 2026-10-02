import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { type GoogleCapability, type GoogleStatus } from '@conch/protocol';
import { Button, Callout, Field, Heading, Input, PasswordInput, Stack, Text } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { googleApi } from './googleApi';

export const GOOGLE_ACCESS: Record<GoogleCapability, string> = {
  'mail-read': 'Read and search Gmail',
  'mail-draft': 'Read Gmail and save drafts — never send',
  'calendar-read': 'Read calendar events',
  'drive-read': 'Find Drive files and read their metadata',
};
/** Shared by Integrations and the first-job flow. Consent only asks for this job's capabilities. */
export function GoogleConnect({
  capabilities,
  onReady,
  accountId,
}: {
  capabilities: GoogleCapability[];
  onReady: (accountId: string) => void;
  accountId?: string;
}) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [waiting, setWaiting] = useState(false),
    [flowId, setFlowId] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(''),
    [clientSecret, setClientSecret] = useState('');
  const [editingSetup, setEditingSetup] = useState(false);
  const popup = useRef<Window | null>(null);
  const status = useQuery({ queryKey: ['google'], queryFn: googleApi.status });
  const refreshStatus = status.refetch;
  useEffect(() => {
    if (!waiting || !flowId) return;
    let cancelled = false,
      running = false;
    const timer = window.setInterval(async () => {
      if (running || cancelled) return;
      if (popup.current?.closed) {
        setWaiting(false);
        setError('Google sign-in window closed. Start again when ready.');
        return;
      }
      running = true;
      try {
        const flow = await googleApi.flow(flowId);
        if (cancelled) return;
        if (flow.state === 'failed') {
          setWaiting(false);
          popup.current?.close();
          setError(
            'Google sign-in did not finish. Check the account and requested access, then try again.',
          );
          return;
        }
        if (flow.state === 'ready') {
          const updated = await refreshStatus();
          if (cancelled) return;
          const account = updated.data?.accounts.find(
            (a) =>
              a.id === flow.accountId &&
              a.state === 'ready' &&
              (!accountId || a.id === accountId) &&
              capabilities.every((c) => a.capabilities.includes(c)),
          );
          if (account) {
            setWaiting(false);
            popup.current?.close();
            onReady(account.id);
          }
        }
      } catch {
        if (!cancelled) setError('Waiting for Conch to reconnect. Your Google sign-in stays open.');
      } finally {
        running = false;
      }
    }, 1500);
    const timeout = window.setTimeout(() => {
      setWaiting(false);
      popup.current?.close();
      setError('Google sign-in expired. Start again when ready.');
    }, 600_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [waiting, flowId, accountId, capabilities, onReady, refreshStatus]);
  const callbackUrl = `${window.location.origin}/oauth/google/callback`;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      if (!(await guard(fn))) popup.current?.close();
      await status.refetch();
    } catch (e) {
      popup.current?.close();
      setError(e instanceof Error ? e.message : 'Google could not connect. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const connect = (id?: string) => {
    popup.current = window.open('about:blank', 'conch-google', 'popup,width=560,height=720');
    if (!popup.current) {
      setError('Allow popups for Conch, then press Connect Google again. Your job stays here.');
      return;
    }
    void act(async () => {
      const result = await googleApi.connect({ capabilities, accountId: id });
      const url = new URL(result.url);
      if (url.origin !== 'https://accounts.google.com')
        throw new Error('Google returned an unexpected sign-in address.');
      const opened = popup.current;
      if (!opened) throw new Error('Google sign-in window was closed.');
      opened.location.href = url.href;
      setFlowId(result.flowId);
      setWaiting(true);
    });
  };
  const choose = (id: string) =>
    act(async () => {
      const checked = await googleApi.check(id);
      const account = checked.accounts.find((a) => a.id === id);
      if (
        account?.state !== 'ready' ||
        !capabilities.every((c) => account.capabilities.includes(c))
      )
        throw new Error(account?.message ?? 'Reconnect Google and allow access for this job.');
      onReady(id);
    });
  const data: GoogleStatus | undefined = status.data;
  return (
    <Stack gap={3}>
      {dialog}
      <Heading level={2}>Google, connected to Conch</Heading>
      <Text tone="muted">
        Use your personal or work account with every model. Google content stays in the account you
        choose; Conch shares requested results with the model answering your job.
      </Text>
      <ul>
        {capabilities.map((c) => (
          <li key={c}>{GOOGLE_ACCESS[c]}</li>
        ))}
      </ul>
      {capabilities.includes('mail-draft') && (
        <Callout tone="info">
          Google’s draft permission also includes sending. Conch only exposes draft creation, asks
          before saving, and never calls Gmail’s send endpoint.
        </Callout>
      )}
      {(error || status.error) && <Callout tone="danger">{error || status.error?.message}</Callout>}
      {waiting && <Text>Finish signing in in the Google window. Your job will continue here.</Text>}
      {status.isPending && <Text>Checking your Google connection…</Text>}
      {data && (!data.configured || editingSetup) && (
        <Stack gap={3}>
          <Callout tone="info">
            This Conch needs its own Google app registration once. The person who runs Conch
            completes this setup; then everyone signs in with Google normally.
          </Callout>
          <ol>
            <li>
              <a
                href="https://console.cloud.google.com/apis/library"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google Cloud
              </a>
              , create a project, and enable Gmail API, Google Calendar API and Google Drive API for
              the jobs you want.
            </li>
            <li>
              In Google Auth Platform, set up Branding, Audience and Data Access. For testing, add
              your email as a test user. Public use of Gmail or Drive scopes can require Google
              verification; testing refresh tokens may expire after seven days.
            </li>
            <li>
              In Clients, create a Web application client. Add the exact callback address below as
              an Authorized redirect URI, then paste its client ID and secret here.
            </li>
          </ol>
          <Field>
            <Field.Label>Callback address to register</Field.Label>
            <Input readOnly value={callbackUrl} />
            <Field.Description>
              Remote access needs HTTPS and this address must open Conch from the browser where you
              sign in. A localhost address only works on the same computer.
            </Field.Description>
          </Field>
          <Button
            variant="surface"
            onClick={() => void act(() => navigator.clipboard.writeText(callbackUrl))}
          >
            Copy callback address
          </Button>
          <Field>
            <Field.Label>Google client ID</Field.Label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field>
            <Field.Label>Google client secret</Field.Label>
            <PasswordInput
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
            <Field.Description>
              Encrypted on the Conch computer. Never shared with your assistant.
            </Field.Description>
          </Field>
          <Button
            disabled={busy || !clientId || !clientSecret}
            onClick={() =>
              void act(async () => {
                await googleApi.configure({ clientId, clientSecret, redirectUrl: callbackUrl });
                setClientSecret('');
                setClientId('');
                setEditingSetup(false);
              })
            }
          >
            Save Google app setup
          </Button>
        </Stack>
      )}
      {data?.configured && (
        <Stack gap={3}>
          <Button
            variant="ghost"
            disabled={busy || waiting}
            onClick={() => setEditingSetup(!editingSetup)}
          >
            {editingSetup ? 'Close Google app setup' : 'Change Google app setup'}
          </Button>
          {data.accounts
            .filter((a) => !accountId || a.id === accountId)
            .map((account) => (
              <Stack key={account.id} gap={2}>
                <Text>
                  <strong>{account.email}</strong> ·{' '}
                  {account.state === 'ready'
                    ? 'Connected'
                    : (account.message ?? 'Reconnect needed')}
                </Text>
                <Text tone="muted">
                  {account.capabilities.map((c) => GOOGLE_ACCESS[c]).join(' · ')}
                </Text>
                {account.state === 'ready' &&
                capabilities.every((c) => account.capabilities.includes(c)) ? (
                  <Button disabled={busy || waiting} onClick={() => void choose(account.id)}>
                    Use {account.email}
                  </Button>
                ) : (
                  <Button disabled={busy || waiting} onClick={() => void connect(account.id)}>
                    Reconnect {account.email} for this job
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy || waiting}
                  onClick={() => void act(() => googleApi.disconnect(account.id))}
                >
                  Disconnect {account.email}
                </Button>
              </Stack>
            ))}
          <Button variant="surface" disabled={busy || waiting} onClick={() => void connect()}>
            Connect Google{data.accounts.length ? ' · another account' : ''}
          </Button>
          <Text tone="muted">
            Google will ask which account to use and what to allow. No access to your other
            accounts.
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
