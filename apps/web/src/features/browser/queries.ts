import type { BrowserStatus, UpdateBrowserSettingsBody } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { browserApi } from './api';

export const browserKeys = { status: ['browser'] as const };

/** The browser's state. Kept fresh by `browser.status` events on the live socket. */
export function useBrowserStatus() {
  return useQuery({ queryKey: browserKeys.status, queryFn: browserApi.status, staleTime: 60_000 });
}

function useBrowserMutation<T>(run: (arg: T) => Promise<BrowserStatus>, failed: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (status) => client.setQueryData(browserKeys.status, status),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'verify-required') return;
      toast.error(failed, { description: error instanceof Error ? error.message : undefined });
    },
  });
}

export function useUpdateBrowserSettings() {
  return useBrowserMutation(
    (body: UpdateBrowserSettingsBody) => browserApi.updateSettings(body),
    'Couldn’t save that',
  );
}

export function useRevokeSite() {
  return useBrowserMutation(
    (site: string) => browserApi.revokeSite(site),
    'Couldn’t remove that site',
  );
}

export function useRepairBrowser() {
  return useBrowserMutation(() => browserApi.repair(), 'Repair didn’t finish');
}

export function useWipeBrowser() {
  return useBrowserMutation(() => browserApi.wipe(), 'Couldn’t sign out of the browser');
}
