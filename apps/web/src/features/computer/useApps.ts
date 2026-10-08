import { ComputerUseNow, ComputerUseStatus, type ComputerUseAccessKind } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError, request } from '../../api/client';

/** Using your computer's apps (ADR 0110): the switch, the macOS switches, Stop. */
export const computerUseApi = {
  status: () => request(ComputerUseStatus, '/api/computer-use'),
  now: () => request(ComputerUseNow, '/api/computer-use/live'),
  /** Turning it on grants reach: from elsewhere it needs a recent sign-in. */
  setEnabled: (enabled: boolean) =>
    request(ComputerUseStatus, '/api/computer-use', { method: 'PATCH', body: { enabled } }),
  forget: (id: string) =>
    request(ComputerUseStatus, `/api/computer-use/apps/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  openAccess: (kind: ComputerUseAccessKind) =>
    request(ComputerUseStatus, '/api/computer-use/access', { method: 'POST', body: { kind } }),
  stop: () =>
    request(z.object({ stopped: z.boolean() }), '/api/computer-use/stop', {
      method: 'POST',
      body: {},
    }),
};

/** The latest look at the screen, while its turn lasts. */
export const shotAddress = (shot: string | undefined) =>
  shot ? `/api/computer-use/shot/${encodeURIComponent(shot)}` : undefined;

export const computerUseKeys = {
  status: ['computer-use'] as const,
  now: ['computer-use', 'now'] as const,
};

/**
 * The settings, the switches and what's running. While it's on and a macOS
 * switch is still off, it looks again every couple of seconds (and when the
 * window comes back to the front), so the row turns on by itself the moment
 * the person flips the switch.
 */
export function useComputerUse() {
  return useQuery({
    queryKey: computerUseKeys.status,
    queryFn: computerUseApi.status,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const status = query.state.data;
      if (!status?.enabled || status.platform !== 'mac') return false;
      return status.access.screen !== 'granted' || status.access.control !== 'granted'
        ? 2000
        : false;
    },
  });
}

/** What this chat is doing on the computer, asked only while its turn runs. */
export function useComputerUseNow(running: boolean) {
  return useQuery({
    queryKey: computerUseKeys.now,
    queryFn: computerUseApi.now,
    enabled: running,
    refetchInterval: running ? 1200 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export function useComputerUseChange<T>(
  run: (arg: T) => Promise<ComputerUseStatus>,
  failed: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (status) => client.setQueryData(computerUseKeys.status, status),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'verify-required') return;
      toast.error(failed, { description: error instanceof Error ? error.message : undefined });
    },
  });
}
