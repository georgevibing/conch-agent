/**
 * Outside agents and rounds (ADR 0112): the REST client and hooks. Outside
 * agents are added by one paste in Settings → Agents; a round is stopped from
 * its card in the chat.
 */
import { OutsideAgent, OutsideAgentList, OutsidePreview } from '@conch/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { request } from '../../api/client';

const Ok = z.object({ ok: z.boolean() });
const Stopped = z.object({ stopped: z.boolean() });

export const outsideApi = {
  list: () => request(OutsideAgentList, '/api/agents/outside'),
  look: (paste: string) =>
    request(OutsidePreview, '/api/agents/outside/look', { method: 'POST', body: { paste } }),
  add: (paste: string) =>
    request(OutsideAgent, '/api/agents/outside', { method: 'POST', body: { paste } }),
  remove: (id: string) =>
    request(Ok, `/api/agents/outside/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  stopRound: (conversationId: string) =>
    request(Stopped, `/api/conversations/${encodeURIComponent(conversationId)}/round/stop`, {
      method: 'POST',
      body: {},
    }),
};

export const outsideKeys = { list: ['agents', 'outside'] as const };

export function useOutsideAgents() {
  return useQuery({
    queryKey: outsideKeys.list,
    queryFn: outsideApi.list,
    staleTime: 30_000,
    // Its problem line clears by itself once it answers again.
    refetchOnWindowFocus: true,
  });
}

export function useAddOutsideAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: outsideApi.add,
    onSuccess: () => void client.invalidateQueries({ queryKey: outsideKeys.list }),
  });
}

export function useRemoveOutsideAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: outsideApi.remove,
    onSuccess: () => void client.invalidateQueries({ queryKey: outsideKeys.list }),
  });
}
