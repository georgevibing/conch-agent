import { DeviceApproval, Pearl } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ApiError, api } from '../../api/client';
import styles from './Auth.module.css';
import { HelloScreen } from './HelloScreen';
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
  // The link that makes a new Conch yours (ADR 0064) has its own page.
  const [hello, setHello] = useState(
    linkCredential?.with === 'hello' ? linkCredential.code : undefined,
  );
  const leaveHello = useCallback(() => setHello(undefined), []);
  const [pairing, setPairing] = useState(Boolean(linkCredential) && !hello);
  const [opening] = useState(linkCredential?.with === 'here');
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
    if (!credential || credential.with === 'hello') return;
    // From a launcher on this computer (ADR 0063): this browser becomes this computer.
    const done =
      credential.with === 'here'
        ? api.here(credential.code).then(async () => applySignedIn(client, await api.auth()))
        : api.signIn(credential).then((status) => applySignedIn(client, status));
    done
      .catch((error: unknown) =>
        setLinkError(
          error instanceof ApiError && error.status === 401
            ? credential.with === 'here'
              ? 'That link has expired or was already used. Open Conch from your apps again.'
              : 'That sign-in link has expired or was already used. Ask for a new one, or sign in below.'
            : (error as Error).message,
        ),
      )
      .finally(() => setPairing(false));
  }, [client]);

  if (hello) return <HelloScreen code={hello} onLeave={leaveHello} />;
  if (pairing || auth.isPending) {
    return (
      <div className={styles.center} aria-busy>
        <Pearl
          size="lg"
          state="thinking"
          label={pairing ? (opening ? 'Opening Conch' : 'Signing you in') : 'Starting Conch'}
        />
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
  if (approval)
    return (
      <WaitingForApproval
        approval={approval}
        passkeys={Boolean(auth.data.passkeys)}
        onLeave={() => setLeaving(true)}
      />
    );
  if (!auth.data.signedIn) {
    const notice = linkError ?? waitNotice;
    return <SignIn key={notice} status={auth.data} notice={notice} />;
  }
  return children;
}
