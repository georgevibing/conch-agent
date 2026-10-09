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
  PasswordInput,
  Stack,
  Text,
} from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Google’s sign-in lasts ten minutes; with eight left (two gone), Conch says what usually stops it. */
const SLOW_WHEN_LEFT_MS = 8 * 60_000;
import { googleApi } from './googleApi';
import { GoogleSetup, googleServices } from './GoogleSetup';
import styles from './Integrations.module.css';

function savedFlow(key: string) {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
/**
 * Google's own sign-in, for one account and the access it should have.
 * Credentials, codes and return addresses never enter the chat or browser
 * storage; only the expiring flow id is kept, so a reload picks up where it
 * was (ADR 0040). Sets up the Google app first when there isn't one.
 */
interface GoogleConnectProps {
  capabilities: GoogleCapability[];
  onReady: (accountId: string) => void;
  /** Sign in again as this account (more access, or a revoked sign-in). */
  accountId?: string;
  /** What the button says: “Continue with Google”, “Sign in again”, “Allow on Google”. */
  label?: string;
  /** One line under the button, in place of the usual one. */
  lead?: string;
  /** Changed their mind: the caller goes back. */
  onCancel?: () => void;
}
export function GoogleConnect(props: GoogleConnectProps) {
  return (
    <GoogleConnection
      key={(props.accountId ?? 'new') + ':' + [...props.capabilities].sort().join(',')}
      {...props}
    />
  );
}
function GoogleConnection({
  capabilities,
  onReady,
  accountId,
  label = 'Continue with Google',
  lead,
  onCancel,
}: GoogleConnectProps) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const capabilityKey = [...capabilities].sort().join(',');
  const touch = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
  )[0];
  const flowKey = 'conch-google-flow:' + (accountId ?? 'new') + ':' + capabilityKey;
  const [flowId, setFlowId] = useState(() => savedFlow(flowKey));
  const [mode, setMode] = useState<'automatic' | 'manual'>('automatic');
  const [signInUrl, setSignInUrl] = useState('');
  const [returnUrl, setReturnUrl] = useState('');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  /** Google sent the person back to another browser: one press here finishes. */
  const [returned, setReturned] = useState(false);
  /** Google hasn't sent them back for a while: say what usually stops it. */
  const [slow, setSlow] = useState(false);
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
        setReturned(flow.state === 'returned');
        // Waiting more than two of its ten minutes.
        if (flow.expiresAt) setSlow(flow.expiresAt - Date.now() < SLOW_WHEN_LEFT_MS);
        if (flow.state === 'failed') {
          setSlow(false);
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
              'That account doesn’t have what was asked for. Sign in again and leave every box Google shows ticked.',
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
  const start = async () => {
    stopping.current = '';
    const result = await googleApi.connect({ capabilities, accountId });
    const url = new URL(result.url);
    if (url.origin !== 'https://accounts.google.com' || url.username || url.password)
      throw new Error('Google returned an unexpected sign-in address.');
    setMode(result.mode);
    setSignInUrl(url.href);
    setFlowId(result.flowId);
    setReturnUrl('');
    setReturned(false);
    setSlow(false);
    const opened = popup.current;
    if (opened && !opened.closed) opened.location.href = url.href;
  };
  const openPopup = () => {
    // On a phone a blank window opened before Google's address is known can stay blank
    // (an installed Conch hands it to Safari, out of reach): Open Google sign-in instead.
    if (touch) return;
    popup.current = window.open('about:blank', 'conch-google', 'popup,width=560,height=720');
  };
  const connect = () => {
    openPopup();
    void act(start);
  };
  const saveAndConnect = (save: () => Promise<unknown>) => {
    openPopup();
    return act(async () => {
      await save();
      setEditingSetup(false);
      await start();
    });
  };
  const data = status.data;
  const local =
    window.location.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const remoteDesktop = data?.clientType === 'desktop' && !local;
  const callbackUrl = data?.clientType === 'web' ? data.callbackUrl : undefined;
  const settingUp = data && (!data.configured || editingSetup) && !waiting;
  return (
    <Stack gap={4}>
      {dialog}
      {(error || status.error) && (
        <Callout tone="danger" live="polite">
          {error || status.error?.message}
        </Callout>
      )}
      {offline && (
        <Callout tone="info" live="polite">
          Waiting for Conch to reconnect. Keep the Google window open; your sign-in picks up here.
        </Callout>
      )}
      {status.isPending && <Text tone="muted">Checking your Google setup…</Text>}
      {waiting && (
        <Stack gap={3}>
          {returned ? (
            <>
              <Callout tone="success" live="polite" title="Google sent you back">
                It opened in another browser, which can’t finish for you. Press Finish connecting to
                add the account here.
              </Callout>
              <Button
                className={styles.fit}
                disabled={busy}
                loading={busy}
                onClick={() => void act(() => googleApi.claim(flowId))}
              >
                Finish connecting
              </Button>
            </>
          ) : (
            <Callout tone="info" live="polite" title="Finish in the Google window">
              {mode === 'manual'
                ? 'Choose the account and allow access. Then bring the address Google ends on back here.'
                : touch
                  ? 'Open Google sign-in, choose the account and allow access, then come back to Conch. If Google opens in another browser, Conch asks you to press Finish connecting here.'
                  : 'Choose the account and allow access. This picks up by itself when you’re done.'}
            </Callout>
          )}
          {slow && !returned && (
            <Callout tone="warning" live="polite" title="Google hasn’t sent you back yet">
              <Stack gap={2}>
                <Text size="sm">
                  If the Google window is still open, finish there. If it showed an error, here’s
                  what fixes it, then press Cancel sign-in and start again:
                </Text>
                <Text size="sm">
                  <strong>“Access blocked” or “not a test user”:</strong> while your Google app is
                  in Testing, only its test users can sign in. Add the exact address you’re adding
                  under Audience → Test users, one line per address.
                </Text>
                <Text size="sm">
                  <strong>“400”, “malformed” or “redirect_uri_mismatch”:</strong>{' '}
                  {callbackUrl
                    ? `your Web client must list exactly ${callbackUrl} under Authorized redirect URIs.`
                    : 'start again from this page rather than from an old Google tab or a link you saved; each sign-in can be used once.'}
                </Text>
                <Text size="sm">
                  This sign-in stops by itself 10 minutes after it began, and says so here.
                </Text>
              </Stack>
            </Callout>
          )}
          {signInUrl && !returned && (
            <Button
              asChild
              variant={touch && mode === 'automatic' ? 'solid' : 'surface'}
              trailingIcon={<SquareArrowOutUpRight />}
              className={styles.fit}
            >
              <a href={signInUrl} target="_blank" rel="noopener noreferrer">
                Open Google sign-in
              </a>
            </Button>
          )}
          {mode === 'manual' && (
            <>
              <Text size="sm" tone="muted">
                After you allow access, the window may say it can’t open 127.0.0.1, or keep loading.
                That’s expected for a Conch that isn’t on this device. Copy the whole address from
                that window’s address bar (on a phone: tap it, then Select All and Copy) and paste
                it here — never into a chat.
              </Text>
              {touch && (
                <Text size="sm" tone="muted">
                  Easier on a phone: add the account from Conch on the computer it runs on, where
                  Google finishes by itself. It shows up here too.
                </Text>
              )}
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
                  Everything, including the question mark and what follows. Conch checks it here and
                  never opens it.
                </Field.Description>
              </Field>
              <Button
                className={styles.fit}
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
            className={styles.fit}
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
      {settingUp && <GoogleSetup capabilities={capabilities} busy={busy} onSave={saveAndConnect} />}
      {data?.configured && !waiting && !editingSetup && (
        <Stack gap={2}>
          <Stack direction="row" gap={2} wrap>
            <Button loading={busy} onClick={connect}>
              {label}
            </Button>
            {onCancel && (
              <Button variant="ghost" disabled={busy} onClick={onCancel}>
                Not now
              </Button>
            )}
          </Stack>
          <Text size="sm" tone="muted">
            {lead ??
              (remoteDesktop
                ? 'Google asks which account and what to allow. At the end you paste one address back here; nothing else to set up.'
                : 'Google asks which account and what to allow. Leave every box it shows ticked.')}
          </Text>
        </Stack>
      )}
      <Accordion type="single" collapsible>
        <Accordion.Item value="help">
          <Accordion.Trigger>If Google says no</Accordion.Trigger>
          <Accordion.Content>
            <Stack gap={3}>
              <Text size="sm">
                <strong>Access blocked, or “not a test user”:</strong> add the exact address you
                sign in with under Audience → Test users. A work account may need its
                administrator’s approval.
              </Text>
              <a
                href={googleConsoleUrl('/auth/audience', data?.projectId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google’s Audience settings
              </a>
              <Text size="sm">
                <strong>“Google hasn’t verified this app”:</strong> that’s your own app, in your own
                project. Continue only if you recognise its name.
              </Text>
              <Text size="sm">
                <strong>An API isn’t enabled:</strong> enable it below, wait a minute, then press
                Check now on the account. You won’t be asked to sign in again.
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
              <Text size="sm">
                <strong>Signing in every week:</strong> while your Google app is in Testing, Google
                can end its access after seven days. Publishing it in Audience lifts that.
              </Text>
              <Text size="sm">
                <strong>A callback or client error:</strong> use a current Desktop app file, or
                register this exact Conch address in your Web client.
              </Text>
              {data?.configured && !waiting && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.fit}
                  disabled={busy}
                  onClick={() => setEditingSetup(!editingSetup)}
                >
                  {editingSetup ? 'Keep the Google app as it is' : 'Use a different Google app'}
                </Button>
              )}
            </Stack>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
