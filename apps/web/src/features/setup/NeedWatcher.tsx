import { toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useUi } from '../../app/ui';
import { needKeys, needsApi } from './api';

/** Long enough for a package install; a person who walked away isn't watched forever. */
const WATCH_MS = 20 * 60_000;
const EVERY_MS = 3_000;

/**
 * Watches for something a person is setting up outside Conch (a command typed
 * into the terminal for them) and says when it lands, wherever they are by
 * then. Everything that was waiting on it looks again.
 */
export function NeedWatcher() {
  const id = useUi((s) => s.watchingNeed);
  const watchNeed = useUi((s) => s.watchNeed);
  const client = useQueryClient();
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    const until = Date.now() + WATCH_MS;
    const look = async () => {
      if (stopped) return;
      const readiness = await needsApi.get(id).catch(() => undefined);
      if (stopped) return;
      const need = readiness?.needs[0];
      if (readiness) client.setQueryData(needKeys.one(id), readiness);
      if (need?.state === 'ready') {
        toast.success(`${need.short}: done`, {
          description:
            id === 'command-sandbox'
              ? 'The assistant’s commands are sealed from now on.'
              : `${need.name} is ready.`,
        });
        void client.invalidateQueries();
        watchNeed(null);
        return;
      }
      if (Date.now() > until) {
        watchNeed(null);
        return;
      }
      timer = setTimeout(() => void look(), EVERY_MS);
    };
    let timer = setTimeout(() => void look(), EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, watchNeed, client]);
  return null;
}
