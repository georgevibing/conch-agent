import type {
  AddServerBody,
  EngineId,
  Provider,
  ProvidersList,
  UpdateServerBody,
} from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { keys as appKeys, refreshCapabilities, setEngineStatus } from '../../api/queries';
import { providersApi } from './api';

export const providerKeys = {
  list: ['providers'] as const,
  one: (id: string) => ['provider', id] as const,
};

/**
 * Changing the default provider changes the engine status, the model list and the limits.
 * Rather than guess, put the fresh status where it's displayed and let the rest
 * be read again.
 */
function applyList(client: QueryClient, list: ProvidersList) {
  client.setQueryData(providerKeys.list, list);
  const active = list.providers.find((provider) => provider.active);
  if (active) setEngineStatus(client, active.status);
  void refreshCapabilities(client);
  void client.invalidateQueries({ queryKey: appKeys.usage });
}

export function putProvider(client: QueryClient, provider: Provider) {
  client.setQueryData<ProvidersList>(providerKeys.list, (prev) =>
    prev
      ? { ...prev, providers: prev.providers.map((p) => (p.id === provider.id ? provider : p)) }
      : prev,
  );
  if (provider.active) setEngineStatus(client, provider.status);
}

/** Every provider and its live state. */
export function useProviders(enabled = true) {
  return useQuery({
    queryKey: providerKeys.list,
    queryFn: () => providersApi.list(),
    staleTime: 15_000,
    enabled,
  });
}

/**
 * Watch one provider while you're setting it up: a real check every few
 * seconds, so a program installed in a terminal — or a sign-in finished in
 * another window — is noticed without a reload. Only the provider in front of
 * you is checked; asking every provider this often would mean starting several
 * programs a second.
 */
export function useWatchProvider(id: string | undefined, enabled: boolean) {
  const client = useQueryClient();
  return useQuery({
    queryKey: providerKeys.one(id ?? ''),
    queryFn: async () => {
      const provider = await providersApi.check(id ?? '');
      putProvider(client, provider);
      return provider;
    },
    enabled: Boolean(id) && enabled,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    gcTime: 0,
    retry: false,
  });
}

export function useUseProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: EngineId) => providersApi.use(id),
    onSuccess: (list) => applyList(client, list),
    onError: (error) => toast.error(errorText(error, 'Couldn’t change the default provider.')),
  });
}

export function useSetProviderKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: EngineId; value: string }) => providersApi.setKey(id, value),
    onSuccess: (list) => applyList(client, list),
  });
}

export function useClearProviderKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: EngineId) => providersApi.clearKey(id),
    onSuccess: (list) => applyList(client, list),
    onError: (error) => toast.error(errorText(error, 'Couldn’t remove the key.')),
  });
}

export function useAddServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: AddServerBody) => providersApi.addServer(body),
    onSuccess: ({ list }) => applyList(client, list),
  });
}

export function useUpdateServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateServerBody }) =>
      providersApi.updateServer(id, body),
    onSuccess: (list) => applyList(client, list),
  });
}

export function useRemoveServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => providersApi.removeServer(id),
    onSuccess: (list) => applyList(client, list),
    onError: (error) => toast.error(errorText(error, 'Couldn’t remove that server.')),
  });
}

/** Use a key or a server found on this computer. */
export function useFound() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => providersApi.useFound(id),
    onSuccess: (list) => applyList(client, list),
    onError: (error) => toast.error(errorText(error, 'That didn’t work.')),
  });
}

export function useCheckProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: EngineId) => providersApi.check(id),
    onSuccess: (provider) => putProvider(client, provider),
    onError: (error) => toast.error(errorText(error, 'Couldn’t check that provider.')),
  });
}

export function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
