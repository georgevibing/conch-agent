import { Pearl } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { ApiError, api } from '../../api/client';
import styles from './Auth.module.css';
import { SignIn } from './SignIn';
import { applySignedIn } from './signedIn';
import { takeLinkCredential, useAuth } from './useAuth';

/**
 * Nothing that talks to the agent (queries, the live socket) mounts until
 * the gateway says this browser may use it.
 */
/** Taken from the address bar once, as early as possible. */
let linkCredential = typeof window === 'undefined' ? undefined : takeLinkCredential();

export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const auth = useAuth();
  const [linkError, setLinkError] = useState<string>();
  const [pairing, setPairing] = useState(Boolean(linkCredential));

  useEffect(() => {
    const credential = linkCredential;
    linkCredential = undefined;
    if (!credential) return;
    api
      .signIn(credential)
      .then((status) => applySignedIn(client, status))
      .catch((error: unknown) =>
        setLinkError(
          error instanceof ApiError && error.status === 401
            ? 'That sign-in link has expired or was already used. Ask for a new one, or sign in below.'
            : (error as Error).message,
        ),
      )
      .finally(() => setPairing(false));
  }, [client]);

  if (pairing || auth.isPending) {
    return (
      <div className={styles.center} aria-busy>
        <Pearl size="lg" state="thinking" label={pairing ? 'Signing you in' : 'Starting Conch'} />
      </div>
    );
  }
  // Can't reach the gateway at all: let the app show its "not running" screen.
  if (auth.isError) return children;
  if (!auth.data.signedIn) return <SignIn status={auth.data} notice={linkError} />;
  return children;
}
