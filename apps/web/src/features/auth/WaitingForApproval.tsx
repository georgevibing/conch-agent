import { DeviceApproval } from '@conch/nacre';
import type { WaitingApproval } from '@conch/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import styles from './Auth.module.css';

/** How often a waiting device asks whether it was approved. */
const POLL_MS = 1500;

/**
 * Signed in with the right password or key, on a device Conch hasn't seen:
 * it waits here, showing its code, until it's approved on the computer
 * running Conch (or turned down, or the request runs out).
 */
export function WaitingForApproval({
  approval,
  onLeave,
}: {
  approval: WaitingApproval;
  /** Leaving on purpose (Cancel, or after a "no"): nothing to explain afterwards. */
  onLeave: () => void;
}) {
  const client = useQueryClient();
  const waiting = approval.state === 'waiting';

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
        footnote="Or open Conch on that computer, and approve it in Settings → Security."
      />
    </main>
  );
}
