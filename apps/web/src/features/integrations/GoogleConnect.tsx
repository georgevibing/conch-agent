import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { type GoogleCapability } from '@conch/protocol';
import {
  Accordion,
  Button,
  Callout,
  Field,
  GOOGLE_APIS,
  googleConsoleUrl,
  Heading,
  PasswordInput,
  Stack,
  Text,
} from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { googleApi } from './googleApi';
import { GoogleSetup, googleServices } from './GoogleSetup';

export const GOOGLE_ACCESS: Record<GoogleCapability, string> = {
  'mail-read': 'Read and search Gmail',
  'mail-draft': 'Read Gmail and save drafts — never send',
  'calendar-read': 'Read calendar events',
  'drive-read': 'Find Drive files and read their metadata',
};
function savedFlow(key: string) {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
/** Shared by Integrations and the first-job flow. Credential/code entry never enters chat. */
interface GoogleConnectProps {
  capabilities: GoogleCapability[];
  onReady: (accountId: string) => void;
  accountId?: string;
}
export function GoogleConnect(props: GoogleConnectProps) {
  return (
    <GoogleConnection
      key={(props.accountId ?? 'new') + ':' + [...props.capabilities].sort().join(',')}
      {...props}
    />
  );
}
function GoogleConnection({ capabilities, onReady, accountId }: GoogleConnectProps) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const capabilityKey = [...capabilities].sort().join(',');
  const flowKey = 'conch-google-flow:' + (accountId ?? 'new') + ':' + capabilityKey;
  const [flowId, setFlowId] = useState(() => savedFlow(flowKey));
  const [mode, setMode] = useState<'automatic' | 'manual'>('automatic');
  const [signInUrl, setSignInUrl] = useState('');
  const [returnUrl, setReturnUrl] = useState('');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingSetup, setEditingSetup] = useState(false);
  const popup = useRef<Window | null>(null);
  const notified = useRef('');
  const stopping = useRef('');
  const status = useQuery({ queryKey: ['google'], queryFn: googleApi.status });
  const refreshStatus = status.refetch;
  const waiting = !!flowId;
  useEffect(() => {
    try {
      if (flowId) sessionStorage.setItem(flowKey, flowId);
      else sessionStorage.removeItem(flowKey);
    } catch {
      /* Storage can be disabled; sign-in still works without reload recovery. */
    }
  }, [flowId, flowKey]);
  useEffect(() => {
    if (!flowId) return;
    let cancelled = false,
      running = false;
    const poll = async () => {
      if (running || cancelled) return;
      running = true;
      try {
        const flow = await googleApi.flow(flowId);
        if (cancelled || stopping.current === flowId) return;
        setOffline(false);
        if (flow.mode) setMode(flow.mode);
        if (flow.state === 'failed') {
          setFlowId('');
          setReturnUrl('');
          setSignInUrl('');
          popup.current?.close();
          setError(
            flow.message ??
              'Google sign-in expired or Conch restarted. Start a new sign-in; your saved setup is kept.',
          );
          await refreshStatus();
          return;
        }
        if (flow.state === 'ready') {
          const updated = await refreshStatus();
          if (cancelled || stopping.current === flowId) return;
          const account = updated.data?.accounts.find(
            (a) =>
              a.id === flow.accountId &&
              a.state === 'ready' &&
              (!accountId || a.id === accountId) &&
              capabilityKey.split(',').every((c) => a.capabilities.includes(c as GoogleCapability)),
          );
          if (account && notified.current !== flowId) {
            notified.current = flowId;
            // onReady may unmount this view before the storage effect can run.
            try {
              sessionStorage.removeItem(flowKey);
            } catch {
              /* Storage can be disabled. */
            }
            setFlowId('');
            setReturnUrl('');
            setSignInUrl('');
            popup.current?.close();
            onReady(account.id);
          } else if (!account && !updated.error) {
            setFlowId('');
            setReturnUrl('');
            setSignInUrl('');
            setError(
              'The connected account does not have the access this job needs. Choose the intended account below or reconnect it.',
            );
          }
        }
        // A closed popup is not proof of failure: the callback may have completed.
        // Keep the server-owned flow alive, especially for remote paste-back.
      } catch {
        if (!cancelled) setOffline(true);
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [flowId, flowKey, accountId, capabilityKey, onReady, refreshStatus]);
  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const accepted = await guard(fn);
      if (!accepted && !waiting) popup.current?.close();
      await status.refetch();
      return accepted;
    } catch (e) {
      if (!waiting) popup.current?.close();
      setError(e instanceof Error ? e.message : 'Google could not connect. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const start = async (id?: string) => {
    stopping.current = '';
    const result = await googleApi.connect({ capabilities, accountId: id });
    const url = new URL(result.url);
    if (url.origin !== 'https://accounts.google.com' || url.username || url.password)
      throw new Error('Google returned an unexpected sign-in address.');
    setMode(result.mode);
    setSignInUrl(url.href);
    setFlowId(result.flowId);
    setReturnUrl('');
    const opened = popup.current;
    if (opened && !opened.closed) opened.location.href = url.href;
  };
  const openPopup = () => {
    popup.current = window.open('about:blank', 'conch-google', 'popup,width=560,height=720');
  };
  const connect = (id?: string) => {
    openPopup();
    void act(() => start(id));
  };
  const saveAndConnect = (save: () => Promise<unknown>) => {
    openPopup();
    return act(async () => {
      await save();
      setEditingSetup(false);
      await start(accountId);
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
  const data = status.data;
  const local =
    window.location.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const remoteDesktop = data?.clientType === 'desktop' && !local;
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
      {offline && (
        <Callout tone="info">
          Waiting for Conch to reconnect. Keep the Google window open; your sign-in will resume
          here.
        </Callout>
      )}
      {status.isPending && <Text>Checking your Google connection…</Text>}
      {waiting && (
        <Stack gap={3}>
          <Text role="status">
            {mode === 'manual'
              ? 'Finish Google sign-in, then bring the return address back here.'
              : 'Finish signing in in the Google window. Your job will continue here.'}
          </Text>
          {signInUrl && (
            <Button asChild variant="surface">
              <a href={signInUrl} target="_blank" rel="noopener noreferrer">
                Open Google sign-in
              </a>
            </Button>
          )}
          {mode === 'manual' && (
            <>
              <Callout tone="info">
                After you approve access, your browser may say it cannot open 127.0.0.1. That is
                expected for a remote Conch. Copy the full address from that window’s address bar
                and paste it below. Do not paste it into chat.
              </Callout>
              <Field>
                <Field.Label>Return address from Google</Field.Label>
                <PasswordInput
                  value={returnUrl}
                  onChange={(e) => setReturnUrl(e.target.value.trim())}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
                <Field.Description>
                  Include the whole address, including the question mark and everything after it.
                  Conch checks it locally and never opens that address.
                </Field.Description>
              </Field>
              <Button
                disabled={busy || !returnUrl}
                loading={busy}
                onClick={() =>
                  void act(async () => {
                    await googleApi.complete(flowId, returnUrl);
                    setReturnUrl('');
                  })
                }
              >
                Finish connecting
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              stopping.current = flowId;
              void act(async () => {
                await googleApi.cancel(flowId);
                popup.current?.close();
                setFlowId('');
                setReturnUrl('');
                setSignInUrl('');
              }).then((ok) => {
                if (!ok) stopping.current = '';
              });
            }}
          >
            Cancel sign-in
          </Button>
        </Stack>
      )}
      {data && (!data.configured || editingSetup) && !waiting && (
        <GoogleSetup capabilities={capabilities} busy={busy} onSave={saveAndConnect} />
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
                  <Button
                    aria-label={'Use ' + account.email}
                    disabled={busy || waiting}
                    onClick={() => void choose(account.id)}
                  >
                    Use this account
                  </Button>
                ) : (
                  <>
                    {account.state === 'unavailable' && (
                      <Button
                        aria-label={'Check connection for ' + account.email}
                        disabled={busy || waiting}
                        onClick={() => void choose(account.id)}
                      >
                        Check connection
                      </Button>
                    )}
                    <Button
                      aria-label={'Reconnect ' + account.email + ' for this job'}
                      variant={account.state === 'unavailable' ? 'ghost' : 'solid'}
                      disabled={busy || waiting}
                      onClick={() => connect(account.id)}
                    >
                      Reconnect for this job
                    </Button>
                  </>
                )}
                <Button
                  aria-label={'Disconnect ' + account.email}
                  variant="ghost"
                  disabled={busy || waiting}
                  onClick={() => void act(() => googleApi.disconnect(account.id))}
                >
                  Disconnect
                </Button>
              </Stack>
            ))}
          {remoteDesktop && !waiting && (
            <Text tone="muted">
              This Conch uses a Desktop app client on a remote address. After Google consent, paste
              the return address here. No public callback or port forwarding is needed.
            </Text>
          )}
          <Button variant="surface" disabled={busy || waiting} onClick={() => connect()}>
            Connect Google{data.accounts.length ? ' · another account' : ''}
          </Button>
          <Text tone="muted">
            Google will ask which account to use and what to allow. Reconnecting retains existing
            access and adds the permissions for this job. No access to your other accounts.
          </Text>
        </Stack>
      )}
      <Accordion type="single" collapsible>
        <Accordion.Item value="help">
          <Accordion.Trigger>Sign-in help</Accordion.Trigger>
          <Accordion.Content>
            <Stack gap={3}>
              <Text>
                <strong>Access blocked or test user missing:</strong> add the exact email you are
                signing in with under Audience → Test users. Work accounts can also need
                administrator approval.
              </Text>
              <a
                href={googleConsoleUrl('/auth/audience', data?.projectId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google Audience settings
              </a>
              <Text>
                <strong>Google hasn’t verified this app:</strong> check that it is the app you
                created in your own project. Follow Google’s available personal-testing option only
                if you recognize the app. If Google blocks access, check Audience or ask your
                Workspace administrator.
              </Text>
              <Text>
                <strong>API not enabled:</strong> enable it below, wait briefly for Google to apply
                the change, then press Check connection. Your saved sign-in can be reused.
              </Text>
              {googleServices([
                ...capabilities,
                ...(data?.accounts.flatMap((a) => a.capabilities) ?? []),
              ]).map((id) => (
                <a
                  key={id}
                  href={googleConsoleUrl(
                    '/apis/library/' + GOOGLE_APIS[id].service,
                    data?.projectId,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Enable {GOOGLE_APIS[id].name}
                </a>
              ))}
              <Text>
                <strong>Signing in every week:</strong> Google’s Testing mode can expire access
                after seven days. Review Audience when you are ready to leave Testing; publication
                or restricted access may require verification.
              </Text>
              <Text>
                <strong>Callback or client error:</strong> import a current Desktop app credential
                JSON, or register this exact Conch address in your Web client. Keep using the same
                browser and Conch address until sign-in finishes.
              </Text>
              <a
                href={googleConsoleUrl('/auth/clients', data?.projectId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google Clients settings
              </a>
            </Stack>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
