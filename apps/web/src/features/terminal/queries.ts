import { useQuery } from '@tanstack/react-query';

import { terminalApi } from './api';

export const terminalKeys = { status: ['terminal'] as const };

/** Terminals and their settings. `terminal.changed` on the live socket keeps it fresh. */
export function useTerminalStatus(enabled = true) {
  return useQuery({
    queryKey: terminalKeys.status,
    queryFn: terminalApi.status,
    staleTime: 30_000,
    enabled,
  });
}
