import { useQuery } from '@tanstack/react-query';

import { keys } from '../../api/queries';
import { memoryApi } from './api';

/** Under `memories`, so `memory.changed` refreshes them all. */
export const memoryKeys = {
  search: (q: string) => [...keys.memories, 'search', q] as const,
  index: [...keys.memories, 'index'] as const,
  tidy: [...keys.memories, 'tidy'] as const,
  suggestions: ['skills', 'suggestions'] as const,
};

export function useMemorySearch(q: string) {
  return useQuery({
    queryKey: memoryKeys.search(q),
    queryFn: ({ signal }) => memoryApi.search(q, signal),
    enabled: q.trim().length > 0,
    placeholderData: (previous) => previous,
  });
}

/** The languages this browser speaks, which choose the model on offer (ADR 0041). */
export const browserLanguages = (): readonly string[] =>
  typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);

/** How memory is searched; checked often while a model is fetched or memories are indexed. */
export function useMemoryIndex() {
  return useQuery({
    queryKey: memoryKeys.index,
    queryFn: () => memoryApi.index(browserLanguages()),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const busy =
        data.getting !== undefined || (data.mode === 'meaning' && data.indexed < data.total);
      return busy ? 1500 : false;
    },
  });
}

/** The tidy-up's runs; checked often while one is running. */
export function useTidy() {
  return useQuery({
    queryKey: memoryKeys.tidy,
    queryFn: memoryApi.tidy,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  });
}

export function useSkillSuggestions() {
  return useQuery({
    queryKey: memoryKeys.suggestions,
    queryFn: () => memoryApi.suggestions(),
    staleTime: 5 * 60_000,
  });
}
