import { useEffect } from 'react';

import { useUi } from '../../app/ui';

/** `?open=…` from a notification: the place in Conch it's about. */
const PLACES = {
  devices: ['security', 'devices'],
  notifications: ['notifications', undefined],
  background: ['health', 'background'],
  updates: ['health', 'updates'],
} as const;

/**
 * A notification's link opens the right place (`/?open=devices` for a new
 * device asking to sign in): Settings takes the link's place in the history,
 * over the page without `?open`.
 */
export function OpenFromLink() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const open = url.searchParams.get('open');
    if (!open || !(open in PLACES)) return;
    const [tab, focus] = PLACES[open as keyof typeof PLACES];
    url.searchParams.delete('open');
    useUi.getState().openSettings(tab, focus, {
      replace: true,
      from: url.pathname + url.search + url.hash,
    });
  }, []);
  return null;
}
