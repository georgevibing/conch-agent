import { looksLikeAccessKey, type AuthStatus } from '@conch/protocol';
import {
  Button,
  Callout,
  CodeBlock,
  Collapsible,
  Field,
  Heading,
  Input,
  PasswordInput,
  Pearl,
  Stack,
  Text,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, RotateCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { api, type ApiError } from '../../api/client';
import { keys } from '../../api/queries';
import { useAutoFocus } from '../../lib/useAutoFocus';
import styles from './Auth.module.css';
import { applySignedIn } from './signedIn';
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
        setLockedUntil(Date.now() + (err.retryAfter ?? 60) * 1000);
        setError(undefined);
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

        <form className={styles.form} onSubmit={onSubmit} aria-label="Sign in">
          <Stack gap={4}>
            {!usesKey && (
              <Field>
                <Field.Label>Username</Field.Label>
                <Input
                  ref={first}
                  size="lg"
                  name="username"
                  autoComplete="username"
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

        {status.here === 'unproven' && (
          <Text size="sm" tone="muted" align="center">
            On the computer running Conch? Open Conch from your apps, and this browser counts as
            that computer: it can approve new devices.
          </Text>
        )}

        <Collapsible>
          <Collapsible.Trigger chevron className={styles.help}>
            {usesKey ? 'Lost your key?' : 'Forgot your password?'}
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Text size="sm" tone="muted" className={styles.helpBody}>
              {usesKey
                ? 'On a device that’s already signed in, open Settings → Security → Add a device. Or, on the computer running Conch, run '
                : 'On the computer running Conch, open a terminal in the Conch folder and run '}
              <code>{usesKey ? 'pnpm conch key' : 'pnpm conch reset'}</code>
              {usesKey
                ? ' to make a new key.'
                : ', then choose a new password. Only someone at that computer can do this — that’s what keeps it safe.'}
            </Text>
          </Collapsible.Content>
        </Collapsible>
      </Stack>
    </main>
  );
}
