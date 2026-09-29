import type { SearchResults } from '@conch/protocol';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api } from '../../api/client';

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

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
  return {
    data: (q.length >= 3 ? data : undefined) as SearchResults | undefined,
    /** Results are for an older query, or a request is in flight. */
    pending: q.length >= 3 && (!settled || result.isFetching),
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
