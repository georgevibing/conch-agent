import type { AppState, EngineStatus, UpdateSettingsBody } from '@conch/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';

export const keys = {
  state: ['state'] as const,
  engine: ['engine'] as const,
  conversations: ['conversations'] as const,
  memories: ['memories'] as const,
  capabilities: ['capabilities'] as const,
  commands: ['commands'] as const,
  usage: ['usage'] as const,
};

export function useAppState() {
  return useQuery({ queryKey: keys.state, queryFn: api.state, staleTime: 30_000 });
}

/** Put a fresh engine status everywhere it's displayed. */
export function setEngineStatus(client: ReturnType<typeof useQueryClient>, status: EngineStatus) {
  client.setQueryData(keys.engine, status);
  client.setQueryData<AppState>(keys.state, (prev) => (prev ? { ...prev, engine: status } : prev));
}

export function useEngine(
  options: { poll?: number | false | ((status: EngineStatus | undefined) => number | false) } = {},
) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.engine,
    queryFn: async () => {
      const status = await api.engine(true);
      client.setQueryData<AppState>(keys.state, (prev) =>
        prev ? { ...prev, engine: status } : prev,
      );
      return status;
    },
    refetchInterval: (query) =>
      typeof options.poll === 'function' ? options.poll(query.state.data) : (options.poll ?? false),
    refetchIntervalInBackground: false,
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsBody) => api.updateSettings(body),
    onSuccess: (state) => client.setQueryData(keys.state, state),
  });
}

export function useConversations() {
  return useQuery({ queryKey: keys.conversations, queryFn: api.conversations });
}

export function useMemories() {
  return useQuery({ queryKey: keys.memories, queryFn: api.memories });
}

/** Models, engine commands and modes. Cheap to keep around; refreshed when the engine changes. */
export function useCapabilities(enabled = true) {
  return useQuery({
    queryKey: keys.capabilities,
    queryFn: () => api.capabilities(),
    staleTime: 10 * 60_000,
    enabled,
  });
}

/**
 * How much usage is left. The gateway pushes every change over the socket
 * (`usage.changed`); refetching on focus re-reads the provider, because you
 * may have used your plan elsewhere (claude.ai, another machine) meanwhile.
 */
export function useUsage(enabled = true) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.usage,
    // The first read takes the gateway's cached answer; later ones ask the provider afresh.
    queryFn: () => api.usage(client.getQueryData(keys.usage) !== undefined),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useCommands() {
  return useQuery({ queryKey: keys.commands, queryFn: api.commands, staleTime: 60_000 });
}
