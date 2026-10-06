import type { AppState, EngineId, EngineStatus, UpdateSettingsBody } from '@conch/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';

export const keys = {
  state: ['state'] as const,
  engine: ['engine'] as const,
  conversations: ['conversations'] as const,
  /** The folders in the chat list (ADR 0089); kept fresh by `folders.changed`. */
  folders: ['folders'] as const,
  memories: ['memories'] as const,
  capabilities: ['capabilities'] as const,
  /** Under `capabilities`, so anything that refreshes one refreshes both. */
  models: ['capabilities', 'models'] as const,
  commands: ['commands'] as const,
  usage: ['usage'] as const,
  /** One provider's limits; every key starts with `usage`, so refreshing that refreshes all. */
  usageOf: (engine: string) => ['usage', engine] as const,
  auth: ['auth'] as const,
  access: ['access'] as const,
  /** Your own address (ADR 0064); kept fresh by the `address.changed` event. */
  address: ['address'] as const,
  healed: ['healed'] as const,
};

/** What Conch fixed on its own, newest first; kept fresh by the `healed` event. */
export function useHealed() {
  return useQuery({ queryKey: keys.healed, queryFn: api.healed, staleTime: 60_000 });
}

export function useAppState() {
  return useQuery({ queryKey: keys.state, queryFn: api.state, staleTime: 30_000 });
}

/**
 * The models and capabilities again, from the providers as they are now (a
 * server added, a provider signed in). The first catalog of a page can take
 * seconds, while every provider lists its models: an answer asked for before
 * the change describes the providers as they were, and React Query keeps that
 * first answer instead of asking again — so a server just added would be
 * missing from the model picker. Stopping it first means the answer that lands
 * is the one that knows about the change.
 */
export async function refreshCapabilities(client: ReturnType<typeof useQueryClient>) {
  await client.cancelQueries({ queryKey: keys.capabilities });
  await client.invalidateQueries({ queryKey: keys.capabilities });
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

/**
 * Change settings. Shown at once everywhere they're read (the folder chip,
 * the default model's tick, a switch), put back if the gateway says no;
 * whoever changes them says why it failed.
 */
export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsBody) => api.updateSettings(body),
    onMutate: async (body) => {
      await client.cancelQueries({ queryKey: keys.state });
      const before = client.getQueryData<AppState>(keys.state);
      if (before) client.setQueryData(keys.state, withSettings(before, body));
      return { before };
    },
    onError: (_error, _body, context) => {
      if (context?.before) client.setQueryData(keys.state, context.before);
    },
    onSuccess: (state) => client.setQueryData(keys.state, state),
  });
}

/** The app's state as it will be once `body` is saved (`null` goes back to the default). */
export function withSettings(state: AppState, body: UpdateSettingsBody): AppState {
  const merge = <T extends object>(now: T, changes: object | undefined): T => {
    if (!changes) return now;
    const given = Object.entries(changes).filter(([, value]) => value !== undefined);
    const cleared = new Set(given.filter(([, value]) => value === null).map(([key]) => key));
    return Object.fromEntries([
      ...Object.entries(now).filter(([key]) => !cleared.has(key)),
      ...given.filter(([key]) => !cleared.has(key)),
    ]) as T;
  };
  return {
    ...state,
    ...(body.onboarded !== undefined && { onboarded: body.onboarded }),
    persona: merge(state.persona, body.persona),
    profile: merge(state.profile, body.profile),
    preferences: merge(state.preferences, body.preferences),
    ...(body.preferences?.workspace && { workspace: body.preferences.workspace }),
  };
}

export function useConversations() {
  return useQuery({ queryKey: keys.conversations, queryFn: api.conversations });
}

/** The folders in the chat list, in their order (ADR 0089). */
export function useFolders() {
  return useQuery({ queryKey: keys.folders, queryFn: api.folders, staleTime: 60_000 });
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
 * How much of a provider's limit is left: the one answering the chat you're
 * in. The gateway pushes every change over the socket (`usage.changed`, naming
 * its provider); refetching on focus re-reads the provider, because you may
 * have used your plan elsewhere (claude.ai, another machine) meanwhile.
 */
export function useUsage(engine: EngineId | undefined, enabled = true) {
  const client = useQueryClient();
  const key = keys.usageOf(engine ?? '');
  return useQuery({
    queryKey: key,
    // The first read takes the gateway's cached answer; later ones ask the provider afresh.
    queryFn: () => api.usage(client.getQueryData(key) !== undefined, engine),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    enabled: enabled && Boolean(engine),
  });
}

/**
 * Every connected provider's models, for the picker (ADR 0012). Kept a while:
 * the gateway caches the lists too, and connecting or switching refreshes it.
 */
export function useModels(enabled = true) {
  return useQuery({
    queryKey: keys.models,
    queryFn: () => api.models(),
    staleTime: 10 * 60_000,
    enabled,
  });
}

export function useCommands() {
  return useQuery({ queryKey: keys.commands, queryFn: api.commands, staleTime: 60_000 });
}
