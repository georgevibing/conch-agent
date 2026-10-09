import { looksLikeAccessKey, type AuthStatus } from '@conch/protocol';
import {
  Button,
  Callout,
  CodeBlock,
  Collapsible,
  Field,
  Heading,
  Input,
  PasskeyButton,
  PasswordInput,
  Pearl,
  Separator,
  Stack,
  Text,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, RotateCw } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import { useAutoFocus } from '../../lib/useAutoFocus';
import styles from './Auth.module.css';
import { askPasskey, cancelPasskey, passkeyProblem } from './passkey';
import { applySignedIn } from './signedIn';
import { usePasskeyPlatform } from './usePasskeyPlatform';
import { useCountdown } from './useCountdown';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The one screen a signed-out device sees. */
export function SignIn({ status, notice }: { status: AuthStatus; notice?: string }) {
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | undefined>(notice);
  const [lockedUntil, setLockedUntil] = useState<number>();
  const [busy, setBusy] = useState(false);
  const wait = useCountdown(lockedUntil);
  const usesKey = status.method === 'key';
  const first = useAutoFocus<HTMLInputElement>();
  const { platform, support } = usePasskeyPlatform();
  /** Passkeys are the only way in (ADR 0065): there's no password to type. */
  const onlyPasskeys = status.method === 'passkey';
  const passkeysHere = Boolean(status.passkeys) || onlyPasskeys;
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const limited = (err: ApiError) => {
    setLockedUntil(Date.now() + (err.retryAfter ?? 60) * 1000);
    setError(undefined);
  };

  /** Touch ID, Windows Hello, Face ID: the passkey signs in, and approves this device by itself. */
  const signInWithPasskey = async () => {
    setPasskeyBusy(true);
    setError(undefined);
    try {
      const response = await askPasskey('sign-in', { autofill: false });
      await applySignedIn(client, await api.signIn({ with: 'passkey', response }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'rate-limited') limited(e);
      else {
        // Closing the browser's own prompt is no error.
        const problem = e instanceof ApiError ? e.message : passkeyProblem(e);
        if (problem) setError(problem);
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  // The username field offers this device's passkeys as it's filled (conditional UI).
  // It waits quietly until one is picked; leaving the page, or pressing the button, ends it.
  const autofill = Boolean(support?.autofill && status.passkeys && !onlyPasskeys && !usesKey);
  useEffect(() => {
    if (!autofill) return;
    let live = true;
    askPasskey('sign-in', { autofill: true })
      .then(async (response) => {
        if (!live) return;
        setPasskeyBusy(true);
        await applySignedIn(client, await api.signIn({ with: 'passkey', response }));
      })
      .catch((e: unknown) => {
        if (!live || !(e instanceof ApiError)) return;
        if (e.code === 'rate-limited') setLockedUntil(Date.now() + (e.retryAfter ?? 60) * 1000);
        else setError(e.message);
      })
      .finally(() => live && setPasskeyBusy(false));
    return () => {
      live = false;
      cancelPasskey();
    };
  }, [autofill, client]);

  const submit = async (value = secret) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await api.signIn(
        usesKey ? { with: 'key', key: value } : { with: 'password', username, password: value },
      );
      await applySignedIn(client, next);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'rate-limited') {
        limited(err);
      } else {
        setError(err.message);
      }
      setSecret('');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const problems = (
    <>
      {error && (
        <Callout tone="danger" live="assertive">
          {error}
        </Callout>
      )}
      {wait > 0 && (
        <Callout tone="warning" live="polite" title="Too many tries">
          For your security, wait {clock(wait)} before trying again.
        </Callout>
      )}
    </>
  );

  // Who may sign in couldn't be read: the way back in is on the computer itself.
  if (status.locked) {
    return (
      <main className={styles.root}>
        <div className={styles.glow} aria-hidden />
        <Stack gap={5} align="center" className={styles.card}>
          <Pearl size="lg" state="idle" label={null} />
          <Heading level={1} display size="4xl" align="center">
            Locked to keep it safe
          </Heading>
          <Text tone="muted" align="center">
            Conch couldn’t read who may sign in, so it locked itself rather than let anyone in. On
            the computer running Conch, open a terminal in the Conch folder and run:
          </Text>
          <CodeBlock language="bash" code="pnpm conch reset" className={styles.command} />
          <Text size="sm" tone="muted" align="center">
            Then open Conch on that computer and choose a new password in{' '}
            <strong>Settings → Security</strong>.
          </Text>
          <Button
            variant="surface"
            leadingIcon={<RotateCw />}
            onClick={() => void client.invalidateQueries({ queryKey: keys.auth })}
          >
            I’ve done it — try again
          </Button>
        </Stack>
      </main>
    );
  }

  // This computer, but a browser Conch didn't open (ADR 0063): open it from Conch.
  if (status.hereRequired) {
    return (
      <main className={styles.root}>
        <div className={styles.glow} aria-hidden />
        <Stack gap={5} align="center" className={styles.card}>
          <Pearl size="lg" state="idle" label={null} />
          <Heading level={1} display size="4xl" align="center">
            Open Conch from your apps
          </Heading>
          <Text tone="muted" align="center">
            Conch can run commands on this computer, so it only trusts a browser it opened itself.
            Open Conch from your apps, and this browser is let in from then on.
          </Text>
          {notice && (
            <Callout tone="warning" live="polite">
              {notice}
            </Callout>
          )}
          <Text size="sm" tone="muted" align="center">
            Or, in a terminal in the Conch folder:
          </Text>
          <CodeBlock language="bash" code="pnpm conch open" className={styles.command} />
          <Button
            variant="surface"
            leadingIcon={<RotateCw />}
            onClick={() => void client.invalidateQueries({ queryKey: keys.auth })}
          >
            I’ve opened it — try again
          </Button>
        </Stack>
      </main>
    );
  }

  if (status.setupRequired) {
    return (
      <main className={styles.root}>
        <div className={styles.glow} aria-hidden />
        <Stack gap={5} align="center" className={styles.card}>
          <Pearl size="lg" state="idle" label={null} />
          <Heading level={1} display size="4xl" align="center">
            Almost there
          </Heading>
          <Text tone="muted" align="center">
            Conch is protecting your computer: other devices can’t use it until you choose how they
            sign in. On the computer running Conch, open <strong>Settings → Security</strong> and
            pick a password.
          </Text>
          <Button
            variant="surface"
            leadingIcon={<RotateCw />}
            onClick={() => void client.invalidateQueries({ queryKey: keys.auth })}
          >
            I’ve done it — try again
          </Button>
        </Stack>
      </main>
    );
  }

  return (
    <main className={styles.root}>
      <div className={styles.glow} aria-hidden />
      <Stack gap={6} className={styles.card}>
        <Stack gap={3} align="center">
          <Pearl size="lg" state={busy ? 'thinking' : 'idle'} label={null} />
          <Heading level={1} display size="4xl" align="center">
            Welcome back
          </Heading>
          <Text tone="muted" align="center">
            {usesKey
              ? 'Paste your access key to use Conch on this device.'
              : 'Sign in to use Conch on this device.'}
          </Text>
        </Stack>

        {!status.secure && (
          <Callout tone="warning" title="This connection isn’t encrypted">
            People on this network could see what you send, including your password. For a private
            connection, use Tailscale.
          </Callout>
        )}

        {passkeysHere && platform && (platform !== 'phone' || onlyPasskeys) && (
          <PasskeyButton
            platform={platform}
            action="sign-in"
            block
            loading={passkeyBusy}
            disabled={wait > 0}
            onClick={() => void signInWithPasskey()}
          />
        )}
        {onlyPasskeys && support && !platform && (
          <Callout tone="info" title="Passkeys don’t work in this browser">
            Open Conch at its https:// address in a browser that has passkeys (Safari, Chrome, Edge
            or Firefox), or sign in on a device that’s already signed in.
          </Callout>
        )}
        {onlyPasskeys && problems}
        {!onlyPasskeys && passkeysHere && platform && platform !== 'phone' && (
          <Separator label="or" />
        )}

        {!onlyPasskeys && (
          <form className={styles.form} onSubmit={onSubmit} aria-label="Sign in">
            <Stack gap={4}>
              {!usesKey && (
                <Field>
                  <Field.Label>Username</Field.Label>
                  <Input
                    ref={first}
                    size="lg"
                    name="username"
                    autoComplete={autofill ? 'username webauthn' : 'username'}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </Field>
              )}
              <Field invalid={Boolean(error)}>
                <Field.Label>{usesKey ? 'Access key' : 'Password'}</Field.Label>
                <PasswordInput
                  ref={usesKey ? first : undefined}
                  size="lg"
                  name={usesKey ? 'access-key' : 'password'}
                  autoComplete={usesKey ? 'off' : 'current-password'}
                  placeholder={usesKey ? 'conch_…' : undefined}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  onPaste={(e) => {
                    // Pasting a whole key is the whole job — sign in straight away.
                    const pasted = e.clipboardData.getData('text');
                    if (usesKey && looksLikeAccessKey(pasted)) {
                      e.preventDefault();
                      setSecret(pasted.trim());
                      void submit(pasted.trim());
                    }
                  }}
                  required
                />
              </Field>
              {problems}
              <Button
                type="submit"
                size="lg"
                block
                loading={busy}
                disabled={wait > 0}
                leadingIcon={<LockKeyhole />}
              >
                Sign in
              </Button>
            </Stack>
          </form>
        )}
        {!onlyPasskeys && passkeysHere && platform === 'phone' && (
          <PasskeyButton
            platform="phone"
            action="sign-in"
            variant="ghost"
            size="md"
            loading={passkeyBusy}
            onClick={() => void signInWithPasskey()}
          />
        )}

        {status.here === 'unproven' && (
          <Text size="sm" tone="muted" align="center">
            On the computer running Conch? Open Conch from your apps, and this browser counts as
            that computer: it can approve new devices.
          </Text>
        )}

        <Collapsible>
          <Collapsible.Trigger chevron className={styles.help}>
            {onlyPasskeys
              ? 'Lost your passkey?'
              : usesKey
                ? 'Lost your key?'
                : 'Forgot your password?'}
          </Collapsible.Trigger>
          <Collapsible.Content>
            {onlyPasskeys ? (
              <Text size="sm" tone="muted" className={styles.helpBody}>
                On a device that’s already signed in, open Settings → Access → Add a device. Or, on
                the computer running Conch, run <code>conch reset</code>, then{' '}
                <code>conch hello</code> for a fresh link that makes it yours again.
              </Text>
            ) : (
              <Text size="sm" tone="muted" className={styles.helpBody}>
                {usesKey
                  ? 'On a device that’s already signed in, open Settings → Access → Add a device. Or, on the computer running Conch, run '
                  : 'On the computer running Conch, open a terminal in the Conch folder and run '}
                <code>{usesKey ? 'pnpm conch key' : 'pnpm conch reset'}</code>
                {usesKey
                  ? ' to make a new key.'
                  : ', then choose a new password. Only someone at that computer can do this — that’s what keeps it safe.'}
              </Text>
            )}
          </Collapsible.Content>
        </Collapsible>
      </Stack>
    </main>
  );
}
