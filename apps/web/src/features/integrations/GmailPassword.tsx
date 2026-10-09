import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { OpenButton, stepState } from '../channels/ConnectChannel';
import { GMAIL_APP_PASSWORD, type GoogleLevel } from '@conch/protocol';
import { Button, Callout, Field, GuideSteps, Input, KeyField, Stack, Text } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { googleApi } from './googleApi';
import styles from './Integrations.module.css';

/** Where Google makes app passwords. It needs 2-Step Verification on first. */
export const APP_PASSWORDS_URL = 'https://myaccount.google.com/apppasswords';
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Gmail with an app password, in two steps: the address, then make one at
 * Google and paste it. It's checked by signing in as soon as it lands;
 * nothing is kept until it works. When the email channel already signs in
 * to Gmail, Conch offers that sign-in in one tap, and only uses it if the
 * person says yes.
 */
export function GmailPassword({
  onConnected,
  onChecking,
  accountId,
  address: knownAddress,
  access,
}: {
  /** Told the account's id once Gmail took the password. */
  onConnected: (accountId?: string) => void;
  onChecking?: (checking: boolean) => void;
  /** Paste a new password for this account (a refused one), rather than add one. */
  accountId?: string;
  address?: string;
  /** What Gmail may do with a new account: read only, or read and write. */
  access?: GoogleLevel;
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
  const at = (knownAddress && accountId) || (next && validAddress) ? 1 : 0;
  const level = access === 'write' || access === 'read' ? access : undefined;

  const run = async (task: () => Promise<{ accounts: { id: string; email: string }[] }>) => {
    setStatus('checking');
    onChecking?.(true);
    setError(undefined);
    try {
      let found: string | undefined;
      const accepted = await guard(async () => {
        const result = await task();
        const wanted = (shared && !validAddress ? shared : address).trim().toLowerCase();
        found = result.accounts.find((a) => a.email.toLowerCase() === wanted)?.id;
      });
      if (!accepted) {
        setStatus('idle');
        return;
      }
      setStatus('ok');
      onConnected(found ?? accountId);
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
        ...(level && !accountId && { access: level }),
      }),
    );
  });

  return (
    <Stack gap={4}>
      {dialog}
      {shared && (
        <Callout
          tone="info"
          title="Use the same app password?"
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
          Your email channel already signs in as {shared}.
        </Callout>
      )}
      <GuideSteps label="Connect Gmail with an app password">
        <GuideSteps.Step
          number={1}
          title="Your Gmail address"
          state={stepState(0, at)}
          summary={validAddress ? address.trim() : undefined}
          onEdit={knownAddress && accountId ? undefined : () => setNext(false)}
        >
          <form
            className={styles.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (validAddress) setNext(true);
            }}
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
                placeholder="you@gmail.com"
                autoComplete="email"
              />
            </Field>
            <Button type="submit" variant="solid" className={styles.fit} disabled={!validAddress}>
              Next
            </Button>
          </form>
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
              description={
                accountId
                  ? 'Conch keeps it locked on this computer and never shows it again. What Gmail may do stays as you set it.'
                  : level === 'write'
                    ? 'Conch keeps it locked on this computer and never shows it again. It can read, save drafts and send — asking you before every email.'
                    : 'Conch keeps it locked on this computer and never shows it again. It can read and search; you can let it write later.'
              }
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
