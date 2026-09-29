import type { Integration, IntegrationsList, ServerEvent } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { useAppState } from '../../api/queries';
import { integrationsApi } from './api';

export const integrationKeys = {
  all: ['integrations'] as const,
  external: ['integrations', 'external'] as const,
};

export function useIntegrations() {
  return useQuery({
    queryKey: integrationKeys.all,
    queryFn: integrationsApi.list,
    staleTime: 30_000,
  });
}

/** What the engine loads by itself. Slow (it asks the engine), so fetched only where shown. */
export function useExternal(enabled = true) {
  return useQuery({
    queryKey: integrationKeys.external,
    queryFn: () => integrationsApi.external(),
    staleTime: 60_000,
    enabled,
  });
}

/** What the assistant is called (persona), for copy that must not assume a provider. */
export function useAssistantName(): string {
  return useAppState().data?.persona.name || 'Conch';
}

export function useIntegration(id: string | undefined) {
  const list = useIntegrations();
  return {
    ...list,
    integration: list.data?.integrations.find((i) => i.id === id),
    entry: (() => {
      const item = list.data?.integrations.find((i) => i.id === id);
      return item?.catalogId ? list.data?.catalog.find((c) => c.id === item.catalogId) : undefined;
    })(),
  };
}

export function putIntegration(client: QueryClient, integration: Integration) {
  client.setQueryData<IntegrationsList>(integrationKeys.all, (data) => {
    if (!data) return data;
    const exists = data.integrations.some((i) => i.id === integration.id);
    return {
      ...data,
      integrations: exists
        ? data.integrations.map((i) => (i.id === integration.id ? integration : i))
        : [...data.integrations, integration],
    };
  });
}

function dropIntegration(client: QueryClient, id: string) {
  client.setQueryData<IntegrationsList>(integrationKeys.all, (data) =>
    data ? { ...data, integrations: data.integrations.filter((i) => i.id !== id) } : data,
  );
}

/** Integration events from the live socket keep every open view current. */
export function applyIntegrationEvent(
  client: QueryClient,
  event: Extract<ServerEvent, { type: `integration.${string}` }>,
) {
  if (event.type === 'integration.changed') {
    const before = client
      .getQueryData<IntegrationsList>(integrationKeys.all)
      ?.integrations.find((i) => i.id === event.integration.id);
    putIntegration(client, event.integration);
    // A new list we haven't loaded yet: fetch it rather than show a partial one.
    if (!client.getQueryData(integrationKeys.all))
      void client.invalidateQueries({ queryKey: integrationKeys.all });
    return { before, after: event.integration };
  }
  dropIntegration(client, event.integrationId);
  return undefined;
}

export const errorText = (error: unknown, fallback = 'Something went wrong.') =>
  error instanceof ApiError ? error.message : fallback;

export function useUpdateIntegration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (arg: { id: string; patch: Parameters<typeof integrationsApi.update>[1] }) =>
      integrationsApi.update(arg.id, arg.patch),
    onSuccess: (integration) => putIntegration(client, integration),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'verify-required') return;
      toast.error(errorText(error));
    },
  });
}

export function useCheckIntegration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => integrationsApi.check(id),
    onSuccess: (integration) => putIntegration(client, integration),
    onError: (error) => toast.error(errorText(error)),
  });
}

export function useRemoveIntegration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (integration: Integration) => integrationsApi.remove(integration.id),
    onSuccess: (_r, integration) => {
      dropIntegration(client, integration.id);
      toast(`Disconnected ${integration.name}`);
    },
    onError: (error) => toast.error(errorText(error, 'Couldn’t disconnect it.')),
  });
}
