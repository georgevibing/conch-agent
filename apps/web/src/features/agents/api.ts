/**
 * Agents (ADR 0101): the REST client and the hooks the pages use. The list is
 * one query, kept fresh by the gateway's `agents.changed` (`applyAgentsEvent`),
 * so every picker, the chat and Settings agree without refetching.
 */
import {
  Agent,
  AgentList,
  AvatarGeneration,
  GeneratedAvatar,
  chatAgentId,
  type AgentId,
  type ConversationSummary,
  type CreateAgentBody,
  type GenerateAvatarBody,
  type ServerEvent,
  type UpdateAgentBody,
} from '@conch/protocol';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import { request } from '../../api/client';
import { keys } from '../../api/queries';
import { useHiddenAgents, withoutHidden } from './hidden';

const Ok = z.object({ ok: z.boolean() });

/** A picture as base64, without the `data:` prefix. */
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('That picture couldn’t be read.'));
    reader.readAsDataURL(blob);
  });
}

const path = (id: string) => `/api/agents/${encodeURIComponent(id)}`;

export const agentsApi = {
  list: () => request(AgentList, '/api/agents'),
  get: (id: string) => request(Agent, path(id)),
  create: (body: CreateAgentBody) => request(Agent, '/api/agents', { method: 'POST', body }),
  update: (id: string, body: UpdateAgentBody) =>
    request(Agent, path(id), { method: 'PATCH', body }),
  remove: (id: string) => request(Ok, path(id), { method: 'DELETE' }),
  /** Every agent's id, in the new order. */
  reorder: (ids: string[]) =>
    request(AgentList, '/api/agents/order', { method: 'PUT', body: { ids } }),
  setDefault: (id: string) =>
    request(AgentList, '/api/agents/default', { method: 'PUT', body: { id } }),
  /** A picture of your own, already framed and shrunk (≤ 700 KB): PNG, JPEG or WebP. */
  setAvatar: async (id: string, picture: Blob) =>
    request(Agent, `${path(id)}/avatar`, {
      method: 'PUT',
      body: { data: await base64(picture) },
    }),
  /** Whether a picture can be made, and by whom: hide the button when it can't. */
  generation: () => request(AvatarGeneration, '/api/agents/avatar/generate'),
  /** A picture to look at, kept nowhere: frame it, then `setAvatar` if it's liked. */
  generate: (body: GenerateAvatarBody, signal?: AbortSignal) =>
    request(GeneratedAvatar, '/api/agents/avatar/generate', {
      method: 'POST',
      body,
      ...(signal && { signal }),
    }),
  /** Another agent answers this chat from the next message on. */
  setChatAgent: (conversationId: string, agentId: AgentId) =>
    request(Ok, `/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      body: { agentId },
    }),
};

export const agentKeys = {
  list: ['agents'] as const,
  generation: ['agents', 'generation'] as const,
};

/**
 * Every agent, in order, and which is the default: without any being deleted
 * while its Undo is offered (`remove.ts`).
 */
export function useAgents() {
  const hidden = useHiddenAgents((s) => s.ids);
  const select = useCallback((list: AgentList) => withoutHidden(list, hidden), [hidden]);
  return useQuery({
    queryKey: agentKeys.list,
    queryFn: agentsApi.list,
    staleTime: 5 * 60_000,
    select,
  });
}

/** One agent from the list (no request of its own). */
export function useAgent(id: string | undefined): Agent | undefined {
  const { data } = useAgents();
  return id ? data?.agents.find((a) => a.id === id) : undefined;
}

/** The agent a chat is with (its own, the first for a chat from before agents, else the default). */
export function useChatAgent(chat: Pick<ConversationSummary, 'agentId'> | undefined) {
  const { data } = useAgents();
  if (!data) return undefined;
  const id = chatAgentId(chat, data);
  return data.agents.find((a) => a.id === id);
}

/** The agent new chats start with. */
export function useDefaultAgent(): Agent | undefined {
  const { data } = useAgents();
  return data?.agents.find((a) => a.id === data.defaultId);
}

/** Whether a picture can be made; checked again now and then (a provider connected meanwhile). */
export function useAvatarGeneration() {
  return useQuery({
    queryKey: agentKeys.generation,
    queryFn: agentsApi.generation,
    staleTime: 60_000,
  });
}

/** A new list from the gateway: everywhere at once, and the older `persona` with it. */
export function setAgentList(client: QueryClient, list: AgentList) {
  client.setQueryData(agentKeys.list, list);
  // The app's state carries the default agent as `persona`.
  void client.invalidateQueries({ queryKey: keys.state });
}

/** Put one changed agent in the list straight away (the event that follows agrees). */
function putAgent(client: QueryClient, agent: Agent) {
  client.setQueryData<AgentList>(agentKeys.list, (list) => {
    if (!list) return list;
    const others = list.agents.filter((a) => a.id !== agent.id);
    const agents = [...others, agent].sort((a, b) => a.order - b.order);
    return { agents, defaultId: agent.isDefault ? agent.id : list.defaultId };
  });
}

/** `agents.changed`, from the socket. */
export function applyAgentsEvent(client: QueryClient, event: ServerEvent) {
  if (event.type === 'agents.changed') setAgentList(client, event.list);
}

export function useCreateAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: agentsApi.create,
    onSuccess: (agent) => putAgent(client, agent),
  });
}

export function useUpdateAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAgentBody }) => agentsApi.update(id, body),
    onSuccess: (agent) => putAgent(client, agent),
  });
}

export function useDeleteAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: agentsApi.remove,
    onSuccess: () => client.invalidateQueries({ queryKey: agentKeys.list }),
  });
}

/** Reorder, shown at once and put back if the gateway says no. */
export function useReorderAgents() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: agentsApi.reorder,
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: agentKeys.list });
      const before = client.getQueryData<AgentList>(agentKeys.list);
      if (before)
        client.setQueryData<AgentList>(agentKeys.list, {
          ...before,
          agents: ids
            .map((id, order) => {
              const agent = before.agents.find((a) => a.id === id);
              return agent && { ...agent, order };
            })
            .filter((a): a is Agent => Boolean(a)),
        });
      return { before };
    },
    onError: (_error, _ids, context) => {
      if (context?.before) client.setQueryData(agentKeys.list, context.before);
    },
    onSuccess: (list) => setAgentList(client, list),
  });
}

export function useSetDefaultAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: agentsApi.setDefault,
    onSuccess: (list) => setAgentList(client, list),
  });
}

export function useSetAgentAvatar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, picture }: { id: string; picture: Blob }) =>
      agentsApi.setAvatar(id, picture),
    onSuccess: (agent) => putAgent(client, agent),
  });
}

export function useGenerateAvatar() {
  return useMutation({
    mutationFn: (body: GenerateAvatarBody) => agentsApi.generate(body),
  });
}

/** Another agent for this chat; the chat's summary and its divider arrive over the socket. */
export function useSetChatAgent() {
  return useMutation({
    mutationFn: ({ conversationId, agentId }: { conversationId: string; agentId: AgentId }) =>
      agentsApi.setChatAgent(conversationId, agentId),
  });
}
