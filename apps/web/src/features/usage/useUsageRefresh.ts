import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { keys } from '../../api/queries';

/**
 * Ask the gateway to re-read a provider now (every provider when none is
 * named); `refreshing` drives the spinner.
 */
export function useUsageRefresh(engine?: string) {
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: engine ? keys.usageOf(engine) : keys.usage });
    } finally {
      setRefreshing(false);
    }
  }, [client, engine]);
  return { refresh, refreshing };
}
