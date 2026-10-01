import { RestartScreen } from '@conch/nacre';
import { useEffect, useState } from 'react';

import { useUi, type SettingsTab } from '../../app/ui';
import { bootId } from './restart';

/** Taking longer than this, the screen says what to do. */
const SLOW_MS = 60_000;
/** The settings tab to show again once the page is back (sessionStorage). */
const REOPEN = 'conch.reopenAfterRestart';

/**
 * While Conch starts itself again: a calm screen, and a quiet look every
 * moment for the new gateway. When it answers with a new boot id, the page
 * reloads — onto the new version, after an update.
 */
export function RestartWatch() {
  const restarting = useUi((s) => s.restarting);
  const [slow, setSlow] = useState(false);

  // Back from a restart: where you were (Settings → Health, after an update).
  useEffect(() => {
    let tab: string | null = null;
    try {
      tab = sessionStorage.getItem(REOPEN);
      sessionStorage.removeItem(REOPEN);
    } catch {
      // Private windows: the page simply comes back where it starts.
    }
    if (tab) useUi.getState().openSettings(tab as SettingsTab);
  }, []);

  useEffect(() => {
    if (!restarting) return;
    let done = false;
    const started = Date.now();
    const look = async () => {
      if (done) return;
      const now = await bootId();
      if (done) return;
      if (now && now !== restarting.from) {
        done = true;
        try {
          if (restarting.reopen) sessionStorage.setItem(REOPEN, restarting.reopen);
        } catch {
          // Not remembered; nothing else changes.
        }
        window.location.reload();
        return;
      }
      if (Date.now() - started > SLOW_MS) setSlow(true);
      // Quit on purpose, it may be hours: look calmly rather than every moment.
      setTimeout(
        () => void look(),
        restarting.stopped && Date.now() - started > SLOW_MS ? 5_000 : 700,
      );
    };
    const first = setTimeout(() => void look(), 900);
    return () => {
      done = true;
      clearTimeout(first);
    };
  }, [restarting]);

  if (!restarting) return null;
  return (
    <RestartScreen
      title={restarting.title}
      state={restarting.stopped ? 'stopped' : 'waiting'}
      detail={
        restarting.stopped
          ? 'Open Conch from your apps, or run pnpm start, and this page comes back by itself.'
          : 'This takes a few seconds. Your chats are safe.'
      }
      slow={
        slow && !restarting.stopped
          ? 'This is taking longer than usual. If Conch doesn’t come back, run pnpm start in its folder.'
          : undefined
      }
    />
  );
}
