import {
  ChatImportStatus,
  ContinuePastChatResult,
  PastChatDetail,
  RemovePastChatsResult,
  type ChatSourceId,
  type ChatSourceFound,
} from '@conch/protocol';
import type { ChatsFoundSource, ProviderId } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { request } from '../../api/client';

/** Your past chats from other apps (ADR 0111). Every response is checked against the protocol. */
export const pastChatsApi = {
  status: () => request(ChatImportStatus, '/api/import/chats'),
  /** Starts bringing them in; the status says how it goes. */
  start: (sources?: ChatSourceId[]) =>
    request(ChatImportStatus, '/api/import/chats', {
      method: 'POST',
      body: sources ? { sources } : {},
    }),
  removeAll: () => request(RemovePastChatsResult, '/api/import/chats', { method: 'DELETE' }),
  detail: (id: string) => request(PastChatDetail, `/api/past-chats/${encodeURIComponent(id)}`),
  carryOn: (id: string) =>
    request(ContinuePastChatResult, `/api/past-chats/${encodeURIComponent(id)}/continue`, {
      method: 'POST',
      body: {},
    }),
};

export const pastChatKeys = {
  status: ['import', 'chats'] as const,
  chat: (id: string) => ['past-chat', id] as const,
};

/** What's on this computer, and what's in Conch already; watched closely while they come in. */
export function useChatImportStatus(enabled = true) {
  return useQuery({
    queryKey: pastChatKeys.status,
    queryFn: pastChatsApi.status,
    staleTime: 60_000,
    enabled,
    refetchInterval: (query) => (query.state.data?.running ? 700 : false),
  });
}

export function usePastChat(id: string | undefined) {
  return useQuery({
    queryKey: pastChatKeys.chat(id ?? ''),
    queryFn: () => pastChatsApi.detail(id ?? ''),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

/** Settings → Memory opens at the past chats with this focus (⌘K, Repair everything). */
export const PAST_CHATS_FOCUS = 'past-chats';

/** Each app's mark, where Nacre has one. */
export const SOURCE_LOGOS: Partial<Record<ChatSourceId, ProviderId>> = {
  'claude-code': 'claude',
  codex: 'openai',
  'gemini-cli': 'gemini',
  copilot: 'copilot',
};

const month = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** What was found, as the moment shows it: each app's count, projects and since when. */
export function foundSources(
  sources: readonly ChatSourceFound[],
  count: 'found' | 'fresh' = 'found',
): ChatsFoundSource[] {
  return sources
    .filter((s) => s[count] > 0)
    .map((s) => {
      const logo = SOURCE_LOGOS[s.id];
      return {
        id: s.id,
        label: s.label,
        ...(logo && { logo }),
        count: s[count],
        projects: s.projects,
        ...(s.from && { when: `since ${month.format(s.from)}` }),
      };
    });
}

/** The past chat open to read, from wherever it was found (⌘K, a chat's look back, Settings). */
export const usePastChatSheet = create<{ id?: string }>(() => ({}));
export const openPastChat = (id: string) => usePastChatSheet.setState({ id });
