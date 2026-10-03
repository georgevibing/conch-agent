import type { ConchApp, PublishState } from '@conch/protocol';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { integrationKeys } from '../integrations/queries';
import { updateKeys } from '../updates/api';
import { conchAppsApi } from './api';

export const conchAppKeys = {
  all: ['conch-apps'] as const,
  detail: (id: string) => ['conch-apps', 'one', id] as const,
  community: (q: string) => ['conch-apps', 'community', q] as const,
  publish: (id: string) => ['conch-apps', 'publish', id] as const,
};

/** Every app you made or added. */
export function useConchApps() {
  return useQuery({ queryKey: conchAppKeys.all, queryFn: conchAppsApi.list, staleTime: 30_000 });
}

/** One app, by its own id (`tally`, not `capp_tally`). Opening it from the list is instant. */
export function useConchApp(id: string | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: conchAppKeys.detail(id ?? ''),
    queryFn: () => conchAppsApi.get(id ?? ''),
    enabled: Boolean(id),
    initialData: () => client.getQueryData<ConchApp[]>(conchAppKeys.all)?.find((a) => a.id === id),
    staleTime: 10_000,
  });
}

/** A value once it has stopped changing for `ms`. */
export function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * **From the community**: repositories with the topic `conch-app`, searched
 * once typing pauses. `query` undefined: not asked for. The gateway caches
 * GitHub's answers and says when it's limited or offline, so this never
 * retries on its own.
 */
export function useCommunityApps(query: string | undefined) {
  const settled = useSettled(query?.trim().toLowerCase(), 350);
  return useQuery({
    queryKey: conchAppKeys.community(settled ?? ''),
    queryFn: ({ signal }) => conchAppsApi.community(settled ?? '', signal),
    enabled: settled !== undefined,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Still moving: GitHub's program installing, a sign-in waiting, or publishing. */
export const publishMoving = (state: PublishState | undefined) =>
  state?.state === 'needs-sign-in' || state?.state === 'publishing';

/**
 * Where publishing on GitHub stands, asked again every two seconds while it
 * moves (a sign-in that's waiting, a push), so the page carries on by itself.
 */
export function usePublishState(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: conchAppKeys.publish(id ?? ''),
    queryFn: () => conchAppsApi.publishState(id ?? ''),
    enabled: Boolean(id) && enabled,
    refetchInterval: (q) => (publishMoving(q.state.data) ? 2_000 : false),
    refetchOnWindowFocus: 'always',
  });
}

/** Put one app's new state everywhere it's shown. */
export function putConchApp(client: QueryClient, app: ConchApp) {
  client.setQueryData<ConchApp[]>(conchAppKeys.all, (list) =>
    list ? [...list.filter((a) => a.id !== app.id), app] : list,
  );
  client.setQueryData(conchAppKeys.detail(app.id), app);
}

/**
 * `conch-apps.changed` from the live socket: one added, updated, removed, or
 * an update found. Its card is an integration too, and an update shows in
 * Settings → Updates.
 */
export function applyConchAppsEvent(client: QueryClient) {
  void client.invalidateQueries({ queryKey: conchAppKeys.all });
  void client.invalidateQueries({ queryKey: integrationKeys.all });
  void client.invalidateQueries({ queryKey: updateKeys.status });
}
