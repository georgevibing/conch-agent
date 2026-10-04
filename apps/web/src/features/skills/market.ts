/**
 * Discover (ADR 0074): skills people publish, as the Skills page and the chat
 * ask for them. Reading is free; adding and updating are a press.
 */
import {
  MarketListing,
  MarketPreview,
  MarketResults,
  SkillDetail,
  type MarketCategory,
  type MarketInstallBody,
  type MarketQuery,
  type MarketUpdateBody,
} from '@conch/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { request } from '../../api/client';
import { putSkill } from './queries';

export const marketApi = {
  search: (query: MarketQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.category) params.set('category', query.category);
    if (query.source) params.set('source', query.source);
    const qs = params.toString();
    return request(MarketResults, `/api/skills/market${qs ? `?${qs}` : ''}`, { signal });
  },
  listing: (id: string) =>
    request(MarketListing, `/api/skills/market/listing?id=${encodeURIComponent(id)}`),
  /** Download one version and read it. Nothing is added. */
  preview: (id: string, signal?: AbortSignal) =>
    request(MarketPreview, '/api/skills/market/preview', { method: 'POST', body: { id }, signal }),
  install: (body: z.input<typeof MarketInstallBody>) =>
    request(SkillDetail, '/api/skills/market/install', { method: 'POST', body }),
  /** How many skills you added have a newer version (looked for at most once a day). */
  updates: (refresh = false) =>
    request(
      z.object({ updates: z.number() }),
      `/api/skills/market/updates${refresh ? '?refresh=1' : ''}`,
    ),
  previewUpdate: (skillId: string) =>
    request(MarketPreview, `/api/skills/${encodeURIComponent(skillId)}/market/update/preview`, {
      method: 'POST',
      body: {},
    }),
  update: (skillId: string, body: MarketUpdateBody) =>
    request(SkillDetail, `/api/skills/${encodeURIComponent(skillId)}/market/update`, {
      method: 'POST',
      body,
    }),
};

/** Apart from `['skills']`, so refreshing your skills never downloads a skill again. */
export const marketKeys = {
  all: ['skill-market'] as const,
  searches: ['skill-market', 'search'] as const,
  search: (q: string, category?: MarketCategory) =>
    ['skill-market', 'search', q, category ?? ''] as const,
  listing: (id: string) => ['skill-market', 'listing', id] as const,
  preview: (id: string) => ['skill-market', 'preview', id] as const,
  updates: ['skill-market', 'updates'] as const,
};

/** The shelf, or what matches: kept a few minutes, and from before when a place is away. */
export function useMarket(q: string, category?: MarketCategory, enabled = true) {
  return useQuery({
    queryKey: marketKeys.search(q, category),
    queryFn: ({ signal }) =>
      marketApi.search({ ...(q && { q }), ...(category && { category }) }, signal),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useMarketListing(id: string | undefined) {
  return useQuery({
    queryKey: marketKeys.listing(id ?? ''),
    queryFn: () => marketApi.listing(id ?? ''),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** The skill downloaded and read, while the page is open. A fresh read each time it opens. */
export function useMarketPreview(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: marketKeys.preview(id ?? ''),
    queryFn: ({ signal }) => marketApi.preview(id ?? '', signal),
    enabled: Boolean(id) && enabled,
    staleTime: 20 * 60_000,
    gcTime: 0,
    retry: false,
  });
}

/** Add exactly what was read; the skill is yours from here. */
export function useInstallSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof MarketInstallBody>) => marketApi.install(body),
    onSuccess: (skill) => {
      putSkill(client, skill);
      // Its card says Added now.
      void client.invalidateQueries({ queryKey: marketKeys.searches });
      if (skill.origin)
        void client.invalidateQueries({ queryKey: marketKeys.listing(skill.origin.listingId) });
    },
  });
}

/** Skills you added that have a newer version. */
export function useMarketUpdates() {
  return useQuery({
    queryKey: marketKeys.updates,
    queryFn: () => marketApi.updates(),
    staleTime: 60 * 60_000,
    retry: false,
  });
}
