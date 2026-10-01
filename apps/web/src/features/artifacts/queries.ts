import type { Artifact, ServerEvent } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { artifactsApi } from './api';

export const artifactKeys = {
  all: ['artifacts'] as const,
  detail: (id: string) => ['artifacts', id] as const,
  version: (id: string, n: number) => ['artifacts', id, 'v', n] as const,
};

export function useArtifacts() {
  return useQuery({ queryKey: artifactKeys.all, queryFn: artifactsApi.list, staleTime: 60_000 });
}

/** What's pinned, as apps, in the order they were pinned. */
export function usePinnedApps() {
  const { data } = useArtifacts();
  return (data ?? [])
    .filter((a) => a.pinned)
    .sort((a, b) => (a.pinned?.at ?? 0) - (b.pinned?.at ?? 0));
}

export function useArtifact(id: string | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: artifactKeys.detail(id ?? ''),
    queryFn: () => artifactsApi.get(id ?? ''),
    enabled: Boolean(id),
    // Opening one from the list is instant.
    initialData: () => client.getQueryData<Artifact[]>(artifactKeys.all)?.find((a) => a.id === id),
    staleTime: 10_000,
  });
}

/** A version's text. Versions never change, so it's kept as long as it's wanted. */
export function useArtifactVersion(id: string | undefined, n: number | undefined) {
  return useQuery({
    queryKey: artifactKeys.version(id ?? '', n ?? 0),
    queryFn: async () => (await artifactsApi.version(id ?? '', n ?? 0)).content,
    enabled: Boolean(id && n),
    staleTime: Infinity,
  });
}

function put(client: QueryClient, artifact: Artifact) {
  client.setQueryData<Artifact[]>(artifactKeys.all, (list) =>
    list
      ? [artifact, ...list.filter((a) => a.id !== artifact.id)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        )
      : list,
  );
  client.setQueryData(artifactKeys.detail(artifact.id), artifact);
}

/** Live changes from the socket: a new version, a pin, a refresh starting or ending. */
export function applyArtifactEvent(
  client: QueryClient,
  event: Extract<ServerEvent, { type: 'artifact.changed' | 'artifact.deleted' }>,
) {
  if (event.type === 'artifact.changed') {
    if (!client.getQueryData(artifactKeys.all))
      void client.invalidateQueries({ queryKey: artifactKeys.all });
    return put(client, event.artifact);
  }
  client.setQueryData<Artifact[]>(artifactKeys.all, (list) =>
    list?.filter((a) => a.id !== event.artifactId),
  );
  client.removeQueries({ queryKey: artifactKeys.detail(event.artifactId) });
}

export function useUpdateArtifact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; pinned?: boolean }) =>
      artifactsApi.update(id, body),
    onSuccess: (artifact, vars) => {
      put(client, artifact);
      if (vars.pinned === true)
        toast(`“${artifact.title}” is in your sidebar`, {
          description: 'It opens in one press, from anywhere.',
        });
    },
    onError: (error) => toast.error('That didn’t save', { description: error.message }),
  });
}

export function useDeleteArtifact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => artifactsApi.remove(id),
    onSuccess: (_r, id) => applyArtifactEvent(client, { type: 'artifact.deleted', artifactId: id }),
    onError: (error) => toast.error('That didn’t delete', { description: error.message }),
  });
}

export function useRefreshArtifact() {
  return useMutation({
    mutationFn: (id: string) => artifactsApi.refresh(id),
    onError: (error) => toast.error('It couldn’t refresh', { description: error.message }),
  });
}
