import { RestartScreen } from '@conch/nacre';
import { useEffect, useState } from 'react';

import { useUi } from '../../app/ui';
import { bootId } from './restart';

/** Taking longer than this, the screen says what to do. */
const SLOW_MS = 60_000;

/**
 * While Conch starts itself again: a calm screen, and a quiet look every
 * moment for the new gateway. When it answers with a new boot id, the page
 * reloads — onto the new version, after an update.
 */
export function RestartWatch() {
  const restarting = useUi((s) => s.restarting);
  const [slow, setSlow] = useState(false);

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
        window.location.reload();
        return;
      }
      if (Date.now() - started > SLOW_MS) setSlow(true);
      setTimeout(() => void look(), 700);
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
      detail="This takes a few seconds. Your chats are safe."
      slow={
        slow
          ? 'This is taking longer than usual. If Conch doesn’t come back, run pnpm start in its folder.'
          : undefined
      }
    />
  );
}
