import type { Need, Readiness } from '@conch/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { needKeys, needsApi } from './api';

/**
 * One thing Conch can get for you, kept fresh while you look: every second
 * while it installs, and whenever you come back to the window.
 */
export function useNeed(id: string | undefined) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const query = useQuery({
    queryKey: needKeys.one(id ?? ''),
    queryFn: () => needsApi.get(id ?? ''),
    enabled: Boolean(id),
    refetchOnWindowFocus: 'always',
    refetchInterval: (q) =>
      q.state.data?.needs.some((n) => n.state === 'installing') ? 1000 : false,
  });
  const need: Need | undefined = query.data?.needs[0];
  const running = need?.state === 'installing';

  // Seen installing, now here: it just finished. Whatever was waiting on it
  // looks again now, so the next step follows straight on.
  const [sawRunning, setSawRunning] = useState(false);
  if (running && !sawRunning) setSawRunning(true);
  const justDone = sawRunning && need?.state === 'ready';
  useEffect(() => {
    if (justDone) void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'needs' });
  }, [justDone, client]);

  const act = async (action: 'install' | 'update' | 'open') => {
    if (!id) return false;
    setError(undefined);
    setStarting(true);
    try {
      return await guard(async () => {
        const next: Readiness = await needsApi.act(id, action);
        client.setQueryData(needKeys.one(id), next);
      });
    } catch (e) {
      setError(errorText(e, 'Couldn’t start it.'));
      return false;
    } finally {
      setStarting(false);
    }
  };

  return {
    need,
    running,
    /** It was installing while you watched, and now it's here. */
    justDone,
    starting,
    error: error ?? (need?.state === 'failed' ? need.message : undefined),
    act,
    dialog,
  };
}
