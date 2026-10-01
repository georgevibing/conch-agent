import { useEffect } from 'react';

import { pushApi } from './api';
import { current, matches, permission, pushSupport, subscribe } from './browser';

/**
 * Keeps this device's notifications working without anyone noticing
 * (AGENTS.md agreement 11): when the browser has said yes but Conch has lost
 * the subscription — a restored backup made a new key, the push service gave
 * the browser a new address, the file was damaged — it subscribes again,
 * quietly, once per page load. It never asks for permission by itself.
 */
export function PushKeeper() {
  useEffect(() => {
    if (pushSupport() !== 'ok' || permission() !== 'granted') return;
    let done = false;
    void (async () => {
      try {
        const status = await pushApi.status();
        const sub = await current();
        const known = status.devices.some((d) => d.current);
        if (done) return;
        if (known && matches(sub, status.publicKey)) return;
        // Turned on here before (the browser still allows it): put it back as it was.
        if (sub || known) await pushApi.subscribe(await subscribe(status.publicKey));
      } catch {
        // Next time the page loads; nothing to say about it now.
      }
    })();
    return () => {
      done = true;
    };
  }, []);
  return null;
}
