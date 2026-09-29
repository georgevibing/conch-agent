import type { AppState, EngineStatus, UpdateSettingsBody } from '@conch/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';

export const keys = {
  state: ['state'] as const,
  engine: ['engine'] as const,
  conversations: ['conversations'] as const,
  memories: ['memories'] as const,
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
