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

/** How memory is searched; checked often while a model is being fetched. */
export function useMemoryIndex() {
  return useQuery({
    queryKey: memoryKeys.index,
    queryFn: memoryApi.index,
    refetchInterval: (query) => (query.state.data?.getting !== undefined ? 1500 : false),
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
