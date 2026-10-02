import type {
  Artifact,
  ArtifactVersionRef,
  LiveDataInfo,
  LiveDataRequest,
  LiveDataResult,
} from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { artifactsApi } from './api';

export const liveKeys = {
  approvals: ['live-data'] as const,
  info: (id: string, version: ArtifactVersionRef) => ['artifacts', id, 'live', version] as const,
};

/** Every site a page may read from, which you allowed (Settings → Security). */
export function useLiveApprovals() {
  return useQuery({ queryKey: liveKeys.approvals, queryFn: artifactsApi.approvals });
}

export function useRevokeLive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ artifactId, host }: { artifactId: string; host: string }) =>
      artifactsApi.revoke(artifactId, host),
    onSuccess: (_r, { artifactId, host }) => {
      void client.invalidateQueries({ queryKey: liveKeys.approvals });
      void client.invalidateQueries({ queryKey: ['artifacts', artifactId, 'live'] });
      toast(`Stopped reading from ${host}`, {
        description: 'The page asks again the next time it wants to.',
      });
    },
    onError: (error) => toast.error('That didn’t change', { description: error.message }),
  });
}

interface LiveStatus {
  /** When the last read that worked was made. */
  updatedAt?: number;
  /** The last read didn't work: why, in a sentence. */
  failed?: string;
  reading: boolean;
}

const failure = (message: string): LiveDataResult => ({ ok: false, reason: 'failed', message });

/**
 * A page's live data (ADR 0039): what it reads from and what you've said
 * about each site, answering the page's requests (through the gateway),
 * reading again on the page's schedule while it's on screen, and the one
 * question for a site you haven't allowed yet.
 */
export function useLiveData(artifact: Artifact, version: ArtifactVersionRef) {
  const client = useQueryClient();
  const key = liveKeys.info(artifact.id, version);
  const info = useQuery({
    queryKey: key,
    queryFn: () => artifactsApi.liveInfo(artifact.id, version),
    enabled: artifact.kind === 'html',
    staleTime: 30_000,
  });
  const [status, setStatus] = useState<LiveStatus>({ reading: false });
  const [refresh, setRefresh] = useState(0);
  const [reload, setReload] = useState(0);
  const [declined, setDeclined] = useState<ReadonlySet<string>>(() => new Set());

  const sources = info.data?.sources ?? [];
  const allowed = sources.filter((s) => s.allowed);
  const waiting = sources.filter((s) => !s.allowed && !declined.has(s.host));
  const ask = waiting[0];
  const every = Math.min(...allowed.map((s) => s.every ?? Infinity));

  // Again on the page's own schedule, only while someone's looking.
  useEffect(() => {
    if (!Number.isFinite(every)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh((n) => n + 1);
    }, every * 1000);
    return () => clearInterval(timer);
  }, [every]);

  const onData = useCallback(
    async (request: LiveDataRequest): Promise<LiveDataResult> => {
      setStatus((s) => ({ ...s, reading: true }));
      let result: LiveDataResult;
      try {
        result = await artifactsApi.liveRead(artifact.id, version, request);
      } catch {
        result = failure('Conch couldn’t ask for it just now.');
      }
      if (result.ok && result.status < 400) setStatus({ updatedAt: result.at, reading: false });
      else if (!result.ok && result.reason === 'needs-approval') {
        setStatus((s) => ({ ...s, reading: false }));
        void client.invalidateQueries({ queryKey: liveKeys.info(artifact.id, version) });
      } else
        setStatus((s) => ({
          ...s,
          reading: false,
          failed: result.ok
            ? `The site answered with an error (${result.status}).`
            : result.message,
        }));
      return result;
    },
    [artifact.id, version, client],
  );

  const allow = useMutation({
    mutationFn: ({ host, local }: { host: string; local: boolean }) =>
      artifactsApi.allow(artifact.id, { version, host, local }),
    onSuccess: (next: LiveDataInfo) => {
      client.setQueryData(key, next);
      void client.invalidateQueries({ queryKey: liveKeys.approvals });
      // The page starts again, and this time its requests are answered.
      setReload((n) => n + 1);
    },
    onError: (error) => toast.error('That didn’t change', { description: error.message }),
  });
  const revoke = useRevokeLive();

  return {
    info: info.data,
    allowed,
    ask,
    /** Every address the page reads on the host it's asking about. */
    askUrls: ask ? sources.filter((s) => s.host === ask.host).map((s) => s.url) : [],
    everySeconds: Number.isFinite(every) ? every : undefined,
    status,
    onData,
    refresh,
    reload,
    update: () => setRefresh((n) => n + 1),
    allow: (host: string, local: boolean) => allow.mutate({ host, local }),
    allowing: allow.isPending,
    decline: (host: string) => setDeclined((d) => new Set(d).add(host)),
    stop: (host: string) => revoke.mutate({ artifactId: artifact.id, host }),
  };
}
