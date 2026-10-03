import { DeviceApproval } from '@conch/nacre';
import type { WaitingApproval } from '@conch/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import styles from './Auth.module.css';
import { askPasskey, passkeyProblem } from './passkey';
import { applySignedIn } from './signedIn';
import { usePasskeyPlatform } from './usePasskeyPlatform';

/** How often a waiting device asks whether it was approved. */
const POLL_MS = 1500;

/**
 * Signed in with the right password or key, on a device Conch hasn't seen:
 * it waits here, showing its code, until it's approved from a device that's
 * already let in, or on the computer running Conch (ADR 0065), or turned
 * down, or the request runs out. A passkey here lets the person in at once.
 */
export function WaitingForApproval({
  approval,
  onLeave,
  passkeys = false,
}: {
  approval: WaitingApproval;
  /** A passkey made for this address could sign in here instead of waiting. */
  passkeys?: boolean;
  /** Leaving on purpose (Cancel, or after a "no"): nothing to explain afterwards. */
  onLeave: () => void;
}) {
  const client = useQueryClient();
  const waiting = approval.state === 'waiting';
  const { platform } = usePasskeyPlatform();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  /** A passkey is the device and the person at once: it lets this device in by itself. */
  const letInWithPasskey = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const response = await askPasskey('sign-in');
      await applySignedIn(client, await api.signIn({ with: 'passkey', response }));
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : passkeyProblem(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!waiting) return;
    const check = () => void client.invalidateQueries({ queryKey: keys.auth });
    const timer = setInterval(check, POLL_MS);
    // Coming back to the tab (the phone was in a pocket) checks at once.
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client, waiting]);

  const leave = async () => {
    onLeave();
    await api.signOut().catch(() => undefined);
    await client.invalidateQueries({ queryKey: keys.auth });
  };

  return (
    <main className={styles.root}>
      <div className={styles.glow} aria-hidden />
      <DeviceApproval
        state={approval.state}
        code={approval.code}
        device={approval.device}
        expiresAt={approval.expiresAt}
        onCancel={() => void leave()}
        onRetry={() => void leave()}
        command={`conch devices approve ${approval.code}`}
        fromDevices
        {...(passkeys &&
          platform && {
            passkey: { platform, onUse: () => void letInWithPasskey(), loading: busy },
          })}
        {...(problem && { footnote: problem })}
      />
    </main>
  );
}
