import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { pushApi, pushKeys } from './api';
import { current, matches, permission, pushSupport, subscribe } from './browser';

/**
 * Keeps this device's notifications working without anyone noticing
 * (AGENTS.md agreement 11): when the browser has said yes but Conch has lost
 * the subscription — a restored backup made a new key, the push service gave
 * the browser a new address, the file was damaged — it subscribes again,
 * quietly, once per page load. It never asks for permission by itself.
 *
 * What it learns stays in the cache, so Settings → Notifications opens with
 * the switch as it is, without asking again.
 */
export function PushKeeper() {
  const client = useQueryClient();
  useEffect(() => {
    if (pushSupport() !== 'ok' || permission() !== 'granted') return;
    let done = false;
    void (async () => {
      try {
        const status = await client.fetchQuery({
          queryKey: pushKeys.status,
          queryFn: pushApi.status,
          staleTime: 15_000,
        });
        const sub = await current();
        const known = status.devices.some((d) => d.current);
        if (done) return;
        const here = matches(sub, status.publicKey);
        client.setQueryData(pushKeys.here(status.publicKey), here);
        if (known && here) return;
        // Turned on here before (the browser still allows it): put it back as it was.
        if (sub || known) {
          client.setQueryData(
            pushKeys.status,
            await pushApi.subscribe(await subscribe(status.publicKey)),
          );
          client.setQueryData(pushKeys.here(status.publicKey), true);
        }
      } catch {
        // Next time the page loads; nothing to say about it now.
      }
    })();
    return () => {
      done = true;
    };
  }, [client]);
  return null;
}
