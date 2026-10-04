import { checkPassword, suggestPassword, type HelloCheck } from '@conch/protocol';
import { MakeItYours, Pearl, type MakeItYoursState } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, api } from '../../api/client';
import styles from './Auth.module.css';
import { createPasskey, passkeyProblem } from './passkey';
import { applySignedIn } from './signedIn';
import { usePasskeyPlatform } from './usePasskeyPlatform';

/** How long the "it's yours" moment stays before the app opens by itself. */
const DONE_MS = 2200;

/**
 * The page the hello link opens (ADR 0064): a new Conch, made the person's
 * own with this device's passkey or a password. Whoever opens the link first
 * owns Conch, so the code is checked again when it's used.
 *
 * `onLeave` goes on into the app (signed in, or to the sign-in page when the
 * link is spent and the person set Conch up already).
 */
export function HelloScreen({ code, onLeave }: { code: string; onLeave: () => void }) {
  const client = useQueryClient();
  const { platform, support } = usePasskeyPlatform();
  const [check, setCheck] = useState<HelloCheck>();
  const [state, setState] = useState<MakeItYoursState>('ready');
  const [error, setError] = useState<string>();
  const [signedIn, setSignedIn] = useState<Awaited<ReturnType<typeof api.finishHello>>>();
  const left = useRef(false);
  /** Into the app, once: the button and the timer may both get there. */
  const enter = useCallback(
    (status: NonNullable<typeof signedIn>) => {
      if (left.current) return;
      left.current = true;
      void applySignedIn(client, status).then(onLeave);
    },
    [client, onLeave],
  );

  useEffect(() => {
    let live = true;
    api
      .checkHello(code)
      .then(async (found) => {
        if (!live) return;
        // Spent, but this browser is already signed in (opened the link twice): go on in.
        if (!found.ok && (await api.auth().catch(() => undefined))?.signedIn) return onLeave();
        setCheck(found);
        if (!found.ok) setState('expired');
      })
      .catch((e: unknown) => {
        if (!live) return;
        setCheck({
          ok: false,
          reason: 'expired',
          address: location.host,
          suggestedUsername: '',
          passkeys: false,
        });
        setState(e instanceof ApiError && e.status === 410 ? 'expired' : 'error');
        setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [code, onLeave]);

  // The moment it's done, then the app.
  useEffect(() => {
    if (state !== 'done' || !signedIn) return;
    const timer = setTimeout(() => enter(signedIn), DONE_MS);
    return () => clearTimeout(timer);
  }, [state, signedIn, enter]);

  const finish = async (run: () => Promise<Awaited<ReturnType<typeof api.finishHello>>>) => {
    setState('working');
    setError(undefined);
    try {
      setSignedIn(await run());
      setState('done');
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) return setState('expired');
      const problem = e instanceof ApiError ? e.message : passkeyProblem(e);
      // Closing the browser's own prompt is no error: back where they were.
      if (!problem) return setState('ready');
      setError(problem);
      setState('error');
    }
  };

  if (!check || !support) {
    return (
      <div className={styles.center} aria-busy>
        <Pearl size="lg" state="thinking" label="Opening your link" />
      </div>
    );
  }

  return (
    <MakeItYours
      state={state}
      address={check.address}
      platform={check.passkeys ? platform : undefined}
      username={check.suggestedUsername}
      error={error}
      command="conch hello"
      checkPassword={(password, username) => checkPassword(password, { username })}
      suggestPassword={suggestPassword}
      onPasskey={() =>
        void finish(async () =>
          api.finishHello({
            with: 'passkey',
            code,
            response: await createPasskey({ purpose: 'hello', code }),
          }),
        )
      }
      onPassword={(username, password) =>
        void finish(() => api.finishHello({ with: 'password', code, username, password }))
      }
      onContinue={() => {
        if (signedIn) enter(signedIn);
      }}
      onSignIn={onLeave}
    />
  );
}
