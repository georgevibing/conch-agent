import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { keys } from '../../api/queries';

/** Ask the gateway to re-read the provider now; `refreshing` drives the spinner. */
export function useUsageRefresh() {
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: keys.usage });
    } finally {
      setRefreshing(false);
    }
  }, [client]);
  return { refresh, refreshing };
}
