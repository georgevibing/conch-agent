import { ComputerStatus } from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';

import { request } from '../../api/client';

/** This computer (Settings → This computer): what it is, and the last few minutes of it. */
export const computerApi = {
  status: () => request(ComputerStatus, '/api/computer'),
};

export const computerKeys = { status: ['computer'] as const };

/**
 * Asked every sampling interval while the page is open and the window is in
 * front; that asking is what keeps Conch looking. Closed or hidden, nothing
 * asks, and Conch stops looking soon after.
 */
export function useComputer() {
  return useQuery({
    queryKey: computerKeys.status,
    queryFn: computerApi.status,
    refetchInterval: (query) => query.state.data?.intervalMs ?? 2000,
    refetchIntervalInBackground: false,
    // A reading is only true for a moment; never show an old one on return.
    gcTime: 0,
    staleTime: 0,
  });
}
