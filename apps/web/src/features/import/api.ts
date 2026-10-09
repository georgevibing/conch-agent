import {
  Agent,
  Channel,
  ImportRest,
  ImportPlan,
  ImportResult,
  ImportSlackStatus,
  ImportStatus,
  UndoImportResult,
  type FinishSlackImportBody,
  type ImportSourceId,
} from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { request } from '../../api/client';

/** Come home (ADR 0035). Every response is checked against the protocol. */
export const importApi = {
  status: () => request(ImportStatus, '/api/import'),
  plan: (source: ImportSourceId) =>
    request(ImportPlan, `/api/import/${encodeURIComponent(source)}`),
  /** `defaultAgent`: the `agent:` item that starts new chats (ADR 0101); unset keeps yours. */
  run: (source: ImportSourceId, items: string[], defaultAgent?: string) =>
    request(ImportResult, '/api/import', {
      method: 'POST',
      body: { source, items, ...(defaultAgent && { defaultAgent }) },
    }),
  undo: () => request(UndoImportResult, '/api/import/undo', { method: 'POST', body: {} }),
  /** A Slack bot another app had one key for (ADR 0042): which key and app, never the key. */
  slack: (source?: ImportSourceId) =>
    request(
      ImportSlackStatus,
      `/api/import/slack${source ? `?source=${encodeURIComponent(source)}` : ''}`,
    ),
  finishSlack: (source: ImportSourceId, body: FinishSlackImportBody) =>
    request(Channel, `/api/import/${encodeURIComponent(source)}/slack`, { method: 'POST', body }),
  /** Agents an older Conch brought with the end of their instructions cut off (ADR 0101). */
  rest: () => request(ImportRest, '/api/import/rest'),
  /** The rest of one agent's instructions, brought in from the app it came from. */
  bringRest: (agentId: string) =>
    request(Agent, `/api/import/rest/${encodeURIComponent(agentId)}`, {
      method: 'POST',
      body: {},
    }),
};

/** Where the Slack setup picks up from, for a bot that came over with one key. */
export const finishSlackPath = (source: ImportSourceId) => `/channels/new/slack?from=${source}`;

export const importKeys = { status: ['import'] as const, rest: ['import', 'rest'] as const };

/** What's still in another app of an agent that came over cut short, if anything. */
export function useImportRest(enabled = true) {
  return useQuery({
    queryKey: importKeys.rest,
    queryFn: importApi.rest,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** The other agents on this computer, and the last import while it can be undone. */
export function useImportStatus(enabled = true) {
  return useQuery({
    queryKey: importKeys.status,
    queryFn: importApi.status,
    staleTime: 60_000,
    enabled,
  });
}

/** Where an import is, from the `import.progress` event. */
export const useImportProgress = create<{
  done: number;
  total: number;
  current?: string;
}>(() => ({ done: 0, total: 0 }));

/** Settings → What Conch knows opens Come home with this focus (Repair everything, ⌘K). */
export const COME_HOME_FOCUS = 'come-home';
