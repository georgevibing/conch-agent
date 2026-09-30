import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError, api } from '../../api/client';

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** While the index is being filled, results are re-asked for this often, so they fill in. */
const CATCHING_UP_POLL_MS = 1_500;

/** Search broke again after rebuilding itself; retrying won't help, a Repair might. */
export const isSearchUnavailable = (error: unknown) =>
  error instanceof ApiError && error.code === 'search-unavailable';

export const searchKeys = {
  results: (q: string) => ['search', q] as const,
  preview: (conversationId: string, anchor: string | undefined, q: string) =>
    ['search-preview', conversationId, anchor ?? '', q] as const,
};

/**
 * Full-text results for `query` across every conversation. Keeps showing the
 * previous results while the next ones load, so typing never flickers.
 */
export function useSearchResults(query: string, enabled = true) {
  const q = useDebounced(query.trim(), 60);
  const client = useQueryClient();
  const result = useQuery({
    queryKey: searchKeys.results(q),
    queryFn: ({ signal }) => api.search(q, { signal, limit: 12 }),
    enabled: enabled && q.length >= 3,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    gcTime: 60_000,
    retry: (count, error) => !isSearchUnavailable(error) && count < 1,
    // A rebuilt index fills in over a few seconds: keep asking until it's done.
    refetchInterval: (query) => (query.state.data?.catchingUp ? CATCHING_UP_POLL_MS : false),
  });
  const repair = useMutation({
    mutationFn: api.searchRepair,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['search'] });
      void client.invalidateQueries({ queryKey: ['search-preview'] });
    },
  });

  // Warm the previews of the top hits so arrowing through them is instant.
  const data = result.data;
  useEffect(() => {
    if (!data) return;
    for (const group of data.groups.slice(0, 4)) {
      const hit = group.hits[0];
      if (!hit) continue;
      void client.prefetchQuery({
        queryKey: searchKeys.preview(group.conversationId, hit.anchor, data.query),
        queryFn: ({ signal }) =>
          api.searchPreview(
            { conversationId: group.conversationId, anchor: hit.anchor, q: data.query },
            signal,
          ),
        staleTime: 30_000,
      });
    }
  }, [data, client]);

  const settled = q === query.trim();
  const unavailable = q.length >= 3 && isSearchUnavailable(result.error);
  const shown = q.length >= 3 && !unavailable ? data : undefined;
  return {
    data: shown,
    /**
     * Results are for an older query, or a request is in flight. Asking again
     * while catching up doesn't count: what's shown is already this query's.
     */
    pending:
      q.length >= 3 &&
      !unavailable &&
      (!settled || (result.isFetching && !(result.data?.catchingUp && !result.isPlaceholderData))),
    /** The index is still filling from the chats: more results may come. */
    catchingUp: Boolean(shown?.catchingUp),
    /** It broke again after rebuilding itself; `repair` tries once more. */
    unavailable,
    repair: () => repair.mutate(),
    repairing: repair.isPending,
  };
}

export function useSearchPreview(
  target: { conversationId: string; anchor?: string } | undefined,
  query: string,
) {
  const q = query.trim();
  return useQuery({
    queryKey: searchKeys.preview(target?.conversationId ?? '', target?.anchor, q),
    queryFn: ({ signal }) =>
      api.searchPreview(
        { conversationId: target?.conversationId ?? '', anchor: target?.anchor, q },
        signal,
      ),
    enabled: Boolean(target),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
  });
}
