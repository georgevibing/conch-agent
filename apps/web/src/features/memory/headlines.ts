import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import { keys } from '../../api/queries';

/**
 * Each memory's headline by id (ADR 0003 § Headlines), as the memories are
 * now: what a summing-up line shows in place of a long memory. A memory
 * without one yet is said in a few words by `headlineOf` until it has one;
 * asking for the list is what has older ones written.
 */
export function useMemoryHeadlines(enabled = true): ReadonlyMap<string, string> {
  // The same list as `useMemories`: asked for only where a memory is being shown.
  const { data } = useQuery({ queryKey: keys.memories, queryFn: api.memories, enabled });
  return useMemo(
    () => new Map((data ?? []).flatMap((m) => (m.headline ? [[m.id, m.headline] as const] : []))),
    [data],
  );
}
