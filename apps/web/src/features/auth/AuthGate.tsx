import { DeviceApproval, Pearl } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { ApiError, api } from '../../api/client';
import styles from './Auth.module.css';
import { SignIn } from './SignIn';
import { WaitingForApproval } from './WaitingForApproval';
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
  // Whether this device was waiting for approval, so what comes next can say what happened.
  const approval = auth.data?.approval;
  const [waiting, setWaiting] = useState(false);
  const [justApproved, setJustApproved] = useState(false);
  const [waitNotice, setWaitNotice] = useState<string>();
  /** Left the wait on purpose (Cancel, or after a "no"): nothing to explain. */
  const [leaving, setLeaving] = useState(false);
  if (approval && !waiting) {
    setWaiting(true);
    setLeaving(false);
    setWaitNotice(undefined);
  } else if (!approval && waiting && auth.data) {
    setWaiting(false);
    setLeaving(false);
    // Approved where it waited: a moment to say so, then the app.
    if (auth.data.signedIn) setJustApproved(true);
    else if (!leaving)
      setWaitNotice('Nobody approved this device in time. Sign in again to ask once more.');
  }
  useEffect(() => {
    if (!justApproved) return;
    const timer = setTimeout(() => setJustApproved(false), 1100);
    return () => clearTimeout(timer);
  }, [justApproved]);

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
  if (justApproved) {
    return (
      <main className={styles.root}>
        <div className={styles.glow} aria-hidden />
        <DeviceApproval state="approved" code="" device="" role="status" />
      </main>
    );
  }
  // Can't reach the gateway at all: let the app show its "not running" screen.
  if (auth.isError) return children;
  if (approval) return <WaitingForApproval approval={approval} onLeave={() => setLeaving(true)} />;
  if (!auth.data.signedIn) {
    const notice = linkError ?? waitNotice;
    return <SignIn key={notice} status={auth.data} notice={notice} />;
  }
  return children;
}
